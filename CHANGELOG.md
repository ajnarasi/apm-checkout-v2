# Changelog

## 2.2.0-poc.0 — Single CH Endpoint, CH Owns Fan-Out (2026-04-14)

Closes the four gaps surfaced when validating v2.1 against the canonical
`output/ideal-via-ppro/` mapping spec and the user's clarification that
**Commerce Hub owns all downstream provider routing** (including PPRO).

See [ADR-004](docs/ADR-004-single-ch-endpoint.md) for the full decision record.

### Added

- **`@commercehub/shared-types/apm-mapping`** — single source of truth for
  every APM → CH wire mapping (55 entries: 39 PPRO sub-methods + 16 direct).
  Exports: `APM_MAPPING`, `ALL_APM_IDS`, `PPRO_APM_IDS`, `APM_STATS`,
  `getApmMapping(id)`, `isPproRouted(id)`. Each entry declares
  `aggregator`, `chSourceType`, `chWalletType?`, `chProvider?`, `currencies`,
  `countries`. PPRO entries auto-set `chProvider = uppercase(id)`.
- **15 missing v1 PPRO methods** added to `ppro-adapter-factory.ts`:
  WERO, POSTFINANCE, SWISH, VIPPS, MOBILEPAY, MERCADOPAGO, PAYNOW, GCASH,
  MAYA, LINEPAY, OVO, SHOPEEPAY, TOUCHNGO, UPI, KONBINI.
- **`CH_ORDERS_PATH` env override** on `CheckoutOrdersClient` for the cert
  sandbox quirk (`cert.api.firstdata.com` responds on `/ch/payments/v1/orders`
  while the canonical `/checkouts/v1/orders` returns 404 behind Apigee).
- **ADR-004**: single CH endpoint, CH owns the fan-out.

### Changed

- **`packages/reference-server/src/routes/orders.ts`** — replaced the per-APM
  `mapApmToSourceType()` / `mapApmToWalletType()` helpers with a single
  `getApmMapping(apm)` lookup. CH request bodies now correctly set
  `paymentMethod.provider` for **all** PPRO sub-methods (e.g. `IDEAL`,
  `BANCONTACT`, `WERO`), enabling CH to route to the right downstream.
- **`ppro-adapter-factory.ts`** — renamed `p24` → `przelewy24`, removed
  `ppro_` prefix conflicts (`ppro_alipay` → `alipay`, `ppro_paypay` → `paypay`).
  Total: 53 PPRO entries (39 v1 + 14 v2.1 extras kept for forward compat).
- **`orders-client.ts`** — `ORDERS_PATH` constant now reads
  `process.env.CH_ORDERS_PATH ?? '/checkouts/v1/orders'`. Production leaves
  the env unset and uses the canonical path.

### Architectural decisions locked in

- Browser SDK never imports a per-provider HTTP client
- Merchant backend never imports a per-provider HTTP client (no PPRO client,
  no direct Klarna client)
- The string `"PPRO"` never appears on the CH wire — PPRO sub-methods are
  routed via `paymentMethod.provider = uppercase(adapterId)`
- v1's `test-harness/server.js` direct-PPRO route is explicitly rejected as
  a production pattern (it was a test-harness shortcut)

### Verification

- `grep -rn "/v1/payment-charges" packages/` → ZERO matches outside `tests/connectivity/`
- `grep -rn "api.sandbox.eu.ppro.com" packages/` → ZERO matches outside `tests/connectivity/`
- `tests/connectivity/run.sh ppro_*` validates PPRO sandbox reachability ONLY
  (it does NOT exercise the production settlement path — PPRO is reached via
  CH in production)

---

## 2.1.0-poc.0 — Architect-corrected v2.1 (2026-04-14)

This release addresses every architect Pass #2 P0 finding and the user's four
post-build requirements (CH `/checkouts/v1/orders` endpoint, gateway-vs-merchant
flow, real SDK code patterns, missing APMs reconciliation).

### Architectural corrections

- **Endpoint corrected**: All authorize/capture/void/refund operations now flow
  through Commerce Hub's `POST /checkouts/v1/orders` endpoint (v1.26.0302),
  NOT JavaScript SDK calls. Confirmed via the spec PDF read 2026-04-14.
