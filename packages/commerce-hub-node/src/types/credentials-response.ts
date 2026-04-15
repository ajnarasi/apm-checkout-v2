/**
 * Commerce Hub Credentials API — RESPONSE types.
 *
 * Typed from spec pages 150-169. Pass-through fields are left as
 * `unknown` to avoid over-specifying.
 */

export interface CredentialsResponse {
  gatewayResponse?: GatewayResponse;
  paymentTokens?: PaymentToken[];
  processorResponseDetails?: ProcessorResponseDetails;
  error?: CredentialsError[];
  /** The access token this SDK extracts for downstream Bearer auth. */
  accessToken?: string;
  /** Optional provider client token (e.g. Klarna client_token). */
  providerClientToken?: string;
  /** Unix epoch ms when the access token expires. */
  expiresAt?: number;
  /** Passthrough for undocumented fields. */
  [key: string]: unknown;
}

export interface GatewayResponse {
  transactionType?: string;
  transactionState?: string;
  transactionOrigin?: string;
  transactionProcessingDetails?: TransactionProcessingDetails;
}

export interface TransactionProcessingDetails {
  orderId?: string;
  transactionId?: string;
  transactionTimestamp?: string;
  apiTraceId?: string;
  clientRequestId?: string;
  apiKey?: string;
}

export interface PaymentToken {
  tokenType?: string;
  tokenValue?: string;
  expirationDate?: string;
  [key: string]: unknown;
}

export interface ProcessorResponseDetails {
  approvalCode?: string;
  approvalStatus?: string;
  processorResponseCode?: string;
  processorResponseMessage?: string;
  hostResponseCode?: string;
  hostResponseMessage?: string;
  [key: string]: unknown;
}

export interface CredentialsError {
  type?: string;
  code?: string;
  field?: string;
  message?: string;
  additionalInfo?: string;
}
