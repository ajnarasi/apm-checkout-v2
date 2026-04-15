export type { SessionResponse } from './session.js';

export type {
  OrderResult,
  OrderStatus,
  NextAction,
  OrderError,
  OrderErrorCode,
} from './order-result.js';

export type {
  CheckoutEvent,
  CheckoutEventType,
  CheckoutEventBase,
  PaymentMethodReadyEvent,
  RedirectRequiredEvent,
  PaymentPendingEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  PaymentCancelledEvent,
  // ── ADR-003 v2.1 additions ──
  AwaitingMerchantCaptureEvent,
  CapturingEvent,
  AuthExpiringEvent,
  AuthExpiredEvent,
  ScriptLoadFailedEvent,
  WebhookEnvelope,
  WebhookKind,
} from './events.js';

// ── v2.1: payment intent + initiator (post-mortem gap #5) ──
export type { PaymentIntent, PaymentInitiator, IntentToWireFields } from './intent.js';
export { intentToWireFields } from './intent.js';

// ── v2.1: AdapterCapabilities matrix (post-mortem gap #4) ──
export type {
  AdapterCapabilities,
  APMPattern,
  AmountTransform,
  CallbackContract,
  SdkMetadata,
  UiCapabilities,
  ServerHandoff,
  BnplCapabilities,
  InteractiveCallbacks,
  IntentCapabilities,
  TokenLifecycle,
  Eligibility,
  CSP,
} from './capabilities.js';
export {
  defaultCallbacks,
  defaultInteractive,
  defaultIntents,
} from './capabilities.js';

// ── v2.1: CH Orders endpoint typed subset ──
export type {
  CheckoutOrdersRequest,
  CheckoutOrdersResponse,
  Address,
  GatewayResponse,
  TransactionProcessingDetails,
  PaymentTokenResponse,
  ProcessorResponseDetails,
  BankAssociationDetails,
  AvsSecurityCodeResponse,
  NetworkTokenProcessingDetails,
  ResponseIndicators,
  NetworkDetails,
  CheckoutOrderError,
} from './ch-orders.js';

// ── v2.2: APM → Commerce Hub mapping table ──
// Single source of truth for every APM the SDK supports. Maps
// adapter id → CH wire fields (paymentSource.sourceType, walletType,
// paymentMethod.provider) + aggregator metadata + currencies + countries.
//
// The string "PPRO" never appears on the CH wire — for PPRO sub-methods
// the CH body just has `paymentMethod.provider = "IDEAL"` (or whichever
// uppercase sub-method) and CH internally routes to PPRO.
export type {
  ApmCommerceHubMapping,
  Aggregator,
  ChSourceType,
} from './apm-mapping.js';
export {
  APM_MAPPING,
  ALL_APM_IDS,
  PPRO_APM_IDS,
  APM_STATS,
  getApmMapping,
  isPproRouted,
} from './apm-mapping.js';