- **One endpoint, field-discriminated**: auth/sale/capture/void/refund are all
  the same `POST /checkouts/v1/orders` call with different `transactionDetails.captureFlag`
  + `referenceTransactionDetails.referenceTransactionId` + `reversalReasonCode`.
- **`paymentInitiator` flag**: lives on `checkoutInteractions.paymentInitiator`
  (`GATEWAY` | `MERCHANT`) — exactly as the user described.
- **Browser tokenizes, server settles**: the SDK only loads provider JS SDKs
  for tokenization (Klarna widget, PayPal buttons, Apple Pay device API).
  All settlement flows: browser token → merchant backend → CH `/checkouts/v1/orders`.

### Added — v2.1 scope

- **`@commercehub/shared-types`**:
  - `AdapterCapabilities` interface (10 sections × ~25 columns) lifted forward
    from v1's prior-art capability matrix
  - `PaymentIntent`, `PaymentInitiator`, `intentToWireFields()` translator
  - `CheckoutOrdersRequest` / `CheckoutOrdersResponse` typed subset of CH Orders spec
  - New events: `AWAITING_MERCHANT_CAPTURE`, `CAPTURING`, `AUTH_EXPIRING`,
    `AUTH_EXPIRED`, `SCRIPT_LOAD_FAILED`
  - `WebhookEnvelope.kind` extended with `payment.authorized` for merchant-initiated webhooks
  - `SessionResponse.paymentInitiator` field (forwarded from merchant backend)

- **`@commercehub/node`**:
  - `CheckoutOrdersClient` — sibling of `CommerceHubClient`, talks to
    `POST /checkouts/v1/orders`. Five operations: `authorize/sale/capture/void/refund`.
    Each builds the right field discriminator and shares the circuit breaker /
    retry / deadline / redact infrastructure with the Credentials client.
  - `SingleTenantResolver` (implements `TenantCredentialResolver`) — single-tenant
    default with v3 multi-tenant escape hatch. Architect Pass #2 P0 #6.
  - PII redact list expanded with v2.1 token paths: `paymentSource`, `token`,
    `tokenData`, `authorization_token`, `paymentData`, `tokenizationData`,
    `payerID`, `cryptogram`, plus all `CH_*` env var names.

