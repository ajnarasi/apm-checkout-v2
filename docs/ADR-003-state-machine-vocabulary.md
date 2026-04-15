# ADR-003 — Adapter State Machine Vocabulary v3 (LOCKED)

**Date**: 2026-04-14
**Status**: Accepted — supersedes ADR-001 and ADR-002
**Phase gate**: Required by architect review (Pass #2) before Phase E.1 (state machine update) and Phase F (hero adapters) can begin.

## Context

ADR-001 locked an 8-state vocabulary for the original v2 build. ADR-002 (drafted but never coded) extended it to 10 states with `awaiting_merchant_capture` + `capturing` to support merchant-initiated payment flows. The architect's second-pass review identified two more required states:

1. **`auth_expired`** — auth holds expire (Klarna 7d, PayPal 3d auth/29d honor, card rails 7–30d). Without an expiry transition the state machine never frees the merchant from the `awaiting_merchant_capture` state, leading to silent stale orders.
2. **`script_load_failed`** — distinct from generic `failed` so ops dashboards can segment provider-CDN failures from provider-rejection failures.

Plus an additional legal transition for the void-from-awaiting-capture path that was missing from ADR-002.

The Commerce Hub Orders spec (v1.26.0302, `/checkouts/v1/orders`) read on 2026-04-14 confirmed:
- One endpoint handles auth/sale/capture/void/refund — discriminated by `transactionDetails.captureFlag` + `referenceTransactionDetails.referenceTransactionId` + `reversalReasonCode`
- `checkoutInteractions.paymentInitiator` is the GATEWAY|MERCHANT toggle
- Response `gatewayResponse.transactionState` carries the terminal state (AUTHORIZED, etc.)

The state machine vocabulary must map cleanly to these CH wire fields.

## Decision

The `AdapterStateMachine` has exactly 11 states and 18 legal transitions. Any adapter behavior outside this vocabulary is a bug.

### States (11)

```
idle → initializing → ready → authorizing → pending → awaiting_merchant_capture → capturing → completed
                          ↘                ↘                         ↘                   ↘ failed
                          ↘                ↘                         ↘                     ↘ cancelled
                          ↘                ↘ failed                  ↘ auth_expired
                          ↘                ↘ cancelled               ↘ failed
                          ↘ script_load_failed
                          ↘ failed
```

| State | Meaning | Triggered by |
|---|---|---|
| `idle` | Initial state, before any lifecycle method has been called | constructor |
| `initializing` | `init()` is running — validating config, loading SDK, calling `doInit()` | `init()` called |
| `ready` | `init()` succeeded, ready to render and authorize | provider SDK loaded + `doInit()` resolved |
| `authorizing` | `authorize()` is running — provider widget interaction or backend tokenization | `authorize()` called |
| `pending` | Async APM, waiting for webhook delivery (intermediate, not terminal) | provider returned async result with `WEB_REDIRECTION` or `QR_CODE` |
| `awaiting_merchant_capture` | Auth-only succeeded, waiting for merchant to call `capture()` | CH returned `AUTHORIZED` with `paymentInitiator='MERCHANT'` |
| `capturing` | `capture()` is running — second CH call in flight | merchant called `checkout.capture()` |
| `completed` | TERMINAL: payment was authorized + captured (sale or auth+capture) | CH returned terminal success state |
| `failed` | TERMINAL: error or provider rejection | error in any non-terminal state |
| `cancelled` | TERMINAL: user cancelled OR explicit void OR session expired | user action / explicit void / webhook cancellation |
| `auth_expired` | TERMINAL: auth hold TTL elapsed before merchant captured | TTL guard fired in `awaiting_merchant_capture` |
| `script_load_failed` | TERMINAL (subtype of failed): provider CDN load failed | `loadProviderSdk()` rejected |

### Legal transitions (18)

```
idle                       → initializing
initializing               → ready
initializing               → script_load_failed
initializing               → failed
ready                      → authorizing
authorizing                → pending                       (async APM)
authorizing                → awaiting_merchant_capture     (sync auth-only, paymentInitiator=MERCHANT)
authorizing                → completed                     (sync sale, paymentInitiator=GATEWAY)
authorizing                → failed
authorizing                → cancelled
pending                    → awaiting_merchant_capture     (webhook delivers auth-only, paymentInitiator=MERCHANT)
pending                    → completed                     (webhook delivers terminal success, paymentInitiator=GATEWAY)
pending                    → failed
pending                    → cancelled
awaiting_merchant_capture  → capturing                     (merchant called capture())
awaiting_merchant_capture  → cancelled                     (merchant called void())
awaiting_merchant_capture  → auth_expired                  (TTL guard fired)
capturing                  → completed
capturing                  → failed
```

Self-transitions (e.g. `pending → pending`) are no-ops, not errors. Any other transition throws `IllegalTransitionError` and is considered a critical bug.

### Mapping to CH `transactionState` values

The browser-side state machine consumes `OrderResult.status` (the ACL domain type). The ACL `mapOrderResult()` translates CH wire `gatewayResponse.transactionState` to `OrderStatus`, then `BaseAdapter.resolveAuthorizeResult()` maps `OrderStatus` to a state machine transition.

| CH `transactionState` | ACL `OrderStatus` | State machine transition |
|---|---|---|
| `AUTHORIZED` (paymentInitiator=GATEWAY) | `authorized` | `authorizing → completed` |
| `AUTHORIZED` (paymentInitiator=MERCHANT) | `authorized` | `authorizing → awaiting_merchant_capture` |
| `CAPTURED` / `SETTLED` / `COMPLETED` | `captured` | `authorizing → completed` OR `capturing → completed` |
| `PENDING` / `WAITING` / `AUTHORIZATION_PENDING` | `pending_authorization` | `authorizing → pending` |
| `DECLINED` | `declined` | `* → failed` |
| `FAILED` | `failed` | `* → failed` |
| `CANCELLED` / `VOIDED` | `cancelled` | `* → cancelled` |
| (TTL elapsed, no CH call) | n/a | `awaiting_merchant_capture → auth_expired` |
| (CDN load failed, no CH call) | n/a | `initializing → script_load_failed` |

The `paymentInitiator` field comes from `SessionResponse.paymentInitiator` (which the merchant backend sets when calling CH `/checkouts/v1/orders` and forwards to the browser via `POST /v2/sessions`).

## Single-Source-of-Truth Emission Rule (unchanged from ADR-001/002)

Terminal `CheckoutEvent`s (`PAYMENT_COMPLETED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`, plus the new `AWAITING_MERCHANT_CAPTURE` and `CAPTURING` and `AUTH_EXPIRED`) are emitted from exactly one path: the `AdapterStateMachine.onChange` hook in `AdapterEventEmitter`.

- HTTP response handlers do NOT emit terminal events directly. They only request state transitions.
- Webhook listeners do NOT emit terminal events directly. They only request state transitions.
- Polling result handlers do NOT emit terminal events directly. Same rule.
- Explicit `capture()` / `void()` calls do NOT emit terminal events directly. Same rule.
- The state machine deduplicates: if two paths request the same transition, only the first transition fires; the second is a no-op self-transition.

This eliminates the dual-emission bug from v1 where a sync `OrderResult.status = captured` and an async `payment.succeeded` webhook both fired `PAYMENT_COMPLETED` for the same order. With merchant-initiated flows where capture is a SEPARATE second call, this rule is even more critical — the response from the capture call AND any webhook arriving simultaneously must converge on exactly one `PAYMENT_COMPLETED`.

## Sync-vs-Webhook Precedence Rule

When the same order has both a sync HTTP response from CH AND an async webhook arriving in the same moment, **first-writer-wins**:

1. The first state transition request that the machine accepts becomes terminal.
2. Subsequent transition requests for the same order become no-op self-transitions (the machine is already in `completed`/`failed`/`cancelled`).
3. An `OrderResultCache` keyed on `sessionId` stores the canonical OrderResult; both paths read+write through it so the merchant frontend always sees a consistent snapshot.

## Auth Hold TTL

Each adapter declares `authHoldTTL` in milliseconds via `AdapterCapabilities.bnpl.authHoldTTL` (or a more general field name). Defaults per provider category:

| Provider category | Default TTL |
|---|---|
| Klarna BNPL | 7 days |
| PayPal authorize | 3 days (29 days honored on capture) |
| Card rails (Visa/MC) | 7 days |
| Affirm | 7 days |
| Afterpay | 30 days |
| Bank transfers (iDEAL, SEPA) | not applicable — sync settlement |
| Voucher (Boleto, OXXO) | 1-3 days settlement window |

When `awaiting_merchant_capture` is entered, a timer is armed. At T-24h before TTL elapse, the machine emits `AUTH_EXPIRING` (warning, not a transition). At T=0, the machine transitions to `auth_expired`.

The merchant SHOULD call `capture()` or `void()` before the TTL. If they don't, `auth_expired` is a terminal state and they cannot recover the order — they must restart from a new session.

## Consequences

### Positive
- Parity tests are writable: assert event sequences against this vocabulary
- New adapters cannot accidentally introduce inconsistent terminal semantics
- Webhook delivery, sync responses, polling, and explicit capture calls can all race without producing duplicate events
- Auth holds cannot leak silently — `auth_expired` forces the merchant to handle expiry
- CDN load failures are distinguishable from provider rejections in metrics/dashboards
- The merchant `capture()` and `void()` flows are first-class citizens, not afterthoughts
- Architect Pass #2 concerns #2, #3, #5 (state machine, multi-tenancy precondition, sync/async unification) are addressed structurally

### Negative
- Adapters that need fine-grained sub-states must encode them internally; only the canonical transitions reach the state machine
- The 11-state vocabulary is a non-trivial mental model for new contributors. ADR-003 + this diagram must be referenced in onboarding docs.
- Future async-of-async APMs (e.g. partial settlement with multiple captures against one auth) cannot be modeled without a v4 schema bump

### Neutral
- The vocabulary is enforced at the type level via `AdapterState` union — TypeScript catches typos at compile time
- All transitions are tested via parameterized parity test (one row per transition × one row per affected adapter)

## Implementation

- File: `packages/checkout-sdk-browser/src/core/adapter-state-machine.ts` (UPDATED in Phase E.1)
- File: `packages/checkout-sdk-browser/src/core/adapter-event-emitter.ts` (UPDATED in Phase E.1 to emit new events)
- File: `packages/checkout-sdk-browser/src/core/order-result-cache.ts` (NEW in Phase E.3)
- File: `packages/shared-types/src/events.ts` (UPDATED in Phase C with `AWAITING_MERCHANT_CAPTURE`, `CAPTURING`, `AUTH_EXPIRED`, `AUTH_EXPIRING`, `SCRIPT_LOAD_FAILED`)
- Test: `packages/checkout-sdk-browser/test/adapter-state-machine.test.ts` (UPDATED to cover all 18 transitions)

## References

- Architect Pass #1 review (concerns #2, #5)
- Architect Pass #2 review (concerns #1-#8 + P0/P1 list)
- Spec-panel critique (Adzic, Crispin) — see `dapper-splashing-wadler.md`
- Commerce Hub Orders spec v1.26.0302 — `POST /checkouts/v1/orders` (pages 1-150)
- ADR-001 (superseded)
- ADR-002 (drafted but never coded — superseded)
