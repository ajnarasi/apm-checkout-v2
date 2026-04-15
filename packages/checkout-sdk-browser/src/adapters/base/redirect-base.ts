/**
 * RedirectAdapterBase — abstract base for hosted-payment-page redirect APMs.
 *
 * Members of this pattern: iDEAL, SOFORT, Bancontact, EPS, BLIK, Trustly,
 * Wero, Giropay, Przelewy24, PostFinance, MB WAY, Swish, Vipps, MobilePay,
 * SPEI, PSE, Webpay, MercadoPago, PayNow, GCash, Maya, LINE Pay, KakaoPay,
 * DANA, OVO, ShopeePay, Touch'n Go, etc.
 *
 * NO browser-side SDK. NO browser-side tokenization. The flow:
 *
 *   1. SDK calls sessionClient.authorizeOrder(...) with the APM id
 *   2. CH returns OrderResult with `nextAction.kind = 'redirect'` + URL
 *   3. State machine transitions to `pending`
 *   4. Merchant frontend navigates the user to the URL
 *   5. User authorizes at their bank
 *   6. Provider sends webhook → CH → merchant backend → SSE → browser
 *   7. State machine transitions pending → completed (or failed/cancelled)
 *
 * Subclasses only declare metadata (id, displayName, region, capabilities).
 * The base provides everything else.
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';

export abstract class RedirectAdapterBase extends BaseAdapter {
  override async loadSDK(): Promise<void> {
    // No provider SDK to load.
  }

  protected async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    // No browser-side init.
  }

  protected async doAuthorize(): Promise<OrderResult> {
    return this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      returnUrls: this.config.returnUrls,
    });
  }
}
