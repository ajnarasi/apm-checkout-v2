/**
 * PPRO Adapter Factory — generates 39 PPRO-routed APM adapters from
 * a config table. Ported from v1 with the critical change: instead of
 * fetching `/api/ppro/charge` directly, each generated adapter calls
 * `sessionClient.authorizeOrder(...)`. The merchant backend's
 * `/v2/orders/:apm` proxy then forwards to Commerce Hub (which routes
 * to PPRO behind the scenes).
 *
 * Polling for pending orders — also ported from v1 — uses
 * `sessionClient.getOrder()` instead of a direct fetch.
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from './core/base-adapter.js';
import { registerAdapter } from './core/adapter-registry.js';
import type { APMPattern, AdapterContext, CheckoutConfig } from './core/types.js';

export interface PproAdapterConfig {
  /** Adapter id (e.g. "ideal", "boleto", "alipayplus_ppro"). */
  code: string;
  /** Display name for UI. */
  displayName: string;
  /** Pattern used by base adapter behavior. */
  pattern: APMPattern;
  /** ISO country code (e.g. "NL", "BR"). */
  country: string;
  /** ISO currency code(s) supported. */
  currencies: string[];
  /** Whether the adapter should poll for completion (true for most async APMs). */
  poll?: boolean;
}

class PproAdapter extends BaseAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly pattern: APMPattern;
  private readonly pproConfig: PproAdapterConfig;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(config: PproAdapterConfig) {
    super();
    this.id = config.code;
    this.displayName = config.displayName;
    this.pattern = config.pattern;
    this.pproConfig = config;
  }

  protected async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    // No SDK to load — PPRO is server-side only.
  }

  protected async doAuthorize(): Promise<OrderResult> {
    const result = await this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      returnUrls: this.config.returnUrls,
      providerData: {
        country: this.pproConfig.country,
        currency: this.config.amount.currency,
      },
    });

    // Async PPRO APMs benefit from polling AS A FALLBACK to the webhook.
    // The state machine is the source of truth: the first transition wins.
    if (this.pproConfig.poll && result.status === 'pending_authorization') {
      this.startPolling(result.orderId);
    }
    return result;
  }

  protected async doTeardown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private startPolling(orderId: string): void {
    if (this.pollTimer) return;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes at 5s interval

    this.pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        this.stopPolling();
        return;
      }

      try {
        const refreshed = await this.ctx.sessionClient.getOrder(orderId);
        if (refreshed.status !== 'pending_authorization') {
          this.stopPolling();
          this.onPolledTerminal(refreshed);
        }
      } catch {
        // Polling errors are non-fatal — we keep trying. The webhook
        // path is the primary completion mechanism.
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private onPolledTerminal(result: OrderResult): void {
    if (this.sm.state !== 'pending') return;
    if (result.status === 'authorized' || result.status === 'captured') {
      (this.emitter as { setContext: (p: object) => void }).setContext({
        orderResult: result,
      });
      this.sm.transition('completed');
    } else if (result.status === 'cancelled') {
      (this.emitter as { setContext: (p: object) => void }).setContext({
        cancellationReason: 'Cancelled at provider (polled)',
      });
      this.sm.transition('cancelled');
    } else if (result.status === 'declined' || result.status === 'failed') {
      (this.emitter as { setContext: (p: object) => void }).setContext({
        error: result.error ?? { code: 'PROVIDER_REJECTED', message: 'Payment failed' },
      });
      this.sm.transition('failed');
    }
  }
}

/**
 * PPRO-routed APMs (v2.2 reconciled with v1 endpoint table).
 *
 * Adding a new PPRO APM is a one-line change here. The CH wire field
 * `paymentMethod.provider = uppercase(code)` is computed by the reference
 * server via `getApmMapping(code).chProvider` from `@commercehub/shared-types`.
 *
 * v2.2 reconciliation (2026-04-14): added 15 methods from v1's endpoint
 * table that v2.1 was missing — WERO, POSTFINANCE, SWISH, VIPPS, MOBILEPAY,
 * MERCADOPAGO, PAYNOW, GCASH, MAYA, LINEPAY, OVO, SHOPEEPAY, TOUCHNGO, UPI,
 * KONBINI. Renamed `p24` → `przelewy24`, removed the `ppro_*` prefixes that
 * conflicted with v1's flat naming.
 *
 * Total: 53 entries (39 v1 + 14 v2.1 extras kept for forward compat).
 */
