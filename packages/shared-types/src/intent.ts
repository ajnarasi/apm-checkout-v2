/**
 * Payment intent enum — maps to CH Orders endpoint operations.
 *
 * The CH Orders endpoint (`POST /checkouts/v1/orders`, v1.26.0302) discriminates
 * operations by a combination of `transactionDetails.captureFlag` and
 * `referenceTransactionDetails.referenceTransactionId`. This enum is the
 * SDK-facing abstraction; the commerce-hub-node client translates each value
 * to the right field combination.
 */

export type PaymentIntent =
  /** Auth-only — captureFlag=false, no reference. Used in merchant-initiated flows. */
  | 'AUTHORIZE'
  /** Auth + capture in one shot — captureFlag=true, no reference. The default for gateway-initiated flows. */
  | 'SALE'
  /** Capture against an existing auth — captureFlag=true + referenceTransactionId. */
  | 'CAPTURE'
  /** Cancel an auth before settlement — reversalReasonCode=VOID + referenceTransactionId. */
  | 'VOID'
  /** Refund a settled order — refund indicator + referenceTransactionId. */
  | 'REFUND';

/**
 * Payment initiator — who triggers the call to the APM provider.
 * Maps directly to CH `checkoutInteractions.paymentInitiator` field.
 */
export type PaymentInitiator =
  /** Commerce Hub triggers settlement automatically (default). */
  | 'GATEWAY'
  /** Merchant must explicitly call CH to authorize/capture/void/refund. */
  | 'MERCHANT';

/**
 * Map a (intent, initiator) pair to the CH wire field combination the
 * commerce-hub-node client should set. Centralized here so the discrimination
 * logic isn't scattered across client.ts and route handlers.
 */
export interface IntentToWireFields {
  captureFlag?: boolean;
  reversalReasonCode?: 'VOID' | string;
  referenceTransactionId?: string;
  /** Set when the operation is explicitly a refund. Per spec page 21 region. */
  refundIndicator?: boolean;
}

/**
 * Discriminator translation — pure function.
 * Used by commerce-hub-node CommerceHubClient to build the request body.
 */
export function intentToWireFields(
  intent: PaymentIntent,
  referenceTransactionId?: string
): IntentToWireFields {
  switch (intent) {
    case 'AUTHORIZE':
      return { captureFlag: false };
    case 'SALE':
      return { captureFlag: true };
    case 'CAPTURE':
      if (!referenceTransactionId) {
        throw new Error('CAPTURE intent requires referenceTransactionId');
      }
      return { captureFlag: true, referenceTransactionId };
    case 'VOID':
      if (!referenceTransactionId) {
        throw new Error('VOID intent requires referenceTransactionId');
      }
      return { reversalReasonCode: 'VOID', referenceTransactionId };
    case 'REFUND':
      if (!referenceTransactionId) {
        throw new Error('REFUND intent requires referenceTransactionId');
      }
      return { refundIndicator: true, referenceTransactionId };
  }
}
