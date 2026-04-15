/**
 * Wire event types — the canonical event vocabulary emitted by the
 * browser SDK's AdapterEventEmitter and observed by merchant frontends.
 *
 * These are the ONLY events a merchant integration should listen for.
 * Each event corresponds to a state transition in AdapterStateMachine.
 * Terminal events (PAYMENT_COMPLETED, PAYMENT_FAILED, PAYMENT_CANCELLED)
 * are emitted from exactly one path: the state machine. Neither the
 * HTTP response handler nor the WebhookListener emits terminal events
 * directly — they only drive state transitions.
 */

import type { OrderResult, OrderError } from './order-result.js';

export type CheckoutEventType =
  | 'INITIALIZING'
  | 'SDK_LOADED'
  | 'PAYMENT_METHOD_READY'
  | 'PAYMENT_AUTHORIZING'
  | 'REDIRECT_REQUIRED'
  | 'PAYMENT_PENDING' // async APM, awaiting webhook
  | 'PAYMENT_AUTHORIZED' // sync success (auth-only, paymentInitiator=GATEWAY)
  // ── ADR-003 v2.1 additions ──
  | 'AWAITING_MERCHANT_CAPTURE' // auth-only success, paymentInitiator=MERCHANT, waiting for capture()
  | 'CAPTURING' // merchant.capture() in flight
  | 'AUTH_EXPIRING' // T-24h warning before authHoldTTL elapses
  | 'AUTH_EXPIRED' // terminal: TTL elapsed before merchant captured
  | 'SCRIPT_LOAD_FAILED' // terminal: provider CDN load failed (distinct from generic failed)
  // ── Original terminal events ──
  | 'PAYMENT_COMPLETED' // terminal: auth+capture or webhook-confirmed
  | 'PAYMENT_FAILED' // terminal: declined or error
  | 'PAYMENT_CANCELLED'; // terminal: user cancelled OR explicit void

export interface CheckoutEventBase {
  type: CheckoutEventType;
  apm: string;
  sessionId: string;
  correlationId: string;
  timestamp: number;
}

export interface PaymentMethodReadyEvent extends CheckoutEventBase {
  type: 'PAYMENT_METHOD_READY';
}

export interface RedirectRequiredEvent extends CheckoutEventBase {
  type: 'REDIRECT_REQUIRED';
  redirectUrl: string;
  returnUrl?: string;
}

export interface PaymentPendingEvent extends CheckoutEventBase {
  type: 'PAYMENT_PENDING';
  orderId: string;
  /** Time after which the pending state should be considered expired. */
  expiresAt?: number;
}

export interface PaymentCompletedEvent extends CheckoutEventBase {
  type: 'PAYMENT_COMPLETED';
  result: OrderResult;
}

export interface PaymentFailedEvent extends CheckoutEventBase {
  type: 'PAYMENT_FAILED';
  error: OrderError;
}

export interface PaymentCancelledEvent extends CheckoutEventBase {
  type: 'PAYMENT_CANCELLED';
  reason?: string;
}

// ── ADR-003 v2.1 event payloads ──

export interface AwaitingMerchantCaptureEvent extends CheckoutEventBase {
  type: 'AWAITING_MERCHANT_CAPTURE';
  /** CH-generated transactionId — pass to capture() / void() as referenceTransactionId. */
  referenceTransactionId: string;
  /** CH-generated orderId. */
  orderId: string;
  /** Unix epoch ms when the auth hold expires. */
  authHoldExpiresAt: number;
}

export interface CapturingEvent extends CheckoutEventBase {
  type: 'CAPTURING';
  referenceTransactionId: string;
  orderId: string;
}

export interface AuthExpiringEvent extends CheckoutEventBase {
  type: 'AUTH_EXPIRING';
  /** Time remaining (ms) before TTL elapses. */
  remainingMs: number;
  referenceTransactionId: string;
  orderId: string;
}

export interface AuthExpiredEvent extends CheckoutEventBase {
  type: 'AUTH_EXPIRED';
  referenceTransactionId: string;
  orderId: string;
}

export interface ScriptLoadFailedEvent extends CheckoutEventBase {
  type: 'SCRIPT_LOAD_FAILED';
  scriptUrl: string;
  reason: string;
}

export type CheckoutEvent =
  | (CheckoutEventBase & {
      type: 'INITIALIZING' | 'SDK_LOADED' | 'PAYMENT_AUTHORIZING' | 'PAYMENT_AUTHORIZED';
    })
  | PaymentMethodReadyEvent
  | RedirectRequiredEvent
  | PaymentPendingEvent
  | AwaitingMerchantCaptureEvent
  | CapturingEvent
  | AuthExpiringEvent
  | AuthExpiredEvent
  | ScriptLoadFailedEvent
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | PaymentCancelledEvent;

/**
 * Webhook envelope delivered via SSE from the reference server to the
 * browser SDK's WebhookListener. The listener drives state transitions;
 * it does NOT emit CheckoutEvents directly.
 */
export type WebhookKind =
  /** Auth-only succeeded — only fires for paymentInitiator=MERCHANT flows. */
  | 'payment.authorized'
  /** Sale or capture succeeded — terminal. */
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.cancelled'
  /** Async session expired before user completed authorization. */
  | 'payment.expired';

export interface WebhookEnvelope {
  /** Matches the EventSource `event:` field and SSE `id:` field. */
  id: string;
  sessionId: string;
  provider: string;
  kind: WebhookKind;
  orderId: string;
  /**
   * CH transactionId — required when kind=payment.authorized so the browser
   * SDK can pass it as referenceTransactionId to a subsequent capture() call.
   */
  referenceTransactionId?: string;
  occurredAt: number;
  /** Unstructured provider payload for adapters that need extra context. */
  raw?: Record<string, unknown>;
}
