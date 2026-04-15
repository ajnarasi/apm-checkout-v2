/**
 * v2.2 — Test harness scenario descriptors.
 *
 * Each scenario maps to:
 *   1. A short human-readable description the UI shows as a button label
 *   2. A set of synthetic CH orders-endpoint responses the route handlers
 *      emit when `HARNESS_MODE=true` and the frontend sends
 *      `X-Harness-Scenario: <id>`
 *   3. A list of state machine transitions + events the harness expects
 *      to observe (used by the UI to auto-assert test success)
 *   4. An optional webhook envelope the harness should inject after a delay
 *      to exercise async flows
 *
 * Adding a new scenario means editing only this file — no route changes.
 */

export type TerminalState =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_merchant_capture'
  | 'pending'
  | 'auth_expired'
  | 'script_load_failed';

export interface Scenario {
  id: string;
  title: string;
  category:
    | 'happy-path'
    | 'failure'
    | 'merchant-initiated'
    | 'async-webhook'
    | 'interactive-callback'
    | 'wallet'
    | 'resilience';
  description: string;
  /** Intent the harness should send on POST /v2/orders/:apm. */
  intent: 'SALE' | 'AUTHORIZE';
  /** What CH wire response the server should synthesize. */
  chResponse:
    | { kind: 'CAPTURED' }
    | { kind: 'AUTHORIZED' }
    | { kind: 'PAYER_ACTION_REQUIRED'; actionUrl?: string; qrCode?: string }
    | { kind: 'DECLINED'; reason: string }
    | { kind: 'NETWORK_TIMEOUT' }
    | { kind: 'SCRIPT_LOAD_FAILED' };
  /** Optional webhook the harness UI should schedule after the order returns. */
  webhook?: {
    delayMs: number;
    kind: 'AUTHORIZED' | 'CAPTURED' | 'DECLINED' | 'CANCELLED' | 'AUTH_EXPIRED';
    transactionState: string;
  };
  /** State machine states the harness expects to see, in order. */
  expectedStates: TerminalState[];
  /** Canonical events the harness expects to see before terminal. */
  expectedEvents: string[];
}

