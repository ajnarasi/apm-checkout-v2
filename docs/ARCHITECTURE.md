# Architecture — Commerce Hub Checkout SDK v2

## Why v2

v1 fetched session data directly from the browser against convention-based paths like `/api/klarna/session`. That conflates the merchant frontend, merchant backend, and Commerce Hub API into one monolith. v2 enforces the industry-standard pattern (Stripe / Braintree / Adyen): merchant backend creates the session server-side and returns an access token to the frontend, which consumes it.

## The three layers

```
+-------------------+    POST /v2/sessions    +-------------------+    POST /credentials   +---------------+
|  Merchant Frontend|  ---------------------> |  Merchant Backend |  --------------------> |  Commerce Hub |
|  (your site)      |                         |  (reference server|                        |  Credentials  |
|                   |  <--------------------- |   or your own)    |  <-------------------- |               |
+-------------------+    accessToken          +-------------------+    accessToken         +---------------+
        |                                              ^
        |  createCheckout({ credentials.accessToken }) |
        v                                              |
+-------------------+    Bearer accessToken            |
|  SessionClient    |  --------------------------------+
|  (browser SDK)    |
+-------------------+
```

The browser SDK never sees an API key or secret. The package boundary between `@commercehub/checkout-sdk-browser` and `@commercehub/node` enforces this at the type level: there is no module path through which the browser package can import the node package.

## Three packages + shared types

| Package | Runs in | Purpose |
|---|---|---|
| `@commercehub/shared-types` | both | Pure `.d.ts` — `SessionResponse`, `OrderResult`, `CheckoutEvent`, `WebhookEnvelope`. Zero runtime. |
| `@commercehub/node` | server | `CommerceHubClient`, HMAC stub, retry, circuit breaker, token cache, redact |
| `@commercehub/checkout-sdk-browser` | browser | `createCheckout`, `BaseAdapter`, 55 APM adapters, state machine, ACL, webhook listener |
| `@commercehub/reference-server` | server | Express app: `/v2/sessions`, `/v2/orders/:apm`, `/v2/webhooks/:provider`, `/v2/events/:sessionId` |

`shared-types` exists specifically to prevent drift between the browser's `SessionResponse` shape and the node package's `CredentialsResponse` shape. Both packages depend on `shared-types`; neither depends on the other.

## Anti-Corruption Layer (Fowler)

The browser SDK's `order-result-mapper.ts` is the only file that knows Commerce Hub's orders-endpoint wire shape. Adapters consume the domain type `OrderResult`, never the raw CH payload. If Commerce Hub changes their orders contract, exactly one file changes — not 55 adapters.

```
CH wire shape  --[mapOrderResult]-->  OrderResult  --[adapter]-->  CheckoutEvent
                                       (domain)
```

`OrderStatus` has 6 canonical values: `pending_authorization | authorized | captured | declined | failed | cancelled`. CH's `transactionState` strings are normalized into these.

## Composition-based BaseAdapter

`BaseAdapter` delegates to three collaborators, each individually testable:

- `AdapterStateMachine` — owns the canonical state vocabulary and validates transitions
- `AdapterEventEmitter` — translates state changes into `CheckoutEvent`s. Single source of truth for terminal events.
- `AdapterValidator` — config validation at init time

Subclasses override only `id/displayName/pattern` metadata + 3-5 lifecycle hooks. The result: the 16 direct adapters are 30-80 LOC each, and the 39 PPRO adapters come for free from a config-driven factory.

## Canonical state machine

```
idle → initializing → ready → authorizing → pending → completed
                                          ↘         ↘ failed
                                          ↘         ↘ cancelled
                                          ↘ completed
                                          ↘ failed
                                          ↘ cancelled
```

| State | Trigger |
|---|---|
| `idle → initializing` | `init()` called |
| `initializing → ready` | `loadSDK()` + `doInit()` succeeded |
| `initializing → failed` | error in init |
| `ready → authorizing` | `authorize()` called |
| `authorizing → completed` | sync APM, `OrderResult.status = authorized\|captured` |
| `authorizing → pending` | async APM, `OrderResult.status = pending_authorization` |
| `authorizing → failed` | error or `declined` |
| `authorizing → cancelled` | user cancelled |
| `pending → completed` | webhook delivered `payment.succeeded` |
| `pending → failed` | webhook delivered `payment.failed` |
| `pending → cancelled` | webhook delivered `payment.cancelled` or expired |

Terminal states (`completed`, `failed`, `cancelled`) are absorbing — no further transitions allowed. `IllegalTransitionError` is thrown on any out-of-vocabulary transition.

## Single-source-of-truth event emission

Terminal events (`PAYMENT_COMPLETED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`) are emitted from exactly one path: `AdapterEventEmitter.onStateChange()`. Neither HTTP responses nor webhook envelopes emit terminal events directly — they only request state transitions. This eliminates the dual-emission bug where a sync OrderResult and an async webhook both fire `PAYMENT_COMPLETED` for the same order.

## Webhooks + SSE

Async APMs need webhooks to deliver final status. The flow:

```
APM provider --> Commerce Hub --> POST /v2/webhooks/:provider --> InMemoryEventBus
                                       (signature verified)              |
                                                                         v
                                                          GET /v2/events/:sessionId (SSE)
                                                                         |
                                                                         v
                                                          WebhookListener (browser SDK)
                                                                         |
                                                                         v
                                                          BaseAdapter.onWebhookEnvelope()
                                                                         |
                                                                         v
                                                          AdapterStateMachine.transition()
                                                                         |
                                                                         v
                                                          PAYMENT_COMPLETED event
```

### Replay buffer + Last-Event-ID

The in-memory event bus maintains a 50-event ring buffer per `sessionId` for 5 minutes. When the SSE client reconnects (network blip, tab switch), it sends `Last-Event-ID` and the server replays any missed events before resuming live delivery.

### Refuse-multi-instance guard

The in-memory bus has a critical limitation: webhooks landing on instance B are invisible to SSE clients on instance A. To prevent silent data loss, the reference server **refuses to boot** if `INSTANCE_COUNT > 1`. Multi-instance production must implement `RedisEventBus` (interface defined, implementation deferred to v2.1).

## API versioning

- **Major versions** in URL path: `/v2/sessions`, `/v3/sessions`
- **Minor versions** via `Accept` header: `Accept: application/vnd.commercehub.v2.1+json`
- Breaking changes always bump the major version
- Deprecated endpoints stay live for one major version cycle (~12 months)

## Reliability primitives

| Primitive | Where | Default |
|---|---|---|
| Retry | `commerce-hub-node/retry.ts` | 3 attempts, exponential backoff with full jitter, deadline-aware |
| Circuit breaker | `commerce-hub-node/circuit-breaker.ts` | opens after 5 failures in 10s, cools for 30s |
| Token cache | `commerce-hub-node/token-cache.ts` | InMemory TTL+LRU, 1000 entries; Redis interface defined for prod |
| Deadline propagation | `withRetry({ deadline })` | optional, defaults to no deadline |
| PII redaction | `commerce-hub-node/redact.ts` | applied to every log entry |
| Graceful shutdown | `reference-server/observability/shutdown.ts` | 10s drain on SIGTERM/SIGINT |

## Observability

- **Logs**: pino with redact allowlist
- **Metrics**: `prom-client` exposed at `/metrics` — see [OBSERVABILITY.md](./OBSERVABILITY.md)
- **Health**: `/livez` (process), `/readyz` (CH connectivity + breaker state)
- **Correlation**: `X-Correlation-Id` flows browser → reference server → CH → webhooks
