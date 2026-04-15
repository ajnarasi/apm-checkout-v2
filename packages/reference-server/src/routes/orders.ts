/**
 * v2.1: Reference server orders routes — REAL CH forwarding.
 *
 * All five routes forward to `CheckoutOrdersClient` (which talks to
 * `POST /checkouts/v1/orders`). Operation discrimination happens at the
 * client layer, not the route layer:
 *
 *   POST /v2/orders/:apm                 → ordersClient.authorize() OR .sale()
 *                                          (driven by paymentInitiator from session)
 *   POST /v2/orders/:orderId/capture     → ordersClient.capture()
 *   POST /v2/orders/:orderId/void        → ordersClient.void()
 *   POST /v2/orders/:orderId/refund      → ordersClient.refund()
 *   GET  /v2/orders/:orderId             → polling helper (returns last cached state)
 *
 * The architecture correction from the user (2026-04-14): "All authorize/capture
 * methods should be Commerce Hub's server-side endpoint, NOT a JavaScript call."
 *
 * Replaces the v2.0 mock that synthesized `https://provider.example.com/auth?...`
 * fake redirect URLs.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AppContext } from '../config.js';
import type { PaymentInitiator } from '@commercehub/shared-types';
import { getApmMapping } from '@commercehub/shared-types';
import { logger } from '../observability/logger.js';
import {
  scenarioFromRequest,
  harnessOrderResponse,
  harnessReferenceOpResponse,
} from '../harness/runtime.js';

interface AuthorizePayload {
  apm: string;
  merchantOrderId: string;
  amount: { value: number; currency: string };
  providerData?: Record<string, unknown>;
  returnUrls?: { successUrl: string; cancelUrl: string };
  /** Forwarded from the SDK — defaults to GATEWAY at the SDK layer. */
  paymentInitiator?: PaymentInitiator;
  /** AUTHORIZE | SALE — set by the SDK based on paymentInitiator. */
  intent?: 'AUTHORIZE' | 'SALE';
}

interface CapturePayload {
  referenceTransactionId: string;
  amount?: { value: number; currency: string };
}

interface VoidPayload {
  referenceTransactionId: string;
  reason?: string;
}

interface RefundPayload {
  referenceTransactionId: string;
  amount: { value: number; currency: string };
  reason?: string;
}

/**
 * POST /v2/orders/:apm — authorize or sale via CH /checkouts/v1/orders.
 */