export const SCENARIOS: Scenario[] = [
  // ── Happy path ──
  {
    id: 'sale_ok',
    title: 'Sale → Captured',
    category: 'happy-path',
    description:
      'Gateway-initiated one-shot sale. CH returns CAPTURED immediately; state machine goes authorizing → completed.',
    intent: 'SALE',
    chResponse: { kind: 'CAPTURED' },
    expectedStates: ['completed'],
    expectedEvents: ['PAYMENT_AUTHORIZING', 'PAYMENT_AUTHORIZED', 'PAYMENT_COMPLETED'],
  },
  {
    id: 'sale_decline',
    title: 'Sale → Declined',
    category: 'failure',
    description:
      'CH returns DECLINED with a provider reason. Adapter emits PAYMENT_FAILED and the state machine terminates.',
    intent: 'SALE',
    chResponse: { kind: 'DECLINED', reason: 'INSUFFICIENT_FUNDS' },
    expectedStates: ['failed'],
    expectedEvents: ['PAYMENT_AUTHORIZING', 'PAYMENT_FAILED'],
  },
  {
    id: 'sale_timeout',
    title: 'Sale → Network timeout',
    category: 'resilience',
    description:
      'The reference server simulates a network timeout on the CH call. The circuit breaker notes the failure; the adapter surfaces PAYMENT_FAILED with a retryable error code.',
    intent: 'SALE',
    chResponse: { kind: 'NETWORK_TIMEOUT' },
    expectedStates: ['failed'],
    expectedEvents: ['PAYMENT_AUTHORIZING', 'PAYMENT_FAILED'],
  },
  {
    id: 'script_load_failed',
    title: 'Provider SDK load fails',
    category: 'resilience',
    description:
      'Synthetic failure of the provider CDN load step. Adapter terminates in script_load_failed (distinct from generic failed).',
    intent: 'SALE',
    chResponse: { kind: 'SCRIPT_LOAD_FAILED' },
    expectedStates: ['script_load_failed'],
    expectedEvents: ['INITIALIZING', 'SCRIPT_LOAD_FAILED'],
  },

  // ── Merchant-initiated separate capture ──
  {
    id: 'authorize_ok_capture_ok',
    title: 'Authorize → Capture',
    category: 'merchant-initiated',
    description:
      'Merchant-initiated auth-only. CH returns AUTHORIZED; state goes to awaiting_merchant_capture; harness calls capture() and state transitions to capturing → completed.',
    intent: 'AUTHORIZE',
    chResponse: { kind: 'AUTHORIZED' },
    expectedStates: ['awaiting_merchant_capture', 'completed'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'PAYMENT_AUTHORIZED',
      'AWAITING_MERCHANT_CAPTURE',
      'CAPTURING',
      'PAYMENT_COMPLETED',
    ],
  },
  {
    id: 'authorize_ok_partial_capture',
    title: 'Authorize → Partial capture',
    category: 'merchant-initiated',
    description:
      'Same as above but the capture request reduces the amount by 50%. Only works for APMs where partial_capture is supported.',
    intent: 'AUTHORIZE',
    chResponse: { kind: 'AUTHORIZED' },
    expectedStates: ['awaiting_merchant_capture', 'completed'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'PAYMENT_AUTHORIZED',
      'AWAITING_MERCHANT_CAPTURE',
      'CAPTURING',
      'PAYMENT_COMPLETED',
    ],
  },
  {
    id: 'authorize_ok_void',
    title: 'Authorize → Void',
    category: 'merchant-initiated',
    description:
      'Merchant-initiated auth followed by void (release the hold before capture). Terminal state is cancelled, not failed.',
    intent: 'AUTHORIZE',
    chResponse: { kind: 'AUTHORIZED' },
    expectedStates: ['awaiting_merchant_capture', 'cancelled'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'PAYMENT_AUTHORIZED',
      'AWAITING_MERCHANT_CAPTURE',
      'PAYMENT_CANCELLED',
    ],
  },
  {
    id: 'authorize_ok_auth_expires',
    title: 'Authorize → Auth TTL expires',
    category: 'merchant-initiated',
    description:
      'Merchant-initiated auth that never captures — harness advances the clock past authHoldTTL and observes auth_expired terminal.',
    intent: 'AUTHORIZE',
    chResponse: { kind: 'AUTHORIZED' },
    expectedStates: ['awaiting_merchant_capture', 'auth_expired'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'PAYMENT_AUTHORIZED',
      'AWAITING_MERCHANT_CAPTURE',
      'AUTH_EXPIRING',
      'AUTH_EXPIRED',
    ],
  },

  // ── Async webhook-driven completion ──
  {
    id: 'webhook_pending_then_complete',
    title: 'Redirect → Webhook COMPLETED',
    category: 'async-webhook',
    description:
      'CH returns PAYER_ACTION_REQUIRED with a redirect URL. State goes to pending. Harness injects a CAPTURED webhook after 800ms; state transitions to completed via the SSE stream (first-writer-wins).',
    intent: 'SALE',
    chResponse: {
      kind: 'PAYER_ACTION_REQUIRED',
      actionUrl: 'https://harness.example/redirect?id={{orderId}}',
    },
    webhook: { delayMs: 800, kind: 'CAPTURED', transactionState: 'CAPTURED' },
    expectedStates: ['pending', 'completed'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'REDIRECT_REQUIRED',
      'PAYMENT_PENDING',
      'PAYMENT_COMPLETED',
    ],
  },
  {
    id: 'webhook_pending_then_failed',
    title: 'Redirect → Webhook FAILED',
    category: 'async-webhook',
    description:
      'Pending → webhook injects DECLINED. State transitions pending → failed.',
    intent: 'SALE',
    chResponse: {
      kind: 'PAYER_ACTION_REQUIRED',
      actionUrl: 'https://harness.example/redirect?id={{orderId}}',
    },
    webhook: { delayMs: 800, kind: 'DECLINED', transactionState: 'DECLINED' },
    expectedStates: ['pending', 'failed'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'REDIRECT_REQUIRED',
      'PAYMENT_PENDING',
      'PAYMENT_FAILED',
    ],
  },
  {
    id: 'webhook_pending_then_cancelled',
    title: 'Redirect → Webhook CANCELLED',
    category: 'async-webhook',
    description:
      'Pending → user cancels at provider. Webhook injects CANCELLED; state transitions to cancelled.',
    intent: 'SALE',
    chResponse: {
      kind: 'PAYER_ACTION_REQUIRED',
      actionUrl: 'https://harness.example/redirect?id={{orderId}}',
    },
    webhook: { delayMs: 800, kind: 'CANCELLED', transactionState: 'CANCELLED' },
    expectedStates: ['pending', 'cancelled'],
    expectedEvents: [
      'PAYMENT_AUTHORIZING',
      'REDIRECT_REQUIRED',
      'PAYMENT_PENDING',
      'PAYMENT_CANCELLED',
    ],
  },

  // ── Refund ──
  {
    id: 'refund_ok',
    title: 'Refund (after capture)',
    category: 'merchant-initiated',
    description:
      'Full refund on an existing captured transaction. POST /v2/orders/:orderId/refund returns a synthesized CH refund response.',
    intent: 'SALE',
    chResponse: { kind: 'CAPTURED' },
    expectedStates: ['completed'],
    expectedEvents: ['PAYMENT_AUTHORIZING', 'PAYMENT_COMPLETED'],
  },

  // ── Interactive callbacks ──
  {
    id: 'shipping_address_change',
    title: 'Shipping address change (Apple/Google/PayPal)',
    category: 'interactive-callback',
    description:
      'Simulates a shipping-address-selected wallet event. The harness posts a recomputed total back through the interactive callback bus and asserts the wallet receives the update.',
    intent: 'SALE',
    chResponse: { kind: 'CAPTURED' },
    expectedStates: ['completed'],
    expectedEvents: ['PAYMENT_METHOD_READY', 'PAYMENT_COMPLETED'],
  },
  {
    id: 'coupon_applied',
    title: 'Coupon applied mid-checkout',
    category: 'interactive-callback',
    description:
      'Harness emits a coupon code; the adapter applies it and recomputes the total. Asserts the wallet sheet re-renders with the discount.',
    intent: 'SALE',
    chResponse: { kind: 'CAPTURED' },
    expectedStates: ['completed'],
    expectedEvents: ['PAYMENT_METHOD_READY', 'PAYMENT_COMPLETED'],
  },

  // ── Wallet specifics ──
  {
    id: 'single_use_token_retry',
    title: 'Wallet token consumed → restart',
    category: 'wallet',
    description:
      'Apple/Google Pay single-use token fails at CH. The adapter must restart from ready (not failed) so the user can re-authorize from the wallet sheet.',
    intent: 'SALE',
    chResponse: { kind: 'DECLINED', reason: 'TOKEN_CONSUMED' },
    expectedStates: ['failed'],
    expectedEvents: ['PAYMENT_AUTHORIZING', 'PAYMENT_FAILED'],
  },
  {
    id: 'merchant_validation',
    title: 'Apple Pay merchant validation round-trip',
    category: 'wallet',
    description:
      'Apple Pay onvalidatemerchant flow. Harness POSTs the validation URL; reference server returns a stub merchant session (requires real cert signing in production).',
    intent: 'SALE',
    chResponse: { kind: 'CAPTURED' },
    expectedStates: ['completed'],
    expectedEvents: ['PAYMENT_METHOD_READY', 'PAYMENT_COMPLETED'],
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
