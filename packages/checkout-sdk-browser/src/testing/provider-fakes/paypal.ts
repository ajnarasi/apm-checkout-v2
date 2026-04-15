/**
 * PayPal provider fake — installs `window.paypal.Buttons` with deterministic
 * test-friendly responses. Does NOT load anything from www.paypal.com.
 */

export interface PayPalFakeConfig {
  /** Whether onApprove fires automatically (true) or never (false). Default true. */
  approves?: boolean;
  /** The fake orderID PayPal returns. Default 'PP-fake-order-1'. */
  orderID?: string;
  /** The fake payerID. Default 'PP-fake-payer-1'. */
  payerID?: string;
  /** Whether isEligible() should return true. Default true. */
  eligible?: boolean;
}

let originalPaypal: unknown;

export function installPayPalFake(config: PayPalFakeConfig = {}): void {
  if (typeof window === 'undefined') return;
  originalPaypal = (window as unknown as Record<string, unknown>).paypal;

  const cfg = {
    approves: true,
    orderID: 'PP-fake-order-1',
    payerID: 'PP-fake-payer-1',
    eligible: true,
    ...config,
  };

  (window as unknown as Record<string, unknown>).paypal = {
    Buttons: (
      opts: {
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string; payerID?: string }) => Promise<void>;
        onCancel?: () => void;
        onError?: (err: unknown) => void;
      }
    ) => ({
      isEligible: () => cfg.eligible,
      render: async (_container: string | HTMLElement) => {
        if (!cfg.approves) return;
        // Simulate user clicking the button + completing PayPal flow.
        // Run on next tick to mimic the async render → click delay.
        await new Promise((r) => setTimeout(r, 0));
        try {
          await opts.createOrder();
          await opts.onApprove({ orderID: cfg.orderID, payerID: cfg.payerID });
        } catch (err) {
          opts.onError?.(err);
        }
      },
    }),
  };
}

export function uninstallPayPalFake(): void {
  if (typeof window === 'undefined') return;
  if (originalPaypal === undefined) {
    delete (window as unknown as Record<string, unknown>).paypal;
  } else {
    (window as unknown as Record<string, unknown>).paypal = originalPaypal;
  }
  originalPaypal = undefined;
}