export const PPRO_ADAPTERS: PproAdapterConfig[] = [
  // ── European bank redirects (v1 + missing) ──
  { code: 'ideal', displayName: 'iDEAL', pattern: 'bank-redirect', country: 'NL', currencies: ['EUR'], poll: true },
  { code: 'bancontact', displayName: 'Bancontact', pattern: 'bank-redirect', country: 'BE', currencies: ['EUR'], poll: true },
  { code: 'eps', displayName: 'EPS', pattern: 'bank-redirect', country: 'AT', currencies: ['EUR'], poll: true },
  { code: 'blik', displayName: 'BLIK', pattern: 'bank-redirect', country: 'PL', currencies: ['PLN'], poll: true },
  { code: 'trustly', displayName: 'Trustly', pattern: 'bank-redirect', country: 'SE', currencies: ['SEK', 'EUR'], poll: true },
  { code: 'wero', displayName: 'Wero', pattern: 'bank-redirect', country: 'DE', currencies: ['EUR'], poll: true },                 // v2.2 NEW
  { code: 'sofort', displayName: 'SOFORT', pattern: 'bank-redirect', country: 'DE', currencies: ['EUR'], poll: true },
  { code: 'giropay', displayName: 'Giropay', pattern: 'bank-redirect', country: 'DE', currencies: ['EUR'], poll: true },
  { code: 'przelewy24', displayName: 'Przelewy24', pattern: 'bank-redirect', country: 'PL', currencies: ['PLN', 'EUR'], poll: true },
  { code: 'postfinance', displayName: 'PostFinance', pattern: 'bank-redirect', country: 'CH', currencies: ['CHF'], poll: true },   // v2.2 NEW
  { code: 'mbway', displayName: 'MB WAY', pattern: 'redirect-wallet', country: 'PT', currencies: ['EUR'], poll: true },
  { code: 'multibanco', displayName: 'Multibanco', pattern: 'voucher-cash', country: 'PT', currencies: ['EUR'], poll: true },
  { code: 'mybank', displayName: 'MyBank', pattern: 'bank-redirect', country: 'IT', currencies: ['EUR'], poll: true },             // v2.1 extra
  { code: 'finlandbanks', displayName: 'Finland Online Banking', pattern: 'bank-redirect', country: 'FI', currencies: ['EUR'], poll: true }, // v2.1 extra

  // ── Nordic mobile wallets ──
  { code: 'swish', displayName: 'Swish', pattern: 'redirect-wallet', country: 'SE', currencies: ['SEK'], poll: true },             // v2.2 NEW
  { code: 'vipps', displayName: 'Vipps', pattern: 'redirect-wallet', country: 'NO', currencies: ['NOK'], poll: true },             // v2.2 NEW
  { code: 'mobilepay', displayName: 'MobilePay', pattern: 'redirect-wallet', country: 'DK', currencies: ['DKK', 'EUR'], poll: true }, // v2.2 NEW
  { code: 'twint', displayName: 'TWINT', pattern: 'redirect-wallet', country: 'CH', currencies: ['CHF'], poll: true },

  // ── LATAM bank redirect + voucher ──
  { code: 'spei', displayName: 'SPEI', pattern: 'bank-redirect', country: 'MX', currencies: ['MXN'], poll: true },
  { code: 'pse', displayName: 'PSE', pattern: 'bank-redirect', country: 'CO', currencies: ['COP'], poll: true },
  { code: 'webpay', displayName: 'Webpay Plus', pattern: 'bank-redirect', country: 'CL', currencies: ['CLP'], poll: true },
  { code: 'mercadopago', displayName: 'Mercado Pago', pattern: 'redirect-wallet', country: 'AR', currencies: ['ARS', 'BRL', 'MXN', 'COP', 'CLP'], poll: true }, // v2.2 NEW
  { code: 'pix', displayName: 'PIX', pattern: 'qr-code', country: 'BR', currencies: ['BRL'], poll: true },
  { code: 'boleto', displayName: 'Boleto', pattern: 'voucher-cash', country: 'BR', currencies: ['BRL'], poll: true },
  { code: 'oxxo', displayName: 'OXXO', pattern: 'voucher-cash', country: 'MX', currencies: ['MXN'], poll: true },
  { code: 'efecty', displayName: 'Efecty', pattern: 'voucher-cash', country: 'CO', currencies: ['COP'], poll: true },
  { code: 'baloto', displayName: 'Baloto', pattern: 'voucher-cash', country: 'CO', currencies: ['COP'], poll: true },              // v2.1 extra
  { code: 'rapipago', displayName: 'RapiPago', pattern: 'voucher-cash', country: 'AR', currencies: ['ARS'], poll: true },
  { code: 'pagofacil', displayName: 'PagoFácil', pattern: 'voucher-cash', country: 'AR', currencies: ['ARS'], poll: true },        // v2.1 extra
  { code: 'redpagos', displayName: 'RedPagos', pattern: 'voucher-cash', country: 'UY', currencies: ['UYU'], poll: true },          // v2.1 extra
  { code: 'pagoefectivo', displayName: 'PagoEfectivo', pattern: 'voucher-cash', country: 'PE', currencies: ['PEN'], poll: true },

  // ── APAC bank + wallet + voucher ──
  { code: 'paynow', displayName: 'PayNow', pattern: 'qr-code', country: 'SG', currencies: ['SGD'], poll: true },                   // v2.2 NEW
  { code: 'gcash', displayName: 'GCash', pattern: 'redirect-wallet', country: 'PH', currencies: ['PHP'], poll: true },             // v2.2 NEW
  { code: 'maya', displayName: 'Maya', pattern: 'redirect-wallet', country: 'PH', currencies: ['PHP'], poll: true },               // v2.2 NEW
  { code: 'linepay', displayName: 'LINE Pay', pattern: 'redirect-wallet', country: 'JP', currencies: ['JPY', 'TWD', 'THB'], poll: true }, // v2.2 NEW
  { code: 'kakaopay', displayName: 'KakaoPay', pattern: 'redirect-wallet', country: 'KR', currencies: ['KRW'], poll: true },
  { code: 'dana', displayName: 'DANA', pattern: 'qr-code', country: 'ID', currencies: ['IDR'], poll: true },
  { code: 'ovo', displayName: 'OVO', pattern: 'redirect-wallet', country: 'ID', currencies: ['IDR'], poll: true },                 // v2.2 NEW
  { code: 'shopeepay', displayName: 'ShopeePay', pattern: 'redirect-wallet', country: 'ID', currencies: ['IDR', 'PHP', 'THB', 'VND', 'MYR', 'SGD'], poll: true }, // v2.2 NEW
  { code: 'touchngo', displayName: "Touch 'n Go", pattern: 'redirect-wallet', country: 'MY', currencies: ['MYR'], poll: true },    // v2.2 NEW
  { code: 'alipay', displayName: 'Alipay', pattern: 'qr-code', country: 'CN', currencies: ['CNY'], poll: true },                   // v2.2 NEW (was ppro_alipay)
  { code: 'paypay', displayName: 'PayPay', pattern: 'qr-code', country: 'JP', currencies: ['JPY'], poll: true },                   // v2.2 (was ppro_paypay)
  { code: 'upi', displayName: 'UPI', pattern: 'qr-code', country: 'IN', currencies: ['INR'], poll: true },                         // v2.2 NEW
  { code: 'konbini', displayName: 'Konbini', pattern: 'voucher-cash', country: 'JP', currencies: ['JPY'], poll: true },            // v2.2 NEW

  // ── v2.1 extras kept for forward compat (not in v1's PPRO table) ──
  { code: 'ppro_wechatpay', displayName: 'WeChat Pay (via PPRO)', pattern: 'qr-code', country: 'CN', currencies: ['CNY'], poll: true },
  { code: 'ppro_naverpay', displayName: 'NaverPay (via PPRO)', pattern: 'redirect-wallet', country: 'KR', currencies: ['KRW'], poll: true },
  { code: 'ppro_gopay', displayName: 'GoPay', pattern: 'qr-code', country: 'ID', currencies: ['IDR'], poll: true },
  { code: 'ppro_truemoney', displayName: 'TrueMoney', pattern: 'qr-code', country: 'TH', currencies: ['THB'], poll: true },
  { code: 'ppro_promptpay', displayName: 'PromptPay', pattern: 'qr-code', country: 'TH', currencies: ['THB'], poll: true },
  { code: 'ppro_momo', displayName: 'MoMo', pattern: 'qr-code', country: 'VN', currencies: ['VND'], poll: true },

  // ── Bank debit / direct entry (v2.1 extras) ──
  { code: 'sepa', displayName: 'SEPA Direct Debit', pattern: 'bank-redirect', country: 'EU', currencies: ['EUR'], poll: true },
  { code: 'becs', displayName: 'BECS Direct Debit', pattern: 'bank-redirect', country: 'AU', currencies: ['AUD'], poll: true },
  { code: 'bacs', displayName: 'Bacs Direct Debit', pattern: 'bank-redirect', country: 'GB', currencies: ['GBP'], poll: true },
  { code: 'paybybank', displayName: 'Pay by Bank', pattern: 'bank-redirect', country: 'GB', currencies: ['GBP'], poll: true },
];

/**
 * Register all PPRO adapters into the global registry.
 * Called once at module load time from register-all.ts.
 */
export function registerAllPproAdapters(): void {
  for (const cfg of PPRO_ADAPTERS) {
    registerAdapter(cfg.code, () => new PproAdapter(cfg));
  }
}
