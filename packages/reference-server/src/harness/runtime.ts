/**
 * v2.2 — Harness runtime helpers used by routes/sessions.ts and routes/orders.ts
 * to short-circuit Commerce Hub calls with deterministic, scenario-driven
 * responses when `env.harnessMode` is true.
 *
 * Kept out of the route files so the production-path routes stay legible —
 * they just call `if (ctx.env.harnessMode) return harnessXxx(...)` and return.
 */

import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { getScenario } from './scenarios.js';
import type { ApmCommerceHubMapping } from '@commercehub/shared-types';

/** Scenario id comes from the `X-Harness-Scenario` request header. */
export function scenarioFromRequest(req: Request): string {
  const raw = req.header('x-harness-scenario') ?? 'sale_ok';
  return raw.trim().toLowerCase() || 'sale_ok';
}

// ────────────────────────────────────────────────────────────────────────
// POST /v2/sessions (harness mode)
// ────────────────────────────────────────────────────────────────────────

export function harnessSessionResponse(input: {
  apm: string;
  currency: string;
  amountMinor: number;
}) {
  return {
    accessToken: `harness-token-${randomUUID()}`,
    sessionId: `harness-sess-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    providerClientToken: `harness-provider-client-token-${input.apm}`,
    apm: input.apm,
    currency: input.currency,
    amountMinor: input.amountMinor,
  };
}

// ────────────────────────────────────────────────────────────────────────
// POST /v2/orders/:apm (harness mode)
// ────────────────────────────────────────────────────────────────────────
//
// Returns a synthesized `CheckoutOrdersResponse` that matches the shape
// produced by CheckoutOrdersClient.authorize() / .sale(). The harness UI
// reads `gatewayResponse.transactionState` to drive its state machine.

interface HarnessOrderInput {
  apm: string;
  mapping: ApmCommerceHubMapping;
  merchantOrderId: string;
  amountMinor: number;
  currency: string;
  scenarioId: string;
  intent: 'AUTHORIZE' | 'SALE';
  correlationId?: string;
  paymentInitiator: 'GATEWAY' | 'MERCHANT';
}

export function harnessOrderResponse(input: HarnessOrderInput) {
  const scenario = getScenario(input.scenarioId);
  const orderId = `harness-order-${randomUUID()}`;
  const transactionId = `harness-txn-${randomUUID()}`;
  const apiTraceId = input.correlationId ?? randomUUID();

  const baseEnvelope = {
    gatewayResponse: {
      transactionProcessingDetails: {
        orderId,
        transactionId,
        apiTraceId,
        clientRequestId: apiTraceId,
        transactionTimestamp: new Date().toISOString(),
      },
      transactionState: 'CAPTURED',
      transactionType: input.intent,
    },
    paymentMethod: input.mapping.chProvider
      ? { provider: input.mapping.chProvider }
      : undefined,
    paymentSource: {
      sourceType: input.mapping.chSourceType,
      walletType: input.mapping.chWalletType,
    },
    order: {
      orderId,
      intent: input.intent,
    },
    amount: { total: input.amountMinor, currency: input.currency },
  };

  if (!scenario) {
    return { status: 200, body: baseEnvelope };
  }

  const r = scenario.chResponse;

  switch (r.kind) {
    case 'CAPTURED':
      return {
        status: 200,
        body: {
          ...baseEnvelope,
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'CAPTURED',
          },
        },
      };

    case 'AUTHORIZED':
      return {
        status: 200,
        body: {
          ...baseEnvelope,
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'AUTHORIZED',
          },
        },
      };

    case 'PAYER_ACTION_REQUIRED':
      return {
        status: 200,
        body: {
          ...baseEnvelope,
          order: {
            ...baseEnvelope.order,
            orderStatus: 'PAYER_ACTION_REQUIRED',
          },
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'PAYER_ACTION_REQUIRED',
          },
          checkoutInteractions: {
            actions: {
              type: 'WEB_REDIRECTION',
              url: (r.actionUrl ?? 'https://harness.example/redirect').replace(
                '{{orderId}}',
                orderId
              ),
              code: r.qrCode,
            },
          },
        },
      };

    case 'DECLINED':
      return {
        status: 200,
        body: {
          ...baseEnvelope,
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'DECLINED',
          },
          error: [
            {
              type: 'PROVIDER',
              code: 'PROVIDER_REJECTED',
              message: r.reason,
            },
          ],
        },
      };

    case 'NETWORK_TIMEOUT':
      return {
        status: 504,
        body: {
          ...baseEnvelope,
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'DECLINED',
          },
          error: [
            {
              type: 'GATEWAY',
              code: 'NETWORK_TIMEOUT',
              message: 'Synthetic network timeout from harness',
            },
          ],
        },
      };

    case 'SCRIPT_LOAD_FAILED':
      // Server-side can't actually fail a client CDN load — the harness UI
      // simulates this one without calling the backend. But to keep the UI
      // flow consistent we return a DECLINED shape with a distinct code.
      return {
        status: 200,
        body: {
          ...baseEnvelope,
          gatewayResponse: {
            ...baseEnvelope.gatewayResponse,
            transactionState: 'DECLINED',
          },
          error: [
            {
              type: 'CLIENT',
              code: 'SCRIPT_LOAD_FAILED',
              message: 'Provider CDN load failed (synthetic)',
            },
          ],
        },
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// POST /v2/orders/:orderId/(capture|void|refund) (harness mode)
// ────────────────────────────────────────────────────────────────────────

export function harnessReferenceOpResponse(input: {
  operation: 'capture' | 'void' | 'refund';
  orderId: string;
  referenceTransactionId: string;
  amountMinor?: number;
  currency?: string;
  correlationId?: string;
}) {
  const apiTraceId = input.correlationId ?? randomUUID();
  const newTransactionId = `harness-txn-${randomUUID()}`;

  const stateByOp: Record<string, string> = {
    capture: 'CAPTURED',
    void: 'VOIDED',
    refund: 'REFUNDED',
  };

  return {
    status: 200,
    body: {
      gatewayResponse: {
        transactionProcessingDetails: {
          orderId: input.orderId,
          transactionId: newTransactionId,
          apiTraceId,
          clientRequestId: apiTraceId,
          transactionTimestamp: new Date().toISOString(),
        },
        transactionState: stateByOp[input.operation],
        transactionType: input.operation.toUpperCase(),
      },
      referenceTransactionDetails: {
        referenceTransactionId: input.referenceTransactionId,
      },
      amount: input.amountMinor
        ? { total: input.amountMinor, currency: input.currency }
        : undefined,
    },
  };
}
