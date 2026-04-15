/**
 * Browser SDK types.
 *
 * The v2 `CheckoutConfig` differs from v1 in ONE critical way:
 * `credentials.accessToken` is REQUIRED. The merchant must call
 * their backend's POST /v2/sessions endpoint before initializing
 * the SDK. This enforces the Stripe / Braintree / Adyen pattern
 * at the type level.
 */

import type {
  CheckoutEvent,
  OrderResult,
  SessionResponse,
} from '@commercehub/shared-types';

export type APMPattern =
  | 'server-bnpl'
  | 'redirect-wallet'
  | 'bank-redirect'
  | 'qr-code'
  | 'voucher-cash'
  | 'native-wallet';

export interface CheckoutCredentials {
  /** REQUIRED — obtained from merchant backend POST /v2/sessions. */
  accessToken: string;
  /** Opaque session id used for SSE webhook streaming. */
  sessionId: string;
  /** Base URL for Commerce Hub's orders endpoint. Usually set by merchant backend. */
  chBaseUrl: string;
  /** Optional provider client token (Klarna client_token, PayPal client-id, etc). */
  providerClientToken?: string;
  /** Optional merchant backend base URL for SSE /v2/events/:sessionId. */
  eventsBaseUrl?: string;
}

export interface CheckoutConfig {
  /** APM code — must match a registered adapter id. */
  apm: string;
  /** DOM container id for widget-mounting adapters. */
  containerId?: string;
  /** Amount + currency, denominated in the major unit (e.g. 49.99). */
  amount: {
    value: number;
    currency: string;
  };
  /** Pre-created session credentials. REQUIRED in v2. */
  credentials: CheckoutCredentials;
  /** Merchant-generated order id for CH correlation. */
  merchantOrderId: string;
  /** Customer — passed through to provider widgets that need it. */
  customer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  /** Where to send the user on redirect-wallet / bank-redirect patterns. */
  returnUrls?: {
    successUrl: string;
    cancelUrl: string;
  };
  /** Locale hint for provider widgets. */
  locale?: string;
  /** Per-adapter pass-through config — untyped by design. */
  adapterOptions?: Record<string, unknown>;
}

/**
 * Adapter lifecycle methods. Implementations inherit most behavior
 * from BaseAdapter via composition (state machine + event emitter +
 * validator) — subclasses usually only override 3-5 methods.
 */
export interface APMAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly pattern: APMPattern;

  /** Load any provider SDK (e.g. Klarna CDN script). May be no-op. */
  loadSDK(): Promise<void>;

  /** Initialize the adapter with config + injected session client. */
  init(config: CheckoutConfig, ctx: AdapterContext): Promise<void>;

  /** Render any widget / button. May be no-op for redirect flows. */
  render(): Promise<void>;

  /** Authorize — either returns a sync result or transitions to pending. */
  authorize(): Promise<OrderResult>;

  /** Called on SDK destroy. Clean up timers, listeners, DOM. */
  teardown(): Promise<void>;
}

/** Context passed into adapter init() — provides collaborators. */
export interface AdapterContext {
  sessionClient: import('./session-client.js').SessionClient;
  eventBus: import('./event-bus.js').EventBus<CheckoutEvent>;
  webhookListener?: import('./webhook-listener.js').WebhookListener;
}

export type { CheckoutEvent, OrderResult, SessionResponse };
