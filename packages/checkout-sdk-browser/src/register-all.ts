/**
 * Register all 70 adapters into the global registry.
 *
 * Import this once at app startup (or from index.ts) before calling
 * createCheckout().
 *
 * v2.2 Iteration 4 Phase Z update: all 16 direct adapters now live under
 * `adapters/<pattern>/*-adapter.ts` as real-SDK base-class implementations.
 * The legacy `bnpl-adapters.ts`, `native-wallet-adapters.ts`, `qr-adapters.ts`,
 * `paypal-adapter.ts`, `zepto-adapter.ts`, `tabapay-adapter.ts` barrel files
 * have been deleted.
 */

import { registerAdapter } from './core/adapter-registry.js';

// Tokenization pattern (BNPL + card SSO)
import { KlarnaAdapter } from './adapters/tokenization/klarna-adapter.js';
import { AffirmAdapter } from './adapters/tokenization/affirm-adapter.js';
import { AfterpayAdapter } from './adapters/tokenization/afterpay-adapter.js';
import { SezzleAdapter } from './adapters/tokenization/sezzle-adapter.js';
import { ZipAdapter } from './adapters/tokenization/zip-adapter.js';
import { TabaPayAdapter } from './adapters/tokenization/tabapay-adapter.js';

// Button SDK pattern
import { PayPalAdapter } from './adapters/button-sdk/paypal-adapter.js';
import { PayPalPayLaterAdapter } from './adapters/button-sdk/paypal-paylater-adapter.js';
import { VenmoAdapter } from './adapters/button-sdk/venmo-adapter.js';
import { CashAppAdapter } from './adapters/button-sdk/cashapp-adapter.js';

// Native wallet pattern
import { ApplePayAdapter } from './adapters/native-wallet/applepay-adapter.js';
import { GooglePayAdapter } from './adapters/native-wallet/googlepay-adapter.js';

// QR pattern (no browser SDK — QrAdapterBase handles everything)
import { AlipayPlusAdapter } from './adapters/qr/alipayplus-adapter.js';
import { WeChatPayAdapter } from './adapters/qr/wechatpay-adapter.js';

// Redirect pattern (no browser SDK — RedirectAdapterBase handles everything)
import { GrabPayAdapter } from './adapters/redirect/grabpay-adapter.js';
import { ZeptoAdapter } from './adapters/redirect/zepto-adapter.js';

import { registerAllPproAdapters } from './ppro-adapter-factory.js';

export function registerAllAdapters(): void {
  // 16 direct adapters — all REAL SDK base-class implementations
  registerAdapter('klarna', () => new KlarnaAdapter());
  registerAdapter('affirm', () => new AffirmAdapter());
  registerAdapter('afterpay', () => new AfterpayAdapter());
  registerAdapter('sezzle', () => new SezzleAdapter());
  registerAdapter('zip', () => new ZipAdapter());
  registerAdapter('tabapay', () => new TabaPayAdapter());

  registerAdapter('paypal', () => new PayPalAdapter());
  registerAdapter('paypal_paylater', () => new PayPalPayLaterAdapter());
  registerAdapter('venmo', () => new VenmoAdapter());
  registerAdapter('cashapp', () => new CashAppAdapter());

  registerAdapter('applepay', () => new ApplePayAdapter());
  registerAdapter('googlepay', () => new GooglePayAdapter());

  registerAdapter('alipayplus', () => new AlipayPlusAdapter());
  registerAdapter('wechatpay', () => new WeChatPayAdapter());

  registerAdapter('grabpay', () => new GrabPayAdapter());
  registerAdapter('zepto', () => new ZeptoAdapter());

  // 54 PPRO-routed adapters (CH owns the fan-out per ADR-004)
  registerAllPproAdapters();
}

// Auto-register on import for convenience
registerAllAdapters();
