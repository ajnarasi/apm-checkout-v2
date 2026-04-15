/**
 * CheckoutOrdersClient — talks to CH `POST /checkouts/v1/orders`.
 *
 * Sibling to CommerceHubClient (which talks to `POST /payments-vas/v1/security/credentials`).
 * Both use the same StaticAuth / circuit breaker / retry / redact infrastructure.
 *
 * One endpoint, five logical operations — discriminated by request body fields
 * per CH Orders spec v1.26.0302 (read pages 1-150 on 2026-04-14):
 *
 *   AUTHORIZE  → captureFlag=false, no reference
 *   SALE       → captureFlag=true, no reference
 *   CAPTURE    → captureFlag=true + referenceTransactionDetails.referenceTransactionId
 *   VOID       → reversalReasonCode='VOID' + referenceTransactionDetails.referenceTransactionId
 *   REFUND     → refundIndicator + referenceTransactionDetails.referenceTransactionId
 *
 * Each operation is exposed as its own method so the type system enforces correct
 * field combinations. None of the call sites should construct a
 * CheckoutOrdersRequest by hand.
 */

import { randomUUID } from 'node:crypto';
import type {
  CheckoutOrdersRequest,
  CheckoutOrdersResponse,
  PaymentInitiator,
  PaymentIntent,
} from '@commercehub/shared-types';
import { intentToWireFields } from '@commercehub/shared-types';

import { CircuitBreaker } from './circuit-breaker.js';
import {
  CommerceHubError,
  errorFromHttpStatus,
  NetworkError,
  RefusedProductionError,
  ValidationError,
} from './errors.js';
import { redact, redactHeaders } from './redact.js';
import { withRetry, type RetryPolicy } from './retry.js';
import { StaticAuth } from './static-auth.js';
import type { Logger } from './client.js';

const PRODUCTION_HOST_ALLOWLIST = /^https:\/\/[a-z0-9-]+\.firstdata\.com(\/|$)/i;
/**
 * Canonical CH Orders path per spec v1.26.0302 + `output/ideal-via-ppro/config.json`.
 *
 * Override via `CH_ORDERS_PATH` for the cert sandbox at `cert.api.firstdata.com`,
 * which historically responds on the legacy `/ch/payments/v1/orders` path while
 * Apigee in front of the canonical path returns 404. Production deployments
 * should leave this unset so the canonical wire path is used.
 */
const ORDERS_PATH = process.env.CH_ORDERS_PATH ?? '/checkouts/v1/orders';

/**
 * Resolved order — caller-facing return type from every operation.
 */
export interface OrderResult {
  /** CH-generated orderId. */
  orderId: string;
  /** CH-generated transactionId — pass back as referenceTransactionId for capture/void/refund. */
  transactionId?: string;
  /** Raw `gatewayResponse.transactionState` — let callers do the ACL mapping. */
  transactionState?: string;
  /** "CHARGE" | "AUTH" | "CAPTURE" | "VOID" | "REFUND". */
  transactionType?: string;
  /** Use this for support tickets. */
  apiTraceId?: string;
  /** Echoed from request header. */
  clientRequestId: string;
  /** Pass-through CH response for debugging (PII-redacted before logging). */
  raw: CheckoutOrdersResponse;
}

export interface CheckoutOrdersClientConfig {
  /** Base URL for Commerce Hub. Must be https://*.firstdata.com in production. */
  baseUrl: string;
  /** Auth adapter — currently only StaticAuth is supported in POC. */
  auth: StaticAuth;
  /** Retry policy overrides. */
  retry?: Partial<RetryPolicy>;
  /** Circuit breaker. Caller can inject a shared one. */
  breaker?: CircuitBreaker;
  /** Structured logger (pino-compatible). */
  logger?: Logger;
  /** Test-only escape hatch to skip the HTTPS + host allowlist check. */
  __allowInsecureUrlForTests?: boolean;
}

