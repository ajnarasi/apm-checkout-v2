/**
 * OrderResult — the Anti-Corruption Layer domain type.
 *
 * Adapters consume this type. They NEVER see Commerce Hub's raw wire format.
 * The `order-result-mapper.ts` in checkout-sdk-browser is the ONLY file that
 * translates CH's orders-endpoint response into this shape. If CH changes
 * their contract, exactly one file changes — not 55.
 */

export type OrderStatus =
  | 'pending_authorization' // async APM, waiting for user action or webhook
  | 'authorized' // sync APM, immediate auth success
  | 'captured' // auth + capture combined
  | 'declined' // provider rejected
  | 'failed' // network / validation / other error
  | 'cancelled'; // user cancelled at provider

export interface OrderResult {
  /** Commerce Hub's order id — used for correlation. */
  orderId: string;
  /** Commerce Hub's transaction id. */
  transactionId?: string;
  /** Normalized status — adapters switch on this, not CH's raw transactionState. */
  status: OrderStatus;
  /**
   * Where the user needs to go next, if anywhere.
   * - `redirect`: open `redirectUrl` in a new tab / current tab
   * - `qr_code`: render `qrCodeData` as a QR
   * - `none`: terminal, no further action needed
   */
  nextAction: NextAction;
  /** Human-readable message for display in the UI (never includes PII). */
  message?: string;
  /** Provider-specific correlation id (e.g. Klarna session id, PayPal order id). */
  providerReference?: string;
  /** Error details if status is 'declined' | 'failed'. */
  error?: OrderError;
}

export type NextAction =
  | { kind: 'none' }
  | { kind: 'redirect'; redirectUrl: string; returnUrl?: string }
  | { kind: 'qr_code'; qrCodeData: string; expiresAt?: number }
  | { kind: 'display_voucher'; voucherNumber: string; voucherUrl?: string }
  | { kind: 'poll'; pollUrl: string; intervalMs: number };

export interface OrderError {
  /** Stable error code the SDK can switch on. */
  code: OrderErrorCode;
  /** Human-readable message (PII-safe). */
  message: string;
  /** Commerce Hub's original error code for debugging. */
  providerCode?: string;
  /** Commerce Hub's `apiTraceId` for support tickets. */
  apiTraceId?: string;
}

export type OrderErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_FAILED'
  | 'INSUFFICIENT_FUNDS'
  | 'PROVIDER_REJECTED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CIRCUIT_OPEN'
  | 'DEADLINE_EXCEEDED'
  | 'UNKNOWN';
