/**
 * VoucherAdapterBase — abstract base for offline voucher / barcode APMs.
 *
 * Members of this pattern: Boleto, OXXO, Konbini, Baloto, PagoFácil, Multibanco,
 * Efecty, RapiPago, RedPagos, PagoEfectivo.
 *
 * Voucher APMs:
 *   - Have NO browser-side SDK
 *   - Have NO browser-side tokenization
 *   - Return a printable voucher number / barcode / URL from the backend
 *   - Settle 1-3 business days later via webhook
 *
 * The flow is identical to QR except:
 *   - `nextAction.kind = 'display_voucher'`
 *   - Polling is much slower (every 60s, max 3 days) — for the POC we run
 *     the same 5s polling as QR; production should bump to 60s+
 *   - Customer info (firstName, lastName, taxId/CPF) is REQUIRED at
 *     authorization time
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';

export abstract class VoucherAdapterBase extends BaseAdapter {
  override async loadSDK(): Promise<void> {
    // No provider SDK.
  }

  protected async doInit(config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    // Voucher providers require customer name + tax id. Validate up-front.
    if (!config.customer?.firstName || !config.customer?.lastName) {
      throw new Error(
        `${this.id}: customer.firstName and customer.lastName are required for voucher APMs`
      );
    }
  }

  protected async doAuthorize(): Promise<OrderResult> {
    return this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      providerData: {
        // Voucher APMs need full customer block — pass through.
        customer: this.config.customer,
      },
    });
  }
}
