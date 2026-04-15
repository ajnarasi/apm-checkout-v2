export {
  CommerceHubClient,
  type CommerceHubClientConfig,
  type CreatedSession,
  type CreateSessionInput,
  type Logger,
} from './client.js';

export { StaticAuth, type StaticAuthConfig } from './static-auth.js';
export { sign, buildHmacHeaders, type HmacSignInput } from './hmac.js';

export {
  withRetry,
  computeBackoff,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from './retry.js';

export {
  CircuitBreaker,
  type CircuitState,
  type CircuitBreakerConfig,
} from './circuit-breaker.js';

export {
  InMemoryTokenCache,
  type TokenCache,
  type InMemoryTokenCacheConfig,
} from './token-cache.js';

export { RedisTokenCache, type RedisTokenCacheConfig } from './redis-cache.js';

export {
  CommerceHubError,
  ValidationError,
  AuthError,
  ForbiddenError,
  TooEarlyError,
  ServerError,
  NetworkError,
  DeadlineExceededError,
  CircuitOpenError,
  NotImplementedError,
  RefusedProductionError,
  errorFromHttpStatus,
  type CommerceHubErrorCode,
  type CommerceHubErrorContext,
} from './errors.js';

export { redact, maskEmail, redactHeaders, REDACTED_VALUE } from './redact.js';

export type {
  CredentialsRequest,
  Amount,
  Source,
  Customer,
  Address,
  OrderData,
  OrderItem,
  TransactionDetails,
} from './types/credentials-request.js';

export type {
  CredentialsResponse,
  GatewayResponse,
  TransactionProcessingDetails,
  PaymentToken,
  ProcessorResponseDetails,
  CredentialsError,
} from './types/credentials-response.js';

// ── v2.1: Checkout Orders endpoint client (POST /checkouts/v1/orders) ──
export {
  CheckoutOrdersClient,
  type CheckoutOrdersClientConfig,
  type OrderResult as CheckoutOrderResult,
  type AuthorizeInput,
  type CaptureInput,
  type VoidInput,
  type RefundInput,
  type PaymentSourceInput,
} from './orders-client.js';

// ── v2.1: Tenant credential resolver (architect Pass #2 P0 #6) ──
export {
  SingleTenantResolver,
  type TenantCredentialResolver,
  type TenantContext,
  type ResolvedTenantCredentials,
  type SingleTenantResolverConfig,
} from './tenant-resolver.js';