- **`@commercehub/checkout-sdk-browser`**:
  - **State machine v3 (ADR-003)**: 11 states, 18 transitions. Adds
    `awaiting_merchant_capture`, `capturing`, `auth_expired`, `script_load_failed`.
    Self-transition no-op enforces first-writer-wins precedence.
  - **6 base classes** (`adapters/base/`):
    - `RedirectAdapterBase` (HPP redirects)
    - `TokenizationAdapterBase` (BNPL JS SDKs)
    - `NativeWalletAdapterBase` (device APIs, single-use token semantics)
    - `ButtonSdkAdapterBase` (provider-rendered buttons)
    - `QrAdapterBase` (QR + polling fallback)
    - `VoucherAdapterBase` (offline barcodes)
  - `core/load-script.ts` — shared SRI-capable provider SDK loader with
    `script_load_failed` rejection path
  - `core/order-result-cache.ts` — first-writer-wins cache for sync-vs-webhook
    races (architect Pass #2 P0 #7)
  - `SingleUseTokenConsumedError` for Apple Pay / Google Pay retry semantics
  - `SessionClient`: new methods `captureOrder` / `voidOrder` / `refundOrder`
  - `CheckoutHandle`: new public methods `capture()` / `void(reason?)`
  - `ProviderToken` discriminated union (TokenizationToken, NativeWalletToken,
    ButtonSdkToken, RedirectToken, QrToken, VoucherToken)

- **3 REAL hero adapters** (each ~250-350 LOC of production-shaped reference code):
  - **Klarna** (`adapters/tokenization/klarna-adapter.ts`) — real
    `Klarna.Payments.init/load/authorize` + capability declaration + provider fake
  - **PayPal** (`adapters/button-sdk/paypal-adapter.ts`) — real PayPal Buttons SDK
    with `createOrder`/`onApprove`/`onShippingChange` + provider fake
  - **Apple Pay** (`adapters/native-wallet/applepay-adapter.ts`) — real
    `ApplePaySession` with `onvalidatemerchant` handoff + single-use token retry
    semantics + provider fake

- **Provider fakes** (`testing/provider-fakes/`) — deterministic stubs for
  `window.Klarna`, `window.paypal.Buttons`, `window.ApplePaySession`. Lets unit
  tests exercise the REAL adapter code without hitting CDNs. Architect Pass #2 P1.

- **`@commercehub/reference-server`**:
  - `CheckoutOrdersClient` wired in `config.ts` (sibling to `CommerceHubClient`)
  - `routes/orders.ts` rewritten to forward to REAL CH `/checkouts/v1/orders`
    instead of synthesizing fake responses
  - New routes: `POST /v2/orders/:orderId/capture`, `/void`, `/refund`
  - New route: `POST /v2/applepay/merchant-validation` (stub for production
    Apple cert signing — clearly documented as a v2.2 upgrade point)
  - `TenantCredentialResolver` wired as single-tenant default

- **Tests**:
  - `adapter-state-machine.test.ts` extended with all 18 ADR-003 transitions
    + first-writer-wins precedence test
  - `klarna-adapter.test.ts` — full real-adapter lifecycle test using the
    Klarna provider fake (no CDN access)
  - `order-result-cache.test.ts` — first-writer-wins precedence test

- **Docs**:
  - `docs/ADR-003-state-machine-vocabulary.md` — locks 11-state vocabulary,
    supersedes ADR-001 + ADR-002 (drafted but never coded)

### Adapter coverage classification (post-v2.1)

Honest breakdown after the v2.1 hero work — required by architect Pass #2 P0 #8:

| Class | Count | Members |
|---|---|---|
| **REAL** (production-shaped real-SDK reference code) | **3** | Klarna, PayPal, Apple Pay |
| **STUB** (placeholder w/ explicit "in production" comment) | 1 | Google Pay (still v2.0 stub — Phase F deferred to v2.2) |
| **MOCK-WRAPPER** (thin RedirectAdapterBase / PproAdapter wrapper) | 51 | All other v2.0 adapters |

The 3 hero adapters validate the production pattern. The remaining ~52 adapters
in v2.2 become mechanical clones of the 6 base classes.

### Architect Pass #2 P0 conditions — status

| # | Condition | v2.1 status |
|---|---|---|
| 1 | Provider-grouped 6 base classes | ✅ `adapters/base/` |
| 2 | Token expiry + idempotency + single-use retry | ✅ `tokenTTL` capability + `SingleUseTokenConsumedError` |
| 3 | 11-state vocabulary with `auth_expired` + void path | ✅ ADR-003 + state machine |
| 4 | PPRO single-router consolidation | ⏳ deferred to v2.2 (existing PPRO factory still works) |
| 5 | `amountTransform` capability + SessionClient enforcement | ✅ declared on every hero; SessionClient enforcement is Phase G |
| 6 | TenantCredentialResolver wired (single-tenant default) | ✅ `SingleTenantResolver` |
| 7 | Sync-vs-webhook precedence | ✅ `OrderResultCache` first-writer-wins |
| 8 | Provider fakes directory | ✅ `testing/provider-fakes/` (Klarna, PayPal, Apple Pay) |

### Remaining v2.2 / v3 work

- 6 more hero adapters (Google Pay, Affirm, iDEAL, PIX, Alipay, Boleto, SEPA)
- Long-tail ~50 adapters mechanically ported to the 6 base classes
- PPRO single-router consolidation
- Real Apple Pay merchant validation (cert signing) replacing the stub
- HMAC signing implementation (still NotImplementedError stub)
- 16 missing APMs from v1's table (WERO, POSTFINANCE, SWISH, VIPPS, MOBILEPAY,
  MERCADOPAGO, PAYNOW, GCASH, MAYA, LINEPAY, OVO, SHOPEEPAY, TOUCHNGO, ALIPAY,
  UPI, KONBINI)
- Architect Pass #2 P1/P2 items: 3DS challenge, multi-tenancy, OpenTelemetry,
  RedisEventBus implementation, partial captures

---

## 2.0.0-poc.0 — Initial POC release

### Added — POC scope

