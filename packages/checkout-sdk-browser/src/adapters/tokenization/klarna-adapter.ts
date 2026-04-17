/**
 * Klarna — REAL hero adapter (v2.1).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  Global
 * Spec:    https://docs.klarna.com/in-app/javascript-sdk-reference/
 *
 * Real-SDK pattern: this file is a copy-paste-ready reference for engineering
 * teams integrating Klarna via Commerce Hub. It contains REAL Klarna JS SDK
 * calls. The network call to CH (via merchant backend) can be mocked in tests
 * via the provider fake at `testing/provider-fakes/klarna.ts`, but the SDK
 * code itself is production-shaped.
 *
 * Flow:
 *   1. STEP 1 — load `https://x.klarnacdn.net/kp/lib/v1/api.js` from CDN
 *   2. STEP 2 — call `window.Klarna.Payments.init({ client_token })` with the
 *               `providerClientToken` returned by the merchant backend's
 *               POST /v2/sessions (which CH provides via the Credentials API)
 *   3. STEP 3 — call `Klarna.Payments.load({ container, payment_method_category })`
 *               to mount the widget into the merchant's `containerId`
 *   4. STEP 4 — wait for user to click Pay → call `Klarna.Payments.authorize(...)`
 *               which runs Klarna's UI, returns `{ approved, authorization_token }`
 *   5. STEP 5 — forward `authorization_token` to merchant backend via
 *               sessionClient.authorizeOrder (which calls CH /checkouts/v1/orders)
 *
 * Merchant-initiated capture: Klarna BNPL supports auth-only flow. When
 * `paymentInitiator='MERCHANT'`, the SDK transitions to
 * `awaiting_merchant_capture` and waits for the merchant to call
 * `checkout.capture()`. See AdapterCapabilities.intents below.
 *
 * Token TTL: Klarna authorization_token is valid for ~60 minutes. The
 * SessionClient enforces this via the AdapterCapabilities.token.tokenTTLMs.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { BnplToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

// ──────────────────── Provider SDK type definitions ────────────────────
// We declare the minimal Klarna global so TS doesn't need @types/klarna.
// In a production codebase you'd publish these as @commercehub/klarna-types.

interface KlarnaPayments {
  init(opts: { client_token: string }): void;
  load(
    opts: { container: string; payment_method_category?: string },
    cb: (res: { show_form: boolean; error?: { invalid_fields?: string[] } }) => void
  ): void;
  authorize(
    opts: { payment_method_category?: string; auto_finalize?: boolean },
    data: Record<string, unknown>,
    cb: (res: {
      approved: boolean;
      show_form?: boolean;
      authorization_token?: string;
      finalize_required?: boolean;
      error?: { invalid_fields?: string[] };
    }) => void
  ): void;
}

declare global {
  interface Window {
    Klarna?: { Payments: KlarnaPayments };
  }
}

const KLARNA_SDK_URL = 'https://x.klarnacdn.net/kp/lib/v1/api.js';
const KLARNA_GLOBAL = 'Klarna';

// ──────────────────── Adapter ────────────────────

export class KlarnaAdapter extends TokenizationAdapterBase {
  readonly id = 'klarna';
  readonly displayName = 'Klarna';
  readonly pattern = 'server-bnpl' as const;

  /** Klarna offers multiple payment method categories — pay_now, pay_later, pay_over_time. */
  private paymentMethodCategory = 'pay_later';

  /** AdapterCapabilities declared co-located so it cannot be forgotten. */
  static readonly capabilities: AdapterCapabilities = {
    pattern: 'bnpl',
    displayName: 'Klarna',
    region: 'Global',
    callbacks: defaultCallbacks('bnpl'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: KLARNA_SDK_URL,
      globalVariable: KLARNA_GLOBAL,
      providerSdkVersion: 'kp/lib/v1',
    },
    ui: {
      providesButton: false,
      providesIcon: true,
      providesBrandedColors: true,
      requiresMerchantCapabilityCheck: false,
      requiresDomainVerification: false,
    },
    handoff: {
      requiresMerchantValidation: false,
      requiresWebhook: true,
    },
    bnpl: {
      providesPromoWidget: true, // Klarna placements ("On-site messaging")
      providesPriceTagMessaging: true,
      paymentTimeoutBudgetMs: 30 * 60 * 1000, // 30 min UI timeout
      authHoldTTLMs: 7 * 24 * 60 * 60 * 1000, // 7 days auth hold
    },
    interactive: defaultInteractive(),
    intents: {
      supportsGatewayInitiated: true,
      supportsMerchantInitiated: true, // Klarna supports auth-then-capture
      supportsSeparateCapture: true,
      supportsVoid: true,
      supportsRefund: true,
      supportsPartialCapture: true, // Klarna allows multiple captures
      defaultInitiator: 'GATEWAY',
    },
    token: {
      singleUse: true,
      tokenTTLMs: 60 * 60 * 1000, // 60 min
    },
    eligibility: {
      supportedCurrencies: [
        'USD', 'EUR', 'GBP', 'SEK', 'NOK', 'DKK', 'AUD', 'NZD', 'CAD', 'CHF', 'PLN',
      ],
      supportedCountries: [
        'US', 'GB', 'DE', 'AT', 'CH', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI',
        'IT', 'ES', 'FR', 'AU', 'NZ', 'CA', 'IE', 'PT', 'CZ', 'PL',
      ],
      supportedLocales: ['en-US', 'en-GB', 'de-DE', 'sv-SE', 'da-DK', 'nl-NL'],
    },
    csp: {
      scriptOrigins: ['https://x.klarnacdn.net'],
      frameOrigins: ['https://x.klarnacdn.net', 'https://js.klarna.com'],
      connectOrigins: ['https://js.klarna.com', 'https://api.klarna.com'],
    },
    amountTransform: 'MULTIPLY_100',
  };

  // ──────────────────── lifecycle ────────────────────

  /** STEP 1 — Load the Klarna JS SDK from CDN. */
  override async loadSDK(): Promise<void> {
    try {
      await loadScript({
        url: KLARNA_SDK_URL,
        globalCheck: () => typeof window !== 'undefined' && !!window.Klarna,
        crossOrigin: 'anonymous',
        timeoutMs: 15000,
      });
    } catch (err) {
      // Surface as the distinct script_load_failed terminal state per ADR-003.
      // BaseAdapter.fail() observes the throw and the state machine routes to
      // initializing → script_load_failed via the legal transition.
      if (err instanceof ScriptLoadError) {
        throw err;
      }
      throw new ScriptLoadError(
        KLARNA_SDK_URL,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /** STEP 2 — Initialize Klarna with the provider client token from the session. */
  protected override async doInit(
    config: Parameters<TokenizationAdapterBase['init']>[0],
    _ctx: Parameters<TokenizationAdapterBase['init']>[1]
  ): Promise<void> {
    const clientToken = config.credentials.providerClientToken;
    if (!clientToken) {
      throw new Error(
        'Klarna requires `credentials.providerClientToken` from the merchant backend. ' +
          'POST /v2/sessions must pass through Klarna client_token from the CH Credentials response.'
      );
    }
    if (typeof window === 'undefined' || !window.Klarna) {
      throw new Error('Klarna SDK was not loaded — loadSDK() must run first');
    }

    // Optional adapter override for payment method category (pay_now | pay_later | slice_it).
    const adapterOpts = config.adapterOptions as { paymentMethodCategory?: string } | undefined;
    if (adapterOpts?.paymentMethodCategory) {
      this.paymentMethodCategory = adapterOpts.paymentMethodCategory;
    }

    window.Klarna.Payments.init({ client_token: clientToken });
  }

  /** STEP 3 — Mount the Klarna widget into the merchant's containerId. */
  protected override async doRender(): Promise<void> {
    if (!this.config.containerId) {
      throw new Error('Klarna requires `containerId` to mount the widget');
    }
    if (typeof window === 'undefined' || !window.Klarna) {
      throw new Error('Klarna SDK not available');
    }

    await new Promise<void>((resolve, reject) => {
      window.Klarna!.Payments.load(
        {
          container: `#${this.config.containerId}`,
          payment_method_category: this.paymentMethodCategory,
        },
        (res) => {
          if (!res.show_form) {
            reject(
              new Error(
                `Klarna.Payments.load failed: invalid_fields=${
                  res.error?.invalid_fields?.join(',') ?? 'unknown'
                }`
              )
            );
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * STEP 4 — Call Klarna.Payments.authorize() to run the user-facing flow.
   * Returns the authorization_token wrapped in a BnplToken.
   */
  protected override async tokenize(): Promise<BnplToken> {
    if (typeof window === 'undefined' || !window.Klarna) {
      throw new Error('Klarna SDK not available');
    }

    const klarnaResult = await new Promise<{
      approved: boolean;
      authorization_token?: string;
      error?: { invalid_fields?: string[] };
    }>((resolve) => {
      window.Klarna!.Payments.authorize(
        {
          payment_method_category: this.paymentMethodCategory,
          auto_finalize: true,
        },
        // STEP 4a — Klarna's data envelope. Production code should pass the full
        // billing/shipping/order objects per Klarna's API docs. For the POC we
        // pass the merchant order id only.
        {
          merchant_reference1: this.config.merchantOrderId,
          customer: this.config.customer,
        },
        (res) => resolve(res)
      );
    });

    if (!klarnaResult.approved || !klarnaResult.authorization_token) {
      throw new KlarnaAuthorizeError(
        klarnaResult.error?.invalid_fields?.join(',') ?? 'declined'
      );
    }

    return {
      kind: 'bnpl',
      provider: 'klarna',
      payload: {
        authorizationToken: klarnaResult.authorization_token,
      },
    };
  }

  // ──────────────────── merchant-initiated capture/void ────────────────────

  /**
   * v2.1 merchant-initiated capture. Only valid when the previous authorize()
   * returned an OrderResult with paymentInitiator=MERCHANT and the state
   * machine is in `awaiting_merchant_capture`.
   *
   * Reads the cached referenceTransactionId from the BaseAdapter's
   * AwaitingMerchantCapture context (set by AdapterEventEmitter when the
   * state machine transitioned).
   */
  async capture(): Promise<void> {
    const { sessionClient } = this.ctx;
    const refId = this.captureContext.referenceTransactionId;
    const orderId = this.captureContext.orderId;
    if (!refId || !orderId) {
      throw new Error(
        'Klarna.capture() called before awaiting_merchant_capture state — no referenceTransactionId available'
      );
    }
    // Drive the state machine to `capturing`.
    this.sm.transition('capturing');
    try {
      const result = await sessionClient.captureOrder(orderId, {
        referenceTransactionId: refId,
        amount: this.config.amount,
      });
      if (result.status === 'authorized' || result.status === 'captured') {
        this.emitter.setContext({ orderResult: result });
        this.sm.transition('completed');
      } else {
        this.emitter.setContext({
          error: result.error ?? { code: 'PROVIDER_REJECTED', message: 'Capture failed' },
        });
        this.sm.transition('failed');
      }
    } catch (err) {
      this.emitter.setContext({
        error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
      this.sm.transition('failed');
      throw err;
    }
  }

  /** v2.1 merchant-initiated void. */
  async void(reason = 'merchant cancelled'): Promise<void> {
    const { sessionClient } = this.ctx;
    const refId = this.captureContext.referenceTransactionId;
    const orderId = this.captureContext.orderId;
    if (!refId || !orderId) {
      throw new Error(
        'Klarna.void() called outside of awaiting_merchant_capture / pending state'
      );
    }
    try {
      await sessionClient.voidOrder(orderId, { referenceTransactionId: refId, reason });
    } finally {
      this.emitter.setContext({ cancellationReason: reason });
      this.sm.transition('cancelled');
    }
  }

  /**
   * Capture context — populated by the state machine `awaiting_merchant_capture`
   * transition handler. Stored as adapter-local state so capture()/void() can
   * find the referenceTransactionId without re-querying.
   *
   * For the v2.1 hero, BaseAdapter v2.1 will populate this from the OrderResult
   * the sync authorize() returned. For now, the adapter is structured to read
   * from this.config.adapterOptions as a fallback during early integration.
   */
  private get captureContext(): { referenceTransactionId?: string; orderId?: string } {
    const opts = this.config.adapterOptions as
      | { referenceTransactionId?: string; orderId?: string }
      | undefined;
    return {
      referenceTransactionId: opts?.referenceTransactionId,
      orderId: opts?.orderId,
    };
  }
}

/**
 * Distinct error class so reference-server logs can segment Klarna decline
 * reasons separately from generic adapter errors.
 */
export class KlarnaAuthorizeError extends Error {
  readonly invalidFields?: string;
  constructor(invalidFields?: string) {
    super(
      `Klarna declined authorization${invalidFields ? `: invalid_fields=${invalidFields}` : ''}`
    );
    this.name = 'KlarnaAuthorizeError';
    this.invalidFields = invalidFields;
  }
}
