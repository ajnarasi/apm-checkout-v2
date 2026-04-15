/**
 * Commerce Hub Credentials API — REQUEST types.
 *
 * Token-efficiency note: the full CH Credentials spec documents 500+
 * optional fields across ~228 pages. We type ONLY the subset this SDK
 * actually uses (~40 fields). Everything else is an escape-hatch
 * `additionalFields` map so merchants can pass through vendor-specific
 * context without a type-level wall.
 *
 * Spec reference: CommerceHub_Credentials_api_endpoint_spec.pdf v1.26.0302
 */

export interface CredentialsRequest {
  /** Amount to authorize, in minor currency units. */
  amount?: Amount;
  /**
   * Payment source — card / wallet / APM. For APM flows this is often
   * empty at session creation and populated later by the provider.
   */
  source?: Source;
  /** Merchant-generated order identifier. */
  merchantOrderId?: string;
  /** Merchant-generated per-attempt identifier. */
  merchantTransactionId?: string;
  /** Customer information. */
  customer?: Customer;
  /** Billing address. */
  billingAddress?: Address;
  /** Shipping address. */
  shippingAddress?: Address;
  /** Order line items. */
  orderData?: OrderData;
  /**
   * Transaction-level options: captureFlag, interactionType,
   * terminalId, etc. Passed through to CH unchanged.
   */
  transactionDetails?: TransactionDetails;
  /** Escape hatch for spec fields not yet typed. */
  additionalFields?: Record<string, unknown>;
}

export interface Amount {
  /** Decimal total as a number, e.g. 49.99. */
  total: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
}

export interface Source {
  /** Source type — card, googlePay, applePay, apm, etc. */
  sourceType: string;
  /** Additional source-specific fields (pass-through). */
  [key: string]: unknown;
}

export interface Customer {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** Commerce Hub's customer id if already known. */
  customerId?: string;
}

export interface Address {
  street?: string;
  houseNumberOrName?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  country?: string;
}

export interface OrderData {
  orderItems?: OrderItem[];
}

export interface OrderItem {
  itemId?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  itemCategory?: string;
}

export interface TransactionDetails {
  captureFlag?: boolean;
  interactionType?: string;
  terminalId?: string;
  [key: string]: unknown;
}
