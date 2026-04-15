/**
 * QrAdapterBase — abstract base for QR-code APMs.
 *
 * Members of this pattern: PIX, Alipay, Alipay+, WeChat Pay, UPI, PayNow,
 * PromptPay, TWINT, GrabPay (some), Vipps QR, etc.
 *
 * QR APMs have NO browser-side SDK and NO browser-side tokenization. The flow:
 *
 *   1. SDK calls sessionClient.authorizeOrder() with `paymentSource.sourceType`
 *      set to the APM-specific value
 *   2. CH (via merchant backend proxy) returns OrderResult with
 *      `nextAction.kind = 'qr_code'` and the QR data
 *   3. State machine transitions to `pending`
 *   4. Merchant frontend renders the QR code (the SDK does NOT render it —
 *      that's the merchant's responsibility, since the visual presentation
 *      varies wildly per merchant brand)
 *   5. User scans with their wallet app
 *   6. Provider sends webhook → CH → merchant backend → SSE → browser
 *   7. State machine transitions pending → completed (or failed/cancelled)
 *
 * Polling (every 5s) runs as a fallback to webhook delivery for resilience.
 * Polling and webhook race; first-writer-wins via OrderResultCache.
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';

export abstract class QrAdapterBase extends BaseAdapter {
  private pollTimer?: ReturnType<typeof setInterval>;
  private pollIntervalMs = 5000;
  private maxPollAttempts = 60; // 5 minutes total

  override async loadSDK(): Promise<void> {
    // No provider SDK — QR data comes from the backend.
  }

  protected async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    // No browser-side init.
  }

  protected async doAuthorize(): Promise<OrderResult> {
    const result = await this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      returnUrls: this.config.returnUrls,
    });

    // Async by definition — start polling as a webhook fallback.
    if (result.status === 'pending_authorization') {
      this.startPolling(result.orderId);
    }
    return result;
  }

  protected async doTeardown(): Promise<void> {
    this.stopPolling();
  }

  private startPolling(orderId: string): void {
    if (this.pollTimer) return;
    let attempts = 0;
    this.pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > this.maxPollAttempts) {
        this.stopPolling();
        return;
      }
      try {
        const refreshed = await this.ctx.sessionClient.getOrder(orderId);
        if (refreshed.status !== 'pending_authorization') {
          this.stopPolling();
          // Polling and webhook race here. The state machine deduplicates
          // via self-transition no-ops, and OrderResultCache makes
          // first-writer-wins.
          this.driveTerminal(refreshed);
        }
      } catch {
        // Polling errors are non-fatal — webhook is the primary completion path.
      }
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Drive the state machine from a polled OrderResult. The single-source-of-truth
   * emission rule still holds because the state machine deduplicates via
   * self-transition no-ops if a webhook already won the race.
   */
  private driveTerminal(result: OrderResult): void {
    if (this.sm.state !== 'pending') return;
    // Emitter context setting is done by BaseAdapter.resolveAuthorizeResult equivalent.
    // For QR polling we delegate by re-using the same internal helper via type assertion.
    const baseSelf = this as unknown as {
      emitter: { setContext: (p: object) => void };
      sm: { transition: (s: string) => void };
    };
    if (result.status === 'authorized' || result.status === 'captured') {
      baseSelf.emitter.setContext({ orderResult: result });
      baseSelf.sm.transition('completed');
    } else if (result.status === 'cancelled') {
      baseSelf.emitter.setContext({ cancellationReason: 'Cancelled at provider (polled)' });
      baseSelf.sm.transition('cancelled');
    } else if (result.status === 'declined' || result.status === 'failed') {
      baseSelf.emitter.setContext({
        error: result.error ?? { code: 'PROVIDER_REJECTED', message: 'Payment failed' },
      });
      baseSelf.sm.transition('failed');
    }
  }
}
