/**
 * Commerce Hub Orders — typed subset of POST /checkouts/v1/orders v1.26.0302.
 *
 * Spec source: /Users/ajnarasi/Downloads/CommerceHub_Orders_api_endpoint_spec (1).pdf
 *
 * Token-efficiency note: the full CH Orders spec is 282 pages and ~500+ optional
 * fields. We type ONLY the subset this SDK actually uses (~50 fields). Card-flow,
 * EMV terminal, encrypted track data, fleet card, vehicle data, and similar
 * pass-through fields are left as unknown via `[key: string]: unknown` escape hatches.
 *
 * The browser SDK never constructs these types directly. Only the
 * commerce-hub-node CommerceHubClient touches them.
 */

import type { PaymentInitiator } from './intent.js';

// ============================================================================
// REQUEST
// ============================================================================

export interface CheckoutOrdersRequest {
  /** Order envelope. */
  order?: {
    orderId?: string;
    /** "AUTHORIZE" | "SALE" | "CAPTURE" | "VOID" | "REFUND" — CH-side enum string. */
    intent?: string;
    /** "PAYER_ACTION_REQUIRED" or similar status hint. */
    orderStatus?: string;
  };

  /** Alternative payment method identification. */
  paymentMethod?: {
    /** APM provider name, e.g. "Klarna", "PayPal", "Alipay+", "iDEAL". */
    provider?: string;
    /** Provider-specific subtype. */
    type?: string;
  };

  /** Payment source — sourceType is REQUIRED per spec page 6. */
  paymentSource: {
    /** "PaymentCard" | "DigitalWallet" | "AlternativePaymentMethod" — REQUIRED. */
    sourceType: string;
    /** "APPLE_PAY" | "GOOGLE_PAY" | "PAYPAL" | etc. for wallets. */
    walletType?: string;
    /** Provider-specific token field. Pass-through. */
    [key: string]: unknown;
  };

  /** Customer interaction details — paymentInitiator lives here. */
  checkoutInteractions?: {
    channel?: 'WEB' | 'MOBILE' | string;
    actions?: {
      /** "WEB_REDIRECTION" | "QR_CODE" | etc. */
      type?: string;
      /** Redirect URL (when type=WEB_REDIRECTION). */
      url?: string;
      /** QR code data or one-time code. */
      code?: string;
    };
    /** "REVIEW_AND_PAY" | "PAY_NOW". */
    customerConfirmation?: string;
    /** GATEWAY = CH triggers settlement; MERCHANT = explicit capture call. */
    paymentInitiator?: PaymentInitiator;
    returnUrls?: {
      successUrl?: string;
      cancelUrl?: string;
    };
  };

  /** Transaction-level options including the captureFlag toggle. */
  transactionDetails?: {
    /** false = auth-only, true (default) = sale or capture. */
    captureFlag?: boolean;
    transactionCaptureType?: string;
    merchantTransactionId?: string;
    merchantOrderId?: string;
    merchantInvoiceNumber?: string;
    authorizationTypeIndicator?: string;
    /** "CANCEL_BEFORE_AUTHORIZATION" or similar — used for void semantics. */
    authorizationSequence?: string;
    /** "VOID" — used for explicit void operations. */
    reversalReasonCode?: string;
    /** Toggle 3DS challenge for the payment type. */
    authentication3DS?: boolean;
    physicalGoodsIndicator?: boolean;
    createToken?: boolean;
    tokenProvider?: string;
    partialApproval?: boolean;
    splitTenderId?: string;
    duplicateTransactionCheckingIndicator?: boolean;
    accountVerification?: boolean;
  };

  /** Reference to original transaction — required for capture/void/refund. */
  referenceTransactionDetails?: {
    /** CH-generated transactionId of the original auth. */
    referenceTransactionId?: string;
    referenceMerchantTransactionId?: string;
    referenceMerchantOrderId?: string;
    /** CH-generated orderId of the original. */
    referenceOrderId?: string;
    referenceClientRequestId?: string;
  };

  /** Customer profile. */
  customer?: {
    merchantCustomerId?: string;
    providerCustomerId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    dateOfBirth?: string;
    countryOfBirth?: string;
    nationality?: string;
    phone?: Array<{ countryCode?: string; phoneNumber?: string; type?: string }>;
    [key: string]: unknown;
  };

  /** Customer billing address. */
  customerAddress?: Address;

  /** Shipping address. */
  shippingAddress?: Address & {
    firstName?: string;
    lastName?: string;
    shippingMethod?: string;
    shipToEmail?: string;
  };

  /** Billing address. */
  billingAddress?: Address & {
    firstName?: string;
    middleName?: string;
    lastName?: string;
  };

  /** Amount + currency. */
  amount?: {
    total?: number;
    currency?: string;
  };

  amountComponents?: {
    unitPrice?: number;
    subTotal?: number;
    cashback?: number;
    tip?: number;
    surcharge?: number;
    convenienceFee?: number;
    shippingAmount?: number;
    freightAmount?: number;
    [key: string]: unknown;
  };

  /** Order line items. */
  orderData?: {
    orderDate?: string;
    itemCount?: number;
    customerReferenceIdentifier?: string;
    itemDetails?: Array<{
      itemNumber?: number;
      itemName?: string;
      itemDescription?: string;
      productSKU?: string;
      quantity?: number;
      unitOfMeasurement?: string;
      [key: string]: unknown;
    }>;
    orderDescription?: string;
    [key: string]: unknown;
  };