/**
 * Common payload shape across operations — the source identification and
 * provider token live here. Sub-fields are loosely typed because the discriminator
 * varies per APM (architect concern: defer per-APM token field resolution to Phase F).
 */
export interface PaymentSourceInput {
  /** "PaymentCard" | "DigitalWallet" | "AlternativePaymentMethod" — REQUIRED. */
  sourceType: string;
  walletType?: string;
  /** Provider-specific token from the browser-side tokenization. */
  [key: string]: unknown;
}

export interface AuthorizeInput {
  amount: { total: number; currency: string };
  source: PaymentSourceInput;
  paymentMethod?: { provider: string; type?: string };
  paymentInitiator: PaymentInitiator;
  merchantOrderId: string;
  merchantTransactionId?: string;
  customer?: CheckoutOrdersRequest['customer'];
  billingAddress?: CheckoutOrdersRequest['billingAddress'];
  shippingAddress?: CheckoutOrdersRequest['shippingAddress'];
  returnUrls?: { successUrl?: string; cancelUrl?: string };
  authentication3DS?: boolean;
  /** Idempotency key. Auto-generated if omitted; reused across HTTP retries. */
  clientRequestId?: string;
  /** Absolute deadline (epoch ms). */
  deadline?: number;
  /** Correlation id propagated to logs and CH. */
  correlationId?: string;
}

export interface CaptureInput {
  /** transactionId from the original auth's OrderResult. */
  referenceTransactionId: string;
  /** Optional partial-capture amount. Omit for full capture. */
  amount?: { total: number; currency: string };
  merchantOrderId?: string;
  clientRequestId?: string;
  deadline?: number;
  correlationId?: string;
}

export interface VoidInput {
  referenceTransactionId: string;
  /** Optional reason string. Defaults to 'VOID'. */
  reason?: string;
  clientRequestId?: string;
  deadline?: number;
  correlationId?: string;
}

export interface RefundInput {
  referenceTransactionId: string;
  amount: { total: number; currency: string };
  reason?: string;
  clientRequestId?: string;
  deadline?: number;
  correlationId?: string;
}

export class CheckoutOrdersClient {
  private readonly config: CheckoutOrdersClientConfig;
  private readonly breaker: CircuitBreaker;

  constructor(config: CheckoutOrdersClientConfig) {
    this.validateBaseUrl(config);
    this.config = config;
    this.breaker = config.breaker ?? new CircuitBreaker();
  }

  getBreakerState() {
    return this.breaker.getState();
  }

  /**
   * AUTHORIZE — auth-only. captureFlag=false. No referenceTransactionDetails.
   * Used for merchant-initiated flows where capture happens later.
   */
  async authorize(input: AuthorizeInput): Promise<OrderResult> {
    this.validateAuthorizeInput(input);
    const body = this.buildAuthorizeBody(input, 'AUTHORIZE');
    return this.submit(body, input);
  }

  /**
   * SALE — auth + capture in one shot. captureFlag=true. No reference.
   * Used for gateway-initiated flows (the default).
   */
  async sale(input: AuthorizeInput): Promise<OrderResult> {
    this.validateAuthorizeInput(input);
    const body = this.buildAuthorizeBody(input, 'SALE');
    return this.submit(body, input);
  }

  /**
   * CAPTURE — capture against an existing auth. Requires referenceTransactionId.
   */
  async capture(input: CaptureInput): Promise<OrderResult> {
    if (!input.referenceTransactionId) {
      throw new ValidationError({
        message: 'capture: referenceTransactionId is required',
      });
    }
    const wireFields = intentToWireFields('CAPTURE', input.referenceTransactionId);
    const body: CheckoutOrdersRequest = {
      order: { intent: 'CAPTURE' },
      paymentSource: { sourceType: 'AlternativePaymentMethod' }, // CH still requires sourceType
      transactionDetails: {
        captureFlag: wireFields.captureFlag,
        merchantOrderId: input.merchantOrderId,
      },
      referenceTransactionDetails: {
        referenceTransactionId: wireFields.referenceTransactionId,
      },
      amount: input.amount,
    };
    return this.submit(body, {
      clientRequestId: input.clientRequestId,
      deadline: input.deadline,
      correlationId: input.correlationId,
    });
  }

