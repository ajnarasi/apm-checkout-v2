/**
 * Adapter base classes — one per APM pattern (architect Pass #2 P0 #1).
 *
 * Adapters extend exactly one base matching their pattern:
 *
 *   redirect       → bank-redirect HPP (iDEAL, SOFORT, Bancontact, ...)
 *   tokenization   → BNPL JS SDK (Klarna, Affirm, Afterpay, Sezzle, Zip)
 *   native-wallet  → device API (Apple Pay, Google Pay)
 *   button-sdk     → provider button widget (PayPal, Venmo, CashApp)
 *   qr             → QR code + polling (PIX, Alipay, WeChat Pay, UPI, ...)
 *   voucher        → offline barcode (Boleto, OXXO, Konbini, ...)
 */

export { RedirectAdapterBase } from './redirect-base.js';
export { TokenizationAdapterBase } from './tokenization-base.js';
export {
  NativeWalletAdapterBase,
  SingleUseTokenConsumedError,
} from './native-wallet-base.js';
export { ButtonSdkAdapterBase } from './button-sdk-base.js';
export { QrAdapterBase } from './qr-base.js';
export { VoucherAdapterBase } from './voucher-base.js';

export type {
  ProviderToken,
  BnplToken,
  NativeWalletToken,
  ButtonSdkToken,
  RedirectToken,
  QrToken,
  VoucherToken,
} from './provider-token.js';
