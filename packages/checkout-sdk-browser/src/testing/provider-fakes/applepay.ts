/**
 * Apple Pay provider fake — installs `window.ApplePaySession` with deterministic
 * test responses. Lets unit tests exercise the real `applepay-adapter.ts` flow
 * without an actual Safari + Apple Pay device.
 */

export interface ApplePayFakeConfig {
  /** Whether canMakePayments() returns true. Default true. */
  canMakePayments?: boolean;
  /** Whether onpaymentauthorized fires (true) or oncancel does (false). Default true. */
  approves?: boolean;
  /** Fake merchant session payload returned to onvalidatemerchant. */
  merchantSession?: Record<string, unknown>;
  /** Fake encrypted payment data. Default 'apple-fake-paymentData-1'. */
  paymentData?: string;
  /** Fake card network. Default 'visa'. */
  network?: string;
  /** Whether merchant validation should succeed via stub fetch. Default true. */
  validateSucceeds?: boolean;
}

let originalApplePay: unknown;
let originalFetch: typeof fetch | undefined;

export function installApplePayFake(config: ApplePayFakeConfig = {}): void {
  if (typeof window === 'undefined') return;
  originalApplePay = (window as unknown as Record<string, unknown>).ApplePaySession;

  const cfg = {
    canMakePayments: true,
    approves: true,
    merchantSession: { merchantSession: 'fake' },
    paymentData: 'apple-fake-paymentData-1',
    network: 'visa',
    validateSucceeds: true,
    ...config,
  };

  // Stub fetch for the merchant validation route so the adapter doesn't need
  // a real reference server to test against.
  if (!originalFetch) originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/applepay/merchant-validation')) {
      if (cfg.validateSucceeds) {
        return new Response(JSON.stringify(cfg.merchantSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('forbidden', { status: 403 });
    }
    return originalFetch!(input, init);
  }) as typeof fetch;

  class FakeApplePaySession {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      return cfg.canMakePayments;
    }

    onvalidatemerchant: ((event: { validationURL: string }) => void) | undefined;
    onpaymentauthorized:
      | ((event: { payment: { token: { paymentData: unknown; paymentMethod: { network: string } }; transactionIdentifier: string } }) => void)
      | undefined;
    oncancel: (() => void) | undefined;

    constructor(_version: number, _request: unknown) {
      // no-op
    }

    begin(): void {
      // Drive the lifecycle on next tick to mimic the Apple Pay sheet flow.
      setTimeout(async () => {
        // STEP 1 — fire onvalidatemerchant
        if (this.onvalidatemerchant) {
          this.onvalidatemerchant({
            validationURL: 'https://apple-pay-gateway.apple.com/paymentservices/startSession',
          });
        }
        // Wait a tick for the validation fetch to resolve.
        await new Promise((r) => setTimeout(r, 0));
        // STEP 2 — fire onpaymentauthorized OR oncancel
        if (cfg.approves && this.onpaymentauthorized) {
          this.onpaymentauthorized({
            payment: {
              token: {
                paymentData: cfg.paymentData,
                paymentMethod: { network: cfg.network },
              },
              transactionIdentifier: 'apple-fake-tx-1',
            },
          });
        } else if (this.oncancel) {
          this.oncancel();
        }
      }, 0);
    }

    abort(): void {
      // no-op
    }

    completeMerchantValidation(_session: unknown): void {
      // no-op
    }

    completePayment(_status: number): void {
      // no-op
    }
  }

  (window as unknown as Record<string, unknown>).ApplePaySession = FakeApplePaySession;
}

export function uninstallApplePayFake(): void {
  if (typeof window === 'undefined') return;
  if (originalApplePay === undefined) {
    delete (window as unknown as Record<string, unknown>).ApplePaySession;
  } else {
    (window as unknown as Record<string, unknown>).ApplePaySession = originalApplePay;
  }
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
  originalApplePay = undefined;
}