  /**
   * VOID — cancel an auth before settlement. Requires referenceTransactionId.
   */
  async void(input: VoidInput): Promise<OrderResult> {
    if (!input.referenceTransactionId) {
      throw new ValidationError({
        message: 'void: referenceTransactionId is required',
      });
    }
    const wireFields = intentToWireFields('VOID', input.referenceTransactionId);
    const body: CheckoutOrdersRequest = {
      order: { intent: 'VOID' },
      paymentSource: { sourceType: 'AlternativePaymentMethod' },
      transactionDetails: {
        reversalReasonCode: wireFields.reversalReasonCode ?? 'VOID',
      },
      referenceTransactionDetails: {
        referenceTransactionId: wireFields.referenceTransactionId,
      },
    };
    return this.submit(body, {
      clientRequestId: input.clientRequestId,
      deadline: input.deadline,
      correlationId: input.correlationId,
    });
  }

  /**
   * REFUND — refund a settled order. Requires referenceTransactionId + amount.
   *
   * Note: the exact "refund indicator" field path needs verification from spec
   * pages > 150 during Phase F. For now we set `order.intent='REFUND'` and rely
   * on CH's order intent discriminator. Update this method when the exact field
   * path is confirmed.
   */
  async refund(input: RefundInput): Promise<OrderResult> {
    if (!input.referenceTransactionId) {
      throw new ValidationError({
        message: 'refund: referenceTransactionId is required',
      });
    }
    const body: CheckoutOrdersRequest = {
      order: { intent: 'REFUND' },
      paymentSource: { sourceType: 'AlternativePaymentMethod' },
      transactionDetails: {},
      referenceTransactionDetails: {
        referenceTransactionId: input.referenceTransactionId,
      },
      amount: input.amount,
    };
    return this.submit(body, {
      clientRequestId: input.clientRequestId,
      deadline: input.deadline,
      correlationId: input.correlationId,
    });
  }

  // ──────────────── internals ────────────────