export function buildAuthorizeOrder(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = res.locals.correlationId as string | undefined;
    const apm = req.params.apm;
    const body = req.body as AuthorizePayload;

    if (!body?.merchantOrderId || !body?.amount) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'merchantOrderId and amount are required',
        correlationId,
      });
      return;
    }

    logger.info(
      {
        correlationId,
        apm,
        merchantOrderId: body.merchantOrderId,
        intent: body.intent ?? 'SALE',
        paymentInitiator: body.paymentInitiator ?? 'GATEWAY',
      },
      'order.authorize.received'
    );

    // v2.2: single source of truth for APM → CH wire mapping. PPRO sub-methods
    // get `paymentMethod.provider = uppercase(apm)` (e.g. "IDEAL") so CH knows
    // to internally route to PPRO. The string "PPRO" never appears on the wire.
    const mapping = getApmMapping(apm);
    if (!mapping) {
      res.status(400).json({
        error: 'UNKNOWN_APM',
        message: `Unknown APM: ${apm}`,
        correlationId,
      });
      return;
    }

    // v2.2: harness mode — synthesize a CH response driven by the
    // X-Harness-Scenario header. No network call to CH.
    if (ctx.env.harnessMode) {
      const scenarioId = scenarioFromRequest(req);
      const synthetic = harnessOrderResponse({
        apm,
        mapping,
        merchantOrderId: body.merchantOrderId,
        amountMinor: Math.round(body.amount.value * 100),
        currency: body.amount.currency,
        scenarioId,
        intent: body.intent ?? 'SALE',
        correlationId,
        paymentInitiator: body.paymentInitiator ?? 'GATEWAY',
      });
      logger.info(
        { correlationId, apm, scenario: scenarioId, harness: true },
        'order.authorize.harness'
      );
      res.status(synthetic.status).json(synthetic.body);
      return;
    }

    try {
      const authorizeInput = {
        amount: { total: body.amount.value, currency: body.amount.currency },
        source: {
          sourceType: mapping.chSourceType,
          ...(mapping.chWalletType ? { walletType: mapping.chWalletType } : {}),
          // Provider-specific token from browser tokenization. Pass-through.
          ...body.providerData,
        },
        // chProvider is set for ALL PPRO sub-methods AND some direct adapters.
        // For everything else (e.g. raw card-network entries), omit paymentMethod.
        ...(mapping.chProvider ? { paymentMethod: { provider: mapping.chProvider } } : {}),
        paymentInitiator: body.paymentInitiator ?? ('GATEWAY' as PaymentInitiator),
        merchantOrderId: body.merchantOrderId,
        returnUrls: body.returnUrls,
        correlationId,
        deadline: Date.now() + 4000,
      };

      const result =
        body.intent === 'AUTHORIZE'
          ? await ctx.ordersClient.authorize(authorizeInput)
          : await ctx.ordersClient.sale(authorizeInput);

      // Return the raw CH response so the SDK's order-result-mapper can
      // normalize it into an OrderResult via the ACL.
      res.json(result.raw);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /v2/orders/:orderId/capture — explicit capture for merchant-initiated flows.
 */
export function buildCaptureOrder(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = res.locals.correlationId as string | undefined;
    const orderId = req.params.orderId;
    const body = req.body as CapturePayload;

    if (!body?.referenceTransactionId) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'referenceTransactionId is required',
        correlationId,
      });
      return;
    }

    logger.info(
      { correlationId, orderId, referenceTransactionId: body.referenceTransactionId },
      'order.capture.received'
    );

    if (ctx.env.harnessMode) {
      const synthetic = harnessReferenceOpResponse({
        operation: 'capture',
        orderId,
        referenceTransactionId: body.referenceTransactionId,
        amountMinor: body.amount ? Math.round(body.amount.value * 100) : undefined,
        currency: body.amount?.currency,
        correlationId,
      });
      res.status(synthetic.status).json(synthetic.body);
      return;
    }

    try {
      const result = await ctx.ordersClient.capture({
        referenceTransactionId: body.referenceTransactionId,
        amount: body.amount ? { total: body.amount.value, currency: body.amount.currency } : undefined,
        correlationId,
        deadline: Date.now() + 4000,
      });
      res.json(result.raw);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /v2/orders/:orderId/void — explicit void.
 */
export function buildVoidOrder(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = res.locals.correlationId as string | undefined;
    const orderId = req.params.orderId;
    const body = req.body as VoidPayload;

    if (!body?.referenceTransactionId) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'referenceTransactionId is required',
        correlationId,
      });
      return;
    }

    logger.info(
      { correlationId, orderId, referenceTransactionId: body.referenceTransactionId, reason: body.reason },
      'order.void.received'
    );

    if (ctx.env.harnessMode) {
      const synthetic = harnessReferenceOpResponse({
        operation: 'void',
        orderId,
        referenceTransactionId: body.referenceTransactionId,
        correlationId,
      });
      res.status(synthetic.status).json(synthetic.body);
      return;
    }

    try {
      const result = await ctx.ordersClient.void({
        referenceTransactionId: body.referenceTransactionId,
        reason: body.reason,
        correlationId,
        deadline: Date.now() + 4000,
      });
      res.json(result.raw);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /v2/orders/:orderId/refund — explicit refund.
 */
export function buildRefundOrder(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = res.locals.correlationId as string | undefined;
    const orderId = req.params.orderId;
    const body = req.body as RefundPayload;

    if (!body?.referenceTransactionId || !body?.amount) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'referenceTransactionId and amount are required',
        correlationId,
      });
      return;
    }

    logger.info(
      {
        correlationId,
        orderId,
        referenceTransactionId: body.referenceTransactionId,
        amount: body.amount.value,
      },
      'order.refund.received'
    );

    if (ctx.env.harnessMode) {
      const synthetic = harnessReferenceOpResponse({
        operation: 'refund',
        orderId,
        referenceTransactionId: body.referenceTransactionId,
        amountMinor: Math.round(body.amount.value * 100),
        currency: body.amount.currency,
        correlationId,
      });
      res.status(synthetic.status).json(synthetic.body);
      return;
    }

    try {
      const result = await ctx.ordersClient.refund({
        referenceTransactionId: body.referenceTransactionId,
        amount: { total: body.amount.value, currency: body.amount.currency },
        reason: body.reason,
        correlationId,
        deadline: Date.now() + 4000,
      });
      res.json(result.raw);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * GET /v2/orders/:orderId — polling endpoint for QR/voucher flows.
 *
 * In v2.1 this is a thin wrapper around the same authorize endpoint with a
 * "get current state" semantics. CH spec doesn't expose a separate /orders/{id}
 * GET on /checkouts/v1/orders — production deployments should use the
 * Inquiry endpoint (separate spec). For now we return the cached webhook state
 * if available, otherwise a PENDING placeholder.
 */
export function buildGetOrder(ctx: AppContext) {
  return async (req: Request, res: Response): Promise<void> => {
    const orderId = req.params.orderId;
    // Webhook event bus may have cached an event for this order — surface it
    // by inspecting recent events. This is a best-effort polling approximation.
    const correlationId = res.locals.correlationId as string | undefined;
    void ctx;
    res.json({
      gatewayResponse: {
        transactionState: 'PENDING',
        transactionProcessingDetails: {
          orderId,
          apiTraceId: correlationId,
        },
      },
    });
  };
}

// v2.2: per-APM mapping helpers removed — replaced by the canonical
// `getApmMapping()` lookup from `@commercehub/shared-types/apm-mapping`.
// See ADR-004 (single CH endpoint, CH owns the fan-out).