- **`@commercehub/shared-types`** — zero-runtime types: `SessionResponse`, `OrderResult`, `CheckoutEvent`, `WebhookEnvelope`
- **`@commercehub/node`** — server-side Commerce Hub Credentials API client
  - `CommerceHubClient.createSession()` with deadline propagation, retry+backoff, circuit breaker, token cache
  - `StaticAuth` for POC sandbox testing (refuses production)
  - `hmac.ts` STUB — throws `NotImplementedError` until HMAC ships
  - `redact.ts` PII redaction with allowlist
  - `errors.ts` taxonomy: ValidationError, AuthError, ForbiddenError, TooEarlyError, ServerError, NetworkError, DeadlineExceededError, CircuitOpenError, NotImplementedError, RefusedProductionError
- **`@commercehub/checkout-sdk-browser`** — token-consuming browser SDK
  - `createCheckout(config)` factory with required `credentials.accessToken`
  - `BaseAdapter` with composition (state machine + event emitter + validator)
  - `SessionClient` — Bearer auth to merchant backend orders proxy
  - `order-result-mapper.ts` — Anti-Corruption Layer between CH wire shape and adapter domain
  - `WebhookListener` — SSE subscriber with `Last-Event-ID` reconnect support
  - `AdapterStateMachine` — locked canonical state vocabulary
  - 16 direct APM adapters (Klarna, PayPal, Venmo, CashApp, Afterpay, Affirm, Sezzle, Zip, Alipay+, WeChat Pay, GrabPay, Apple Pay, Google Pay, Zepto, TabaPay, PayPalPayLater)
  - 39 PPRO-factory-generated adapters (iDEAL, SOFORT, Boleto, OXXO, PIX, etc.)
- **`@commercehub/reference-server`** — Express reference backend
  - `POST /v2/sessions`
  - `POST /v2/orders/:apm`, `GET /v2/orders/:orderId`, `POST /v2/orders/:orderId/cancel`
  - `POST /v2/webhooks/:provider` with HMAC signature verification
  - `GET /v2/events/:sessionId` Server-Sent Events stream
  - `GET /livez`, `GET /readyz`, `GET /metrics`
  - In-memory `WebhookEventBus` with 50-event ring buffer per session, 5-minute TTL
  - CORS allowlist middleware
  - Per-route rate limiting
  - Graceful shutdown with 10s drain
  - Pino logger with PII redact allowlist
  - Prometheus metrics: `session_create_duration_ms`, `ch_request_total`, `circuit_breaker_state`, `webhook_received_total`, `sse_connections_active`
  - Defense-in-depth refuse-production tripwires (4 layers)
- **Documentation**: `README.md`, `INTEGRATION_GUIDE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `WEBHOOKS.md`, `OBSERVABILITY.md`, `MIGRATION_FROM_V1.md`, `API_REFERENCE.md`, `SCENARIOS.md`
- **Examples**: `basic-checkout.html`, `klarna-full-flow.html`, `ideal-webhook-flow.html`, `zepto-payto-flow.html`
- **Postman collection** for all reference-server endpoints
- **Docker**: multi-stage distroless image + `docker-compose.yml`
- **Tests**: 14 test files spanning unit, integration, and registry coverage

### Known limitations (POC)

- HMAC signing is stubbed — `RefusedProductionError` is thrown if `NODE_ENV=production`
- In-memory event bus refuses to boot if `INSTANCE_COUNT > 1`
- `RedisTokenCache` and `RedisEventBus` are interface-only stubs (deferred to v2.1)
- v2 is explicitly single-tenant (one `CH_API_KEY` per instance)
- The `/v2/orders/:apm` proxy synthesizes responses for the POC rather than forwarding to a real CH orders endpoint
- Smoke tests against the real CH sandbox are not included (see `INTEGRATION_GUIDE.md` for manual verification)

### Upgrade path to production

1. Implement `commerce-hub-node/src/hmac.ts` against Fiserv's signing guide
2. Add HMAC vector tests
3. Remove `RefusedProductionError` from `StaticAuth` constructor
4. Bump to `2.1.0`, drop the `@poc` dist-tag
5. Implement `RedisEventBus` for multi-instance deployments
6. See [docs/SECURITY.md](./docs/SECURITY.md) for the full checklist