  private validateBaseUrl(config: CheckoutOrdersClientConfig): void {
    if (config.__allowInsecureUrlForTests) return;
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !PRODUCTION_HOST_ALLOWLIST.test(config.baseUrl)) {
      throw new RefusedProductionError(
        `CheckoutOrdersClient refuses baseUrl "${config.baseUrl}" in production. ` +
          'Only https://*.firstdata.com hosts are allowed.'
      );
    }
    if (!config.baseUrl.startsWith('https://') && isProd) {
      throw new RefusedProductionError(
        `CheckoutOrdersClient requires HTTPS in production. Got: ${config.baseUrl}`
      );
    }
  }

  private validateAuthorizeInput(input: AuthorizeInput): void {
    if (!input.amount?.total || !input.amount?.currency) {
      throw new ValidationError({
        message: 'amount.total and amount.currency are required',
      });
    }
    if (!input.source?.sourceType) {
      throw new ValidationError({
        message: 'source.sourceType is required (per CH spec page 6)',
      });
    }
    if (!input.merchantOrderId) {
      throw new ValidationError({
        message: 'merchantOrderId is required',
      });
    }
    if (!input.paymentInitiator) {
      throw new ValidationError({
        message: 'paymentInitiator is required (GATEWAY or MERCHANT)',
      });
    }
  }

  private buildAuthorizeBody(
    input: AuthorizeInput,
    intent: PaymentIntent
  ): CheckoutOrdersRequest {
    const wireFields = intentToWireFields(intent);
    return {
      order: { intent },
      paymentMethod: input.paymentMethod,
      paymentSource: input.source,
      checkoutInteractions: {
        channel: 'WEB',
        paymentInitiator: input.paymentInitiator,
        returnUrls: input.returnUrls,
        customerConfirmation: 'PAY_NOW',
      },
      transactionDetails: {
        captureFlag: wireFields.captureFlag,
        merchantTransactionId: input.merchantTransactionId,
        merchantOrderId: input.merchantOrderId,
        authentication3DS: input.authentication3DS,
      },
      customer: input.customer,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress,
      amount: input.amount,
    };
  }

  private async submit(
    body: CheckoutOrdersRequest,
    meta: { clientRequestId?: string; deadline?: number; correlationId?: string }
  ): Promise<OrderResult> {
    const clientRequestId = meta.clientRequestId ?? randomUUID();
    const bodyJson = JSON.stringify(body);

    return this.breaker.execute(() =>
      withRetry(
        (attempt) =>
          this.doRequest({
            clientRequestId,
            bodyJson,
            attempt,
            correlationId: meta.correlationId,
          }),
        { ...this.config.retry, deadline: meta.deadline }
      )
    );
  }

  private async doRequest(args: {
    clientRequestId: string;
    bodyJson: string;
    attempt: number;
    correlationId?: string;
  }): Promise<OrderResult> {
    const { clientRequestId, bodyJson, attempt, correlationId } = args;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${ORDERS_PATH}`;

    const headers = {
      'Content-Type': 'application/json',
      ...this.config.auth.buildHeaders(clientRequestId),
      ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
    };

    const startedAt = Date.now();
    this.log('info', {
      event: 'ch_orders.request',
      attempt,
      clientRequestId,
      correlationId,
      headers: redactHeaders(headers),
      body: redact(JSON.parse(bodyJson)),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyJson,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', {
        event: 'ch_orders.network_error',
        clientRequestId,
        correlationId,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw new NetworkError({ message, clientRequestId });
    }

    const durationMs = Date.now() - startedAt;
    let payload: CheckoutOrdersResponse;
    try {
      payload = (await response.json()) as CheckoutOrdersResponse;
    } catch {
      payload = {};
    }

    const apiTraceId = payload.gatewayResponse?.transactionProcessingDetails?.apiTraceId;

    if (!response.ok) {
      const firstError = payload.error?.[0];
      const err = errorFromHttpStatus(response.status, {
        message: firstError?.message ?? `Commerce Hub Orders returned HTTP ${response.status}`,
        status: response.status,
        apiTraceId,
        providerType: firstError?.type,
        providerCode: firstError?.code,
        field: firstError?.field,
        clientRequestId,
      });
      this.log('warn', {
        event: 'ch_orders.error',
        attempt,
        status: response.status,
        code: err.code,
        retryable: err.retryable,
        apiTraceId,
        clientRequestId,
        correlationId,
        durationMs,
      });
      throw err;
    }

    const orderId = payload.gatewayResponse?.transactionProcessingDetails?.orderId;
    const transactionId = payload.gatewayResponse?.transactionProcessingDetails?.transactionId;
    if (!orderId) {
      throw new CommerceHubError({
        code: 'VALIDATION_ERROR',
        message: 'Commerce Hub Orders response missing gatewayResponse.transactionProcessingDetails.orderId',
        status: response.status,
        apiTraceId,
        clientRequestId,
        retryable: false,
      });
    }

    const result: OrderResult = {
      orderId,
      transactionId,
      transactionState: payload.gatewayResponse?.transactionState,
      transactionType: payload.gatewayResponse?.transactionType,
      apiTraceId,
      clientRequestId,
      raw: payload,
    };

    this.log('info', {
      event: 'ch_orders.success',
      attempt,
      durationMs,
      clientRequestId,
      correlationId,
      apiTraceId,
      orderId,
      transactionState: result.transactionState,
    });

    return result;
  }

  private log(level: 'info' | 'warn' | 'error', obj: Record<string, unknown>): void {
    if (!this.config.logger) return;
    this.config.logger[level](obj);
  }
}