  /** Merchant context. */
  merchantDetails?: {
    tokenType?: string;
    storeId?: string;
    terminalId?: string;
    merchantId?: string;
    taxId?: string;
    vatRegistrationNumber?: string;
    siteTypeIndicator?: string;
    dbaName?: string;
    promotionCode?: string;
    hcoPageId?: string;
    useCase?: string;
  };

  merchantPartner?: {
    id?: string;
    legacyTppId?: string;
    type?: string;
    name?: string;
    productName?: string;
    versionNumber?: string;
    integrator?: string;
    merchantSubscriptionId?: string;
    accountId?: string;
  };

  /** Escape hatch for spec fields not yet typed. */
  [key: string]: unknown;
}

export interface Address {
  street?: string;
  houseNumberOrName?: string;
  recipientNameOrAddress?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  country?: string;
  county?: string;
  [key: string]: unknown;
}

// ============================================================================
// RESPONSE
// ============================================================================

/**
 * Both 200 success and 400 error responses share this shape.
 * Errors live in the `error[]` array regardless of HTTP status.
 * Confirmed from spec pages 130-150.
 */
export interface CheckoutOrdersResponse {
  gatewayResponse?: GatewayResponse;
  paymentTokens?: PaymentTokenResponse[];
  processorResponseDetails?: ProcessorResponseDetails;
  bankAssociationDetails?: BankAssociationDetails;
  avsSecurityCodeResponse?: AvsSecurityCodeResponse;
  networkTokenProcessingDetails?: NetworkTokenProcessingDetails;
  responseIndicators?: ResponseIndicators;
  networkDetails?: NetworkDetails;
  /** Errors from HOST | GATEWAY | NETWORK | APIM. */
  error?: CheckoutOrderError[];
  /** Pass-through. */
  [key: string]: unknown;
}

export interface GatewayResponse {
  /** "CHARGE" | "AUTH" | "CAPTURE" | "VOID" | "REFUND". */
  transactionType?: string;
  /** "AUTHORIZED" | "CAPTURED" | "DECLINED" | "PENDING" | "VOIDED" | "FAILED" | "SETTLED". */
  transactionState?: string;
  /** "ECOM" | "POS" | etc. */
  transactionOrigin?: string;
  transactionProcessingDetails?: TransactionProcessingDetails;
}

export interface TransactionProcessingDetails {
  /** CH-generated order id. */
  orderId?: string;
  transactionTimestamp?: string;
  /** Use this for support tickets. */
  apiTraceId?: string;
  /** Echoed from request header. */
  clientRequestId?: string;
  /** CH-generated transaction id — used as referenceTransactionId in secondary calls. */
  transactionId?: string;
  apiKey?: string;
}

export interface PaymentTokenResponse {
  tokenData?: string;
  tokenSource?: string;
  tokenResponseCode?: string;
  tokenResponseDescription?: string;
  cryptogram?: string;
  tokenRequestorId?: string;
  tokenAssuranceMethod?: string;
}

export interface ProcessorResponseDetails {
  /** "APPROVED" | "DECLINED" | etc. */
  approvalStatus?: string;
  approvalCode?: string;
  authenticationResponseCode?: string;
  referenceNumber?: string;
  feeProgramIndicator?: string;
  /** "fiserv". */
  processor?: string;
  /** "NASHVILLE" | "CHASE" | etc. */
  host?: string;
  networkRouted?: string;
  paymentAccountReference?: string;
  networkInternationalId?: string;
  responseCode?: string;
  /** "APPROVAL". */
  responseMessage?: string;
  hostResponseCode?: string;
  hostResponseMessage?: string;
  localTimestamp?: string;
  debitReceiptNumber?: string;
  [key: string]: unknown;
}

export interface BankAssociationDetails {
  associationResponseCode?: string;
  transactionReferenceInformation?: string;
  transactionTimestamp?: string;
  bankId?: string;
  avsSecurityCodeResponse?: AvsSecurityCodeResponse;
}

export interface AvsSecurityCodeResponse {
  streetMatch?: string;
  postalCodeMatch?: string;
  securityCodeMatch?: string;
  cardholderNameMatch?: string;
  association?: {
    avsCode?: string;
    cardholderNameResponse?: string;
    securityCodeResponse?: string;
  };
}

export interface NetworkTokenProcessingDetails {
  /** "PAN" | "TOKEN". */
  authorizedSource?: string;
  firstAttemptedSource?: string;
  secondAttemptedSource?: string;
  thirdAttemptedSource?: string;
  /** "YES" | "NO". */
  tokenOrPANLookupResult?: string;
}

export interface ResponseIndicators {
  alternateRouteDebitIndicator?: boolean;
  signatureLineIndicator?: boolean;
  signatureDebitRouteIndicator?: boolean;
}

export interface NetworkDetails {
  network?: { network: string };
  debitNetworkId?: string;
  transactionSequence?: string;
  systemTrace?: string;
  debitIssuerData?: string;
  networkResponseStatus?: string;
  networkResponseCode?: string;
  [key: string]: unknown;
}

export interface CheckoutOrderError {
  /** "HOST" | "GATEWAY" | "NETWORK" | "APIM". */
  type?: string;
  code?: string;
  /** Field path that failed validation, e.g. "source.sourceType". */
  field?: string;
  message?: string;
  additionalInfo?: string;
}
