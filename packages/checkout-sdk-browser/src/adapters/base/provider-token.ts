/**
 * ProviderToken — discriminated union for browser-side tokenization output.
 *
 * Each base class returns one variant. The merchant backend's
 * `POST /v2/orders/:apm` route translates the variant into the right CH
 * `paymentSource` shape (per CH Orders spec v1.26.0302 page 6: sourceType +
 * walletType + provider-specific token field).
 *
 * The variant is the contract between browser SDK and merchant backend.
 * Both sides depend on this type via `@commercehub/shared-types` re-export
 * (TODO: lift to shared-types in v2.2). For now it lives co-located with
 * the base classes that produce it.
 */

/** BNPL JS SDK token (Klarna, Affirm, Afterpay, Sezzle, Zip). */
export interface BnplToken {
  kind: 'bnpl';
  /** Provider id matching the AdapterCapabilities. */
  provider: 'klarna' | 'affirm' | 'afterpay' | 'sezzle' | 'zip';
  /** Provider-specific token field. */
  payload: {
    authorizationToken?: string; // Klarna
    checkoutToken?: string; // Affirm
    [key: string]: unknown;
  };
}

/** Native wallet token (Apple Pay, Google Pay). */
export interface NativeWalletToken {
  kind: 'native-wallet';
  provider: 'applepay' | 'googlepay';
  payload: {
    /** Apple Pay: `event.payment.token.paymentData` (encrypted). */
    paymentData?: string;
    /** Google Pay: `tokenizationData.token` (encrypted). */
    tokenizationData?: string;
    /** Card brand surfaced by the device. */
    network?: string;
    /** Last 4 of the device-provided PAN (display only, never sent to CH). */
    last4?: string;
  };
}

/** Button-SDK token (PayPal, Venmo, CashApp, Amazon Pay). */
export interface ButtonSdkToken {
  kind: 'button-sdk';
  provider: 'paypal' | 'paypal_paylater' | 'venmo' | 'cashapp';
  payload: {
    orderID?: string; // PayPal onApprove
    payerID?: string; // PayPal onApprove
    nonce?: string; // Braintree-style
    [key: string]: unknown;
  };
}

/** Redirect-only flow has no browser-side token. */
export interface RedirectToken {
  kind: 'redirect';
  provider: string;
  payload: Record<string, never>;
}

/** QR flow returns no token until the user scans. */
export interface QrToken {
  kind: 'qr';
  provider: string;
  payload: Record<string, never>;
}

/** Voucher flow returns no token. */
export interface VoucherToken {
  kind: 'voucher';
  provider: string;
  payload: Record<string, never>;
}

export type ProviderToken =
  | BnplToken
  | NativeWalletToken
  | ButtonSdkToken
  | RedirectToken
  | QrToken
  | VoucherToken;
