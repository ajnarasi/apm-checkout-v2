# ADR-001 — Adapter State Machine Vocabulary (LOCKED)

**Date**: 2026-04-14
**Status**: Accepted
**Phase gate**: Required by architect review before Phase 3 (55-adapter refactor) can begin.

## Context

In v1, every adapter invented its own ad-hoc event vocabulary and informal state model. This made parity testing impossible and produced subtle bugs when adapters disagreed on what "completed" meant (Klarna fired `PAYMENT_AUTHORIZED` and considered itself done, while iDEAL fired both `PAYMENT_PENDING` and later `PAYMENT_COMPLETED`). The architect review flagged this as the single biggest rework risk for v2 if not locked before the refactor.

## Decision

The `AdapterStateMachine` has exactly 8 states and the legal transitions are fixed. Any adapter behavior outside this vocabulary is a bug.

### States

```
idle → initializing → ready → authorizing → pending → completed
                                                    ↘ failed
                                                    ↘ cancelled
```

| State | Meaning |
|---|---|
| `idle` | Initial state, before any lifecycle method has been called |
| `initializing` | `init()` is running: validating config, loading SDK, calling `doInit()` |
| `ready` | `init()` succeeded, ready to render and authorize |
| `authorizing` | `authorize()` is running: provider widget interaction or backend call |
| `pending` | Async APM, waiting for webhook delivery (terminal in the sync sense, transitional overall) |
| `completed` | TERMINAL: payment was authorized or captured |
| `failed` | TERMINAL: error or provider rejection |
| `cancelled` | TERMINAL: user cancelled or session expired |

### Legal transitions

```
idle          → initializing
initializing  → ready | failed
ready         → authorizing
authorizing   → pending | completed | failed | cancelled
pending       → completed | failed | cancelled
completed     → (terminal)
failed        → (terminal)
cancelled     → (terminal)
```

Self-transitions (e.g. `pending → pending`) are no-ops, not errors.

Any other transition throws `IllegalTransitionError` and is considered a critical bug.

## Single-Source-of-Truth Emission Rule

Terminal `CheckoutEvent`s (`PAYMENT_COMPLETED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`) are emitted from exactly one path: the `AdapterStateMachine.onChange` hook in `AdapterEventEmitter`.

- The HTTP response handler does NOT emit terminal events directly. It only requests a state transition.
- The webhook listener does NOT emit terminal events directly. It only requests a state transition.
- The state machine deduplicates: if two paths both request `pending → completed`, only the first transition fires; the second is a no-op self-transition.

This eliminates the dual-emission bug from v1 where a sync `OrderResult.status = captured` and an async `payment.succeeded` webhook both fired `PAYMENT_COMPLETED` for the same order.

## Consequences

### Positive

- Parity tests are writable: assert event sequences against this vocabulary
- New adapters cannot accidentally introduce inconsistent terminal semantics
- Webhook delivery and HTTP responses can race without producing duplicate events
- The state machine is testable in isolation from the 55 adapters
- Architect concern #2 is addressed

### Negative

- Adapters that need fine-grained sub-states (e.g. Klarna's "load complete vs widget mounted") must encode that internally; only the canonical transitions reach the state machine
- Future async-of-async APMs (e.g. partial settlement) cannot be modeled without a v3 schema bump

### Neutral

- The vocabulary is enforced at the type level via `AdapterState` union — TypeScript catches typos at compile time

## Implementation

- File: `packages/checkout-sdk-browser/src/core/adapter-state-machine.ts`
- File: `packages/checkout-sdk-browser/src/core/adapter-event-emitter.ts`
- Test: `packages/checkout-sdk-browser/test/adapter-state-machine.test.ts`

## Reference

- Architect review concern #2 (final report, 2026-04-14)
- Spec-panel critique (Adzic, Crispin) — see `dapper-splashing-wadler.md`
