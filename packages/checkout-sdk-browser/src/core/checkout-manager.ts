/**
 * CheckoutManager — top-level entry point exposed via `createCheckout()`.
 *
 * Adapted from v1 with one critical change: instead of the SDK fetching
 * its own session from a merchant-convention path, the manager REQUIRES
 * a pre-created session token in `config.credentials.accessToken` and
 * constructs a `SessionClient` from it. This is the one-line difference
 * between v1's "non-standard" pattern and v2's industry-standard pattern.
 */

import type { CheckoutEvent } from '@commercehub/shared-types';
import type { APMAdapter, CheckoutConfig } from './types.js';
import { getAdapter } from './adapter-registry.js';
import { EventBus } from './event-bus.js';
import { SessionClient } from './session-client.js';
import { WebhookListener } from './webhook-listener.js';
import { AdapterValidator } from './adapter-validator.js';

export interface CheckoutHandle {
  /** Underlying adapter — exposed for advanced cases / tests. */
  adapter: APMAdapter;
  /** Subscribe to checkout events. */
  on(type: CheckoutEvent['type'], listener: (e: CheckoutEvent) => void): () => void;
  /** Subscribe to all events. */
  onAny(listener: (e: CheckoutEvent) => void): () => void;
  /** Initialize the adapter (loadSDK + setup state). */
  init(): Promise<void>;
  /** Render any widget. */
  render(): Promise<void>;
  /** Authorize the payment. */
  authorize(): Promise<void>;
  /**
   * v2.1: explicit capture for merchant-initiated flows.
   *
   * Only valid in the `awaiting_merchant_capture` state. Use after a
   * `paymentInitiator='MERCHANT'` authorize when the merchant has completed
   * its business logic (fraud check, inventory hold, etc.) and is ready to
   * settle the payment.
   *
   * Throws if called outside of `awaiting_merchant_capture`.
   */
  capture(): Promise<void>;
  /**
   * v2.1: explicit void for merchant-initiated flows.
   *
   * Cancels an auth before settlement. Valid in `awaiting_merchant_capture`
   * or `pending`. Throws otherwise.
   */
  void(reason?: string): Promise<void>;
  /** Tear down the adapter and event subscriptions. */
  destroy(): Promise<void>;
}

/**
 * Create a checkout instance. Validates config, picks the right adapter,
 * wires the SessionClient + EventBus + (optional) WebhookListener,
 * and returns a handle.
 */
export function createCheckout(config: CheckoutConfig): CheckoutHandle {
  // Validate config up-front so we fail loudly before async work begins.
  new AdapterValidator().validate(config);

  const adapter = getAdapter(config.apm);
  const eventBus = new EventBus<CheckoutEvent>();

  const sessionClient = new SessionClient({
    accessToken: config.credentials.accessToken,
    baseUrl: config.credentials.chBaseUrl,
  });

  // Async adapters (bank-redirect, voucher-cash, qr-code, server-bnpl, redirect-wallet)
  // need a webhook listener. Sync adapters (native-wallet) don't.
  let webhookListener: WebhookListener | undefined;
  const eventsBaseUrl = config.credentials.eventsBaseUrl ?? config.credentials.chBaseUrl;
  if (needsWebhooks(adapter.pattern)) {
    webhookListener = new WebhookListener({
      baseUrl: eventsBaseUrl,
      sessionId: config.credentials.sessionId,
      onWebhook: () => {
        // BaseAdapter wires itself into this onWebhook via composition
      },
    });
  }

  const handle: CheckoutHandle = {
    adapter,
    on: (type, listener) => eventBus.on(type, listener),
    onAny: (listener) => eventBus.onAny(listener),
    init: async () => {
      await adapter.init(config, {
        sessionClient,
        eventBus,
        webhookListener,
      });
      webhookListener?.start();
    },
    render: () => adapter.render(),
    authorize: async () => {
      await adapter.authorize();
    },
    capture: async () => {
      // The adapter exposes capture/void via its own methods if it implements
      // the merchant-initiated lifecycle. The BaseAdapter v2.1 update will add
      // these — for v2.1 hero adapters they delegate to sessionClient.captureOrder.
      const capturable = adapter as APMAdapter & {
        capture?: () => Promise<void>;
      };
      if (typeof capturable.capture !== 'function') {
        throw new Error(
          `${adapter.id}: adapter does not implement merchant-initiated capture(). ` +
            `Set credentials.paymentInitiator='GATEWAY' on session creation, or use a ` +
            `hero adapter (Klarna, PayPal, Apple Pay) that supports merchant-initiated flows.`
        );
      }
      await capturable.capture();
    },
    void: async (reason?: string) => {
      const voidable = adapter as APMAdapter & {
        void?: (reason?: string) => Promise<void>;
      };
      if (typeof voidable.void !== 'function') {
        throw new Error(
          `${adapter.id}: adapter does not implement void(). ` +
            `Use capture() if the auth is still valid, or destroy() to tear down.`
        );
      }
      await voidable.void(reason);
    },
    destroy: async () => {
      webhookListener?.stop();
      await adapter.teardown();
    },
  };

  return handle;
}

function needsWebhooks(pattern: APMAdapter['pattern']): boolean {
  return pattern !== 'native-wallet';
}
