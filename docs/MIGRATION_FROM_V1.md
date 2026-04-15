# Migration from v1

v1 lives at `checkout-sdk/` and is preserved untouched — the existing test harness demo keeps working. v2 lives at `checkout-sdk-v2/`.

## What changed

| | v1 | v2 |
|---|---|---|
| Session creation | Browser fetches `/api/{apm}/session` | Merchant backend creates session via Commerce Hub `/v1/security/credentials`, returns token to frontend |
| `credentials.accessToken` | optional escape hatch | **REQUIRED** (type-level enforcement) |
| Industry pattern | Non-standard | Stripe / Braintree / Adyen |
| Webhooks | None | First-class with SSE relay |
| State machine | Implicit, per-adapter | Canonical vocabulary, locked |
| Adapter LOC | 70-290 each | 30-80 each (composition) |
| Anti-Corruption Layer | None — adapters knew CH wire format | `order-result-mapper.ts` is the only file that touches CH wire shape |
| Circuit breaker | None | Yes — opens on 5 failures in 10s |
| Deadline propagation | None | Yes — retries respect caller deadlines |
| PII redaction | None | pino-redact allowlist |
| HMAC signing | None | Stubbed; `RefusedProductionError` if used in prod |
| Multi-package | One package | 3 packages + shared-types (browser/secret boundary) |

## Code diff

### v1
```ts
const checkout = createCheckout({
  apm: 'klarna',
  amount: { value: 49.99, currency: 'USD' },
  containerId: 'klarna',
  // No session — SDK fetches /api/klarna/session itself
});
await checkout.init();
```

### v2
```ts
// 1) Merchant backend creates the session
const session = await fetch('/v2/sessions', {
  method: 'POST',
  body: JSON.stringify({ apm: 'klarna', amount: { value: 49.99, currency: 'USD' }, merchantOrderId }),
}).then(r => r.json());

// 2) Browser SDK consumes the token
const checkout = createCheckout({
  apm: 'klarna',
  amount: { value: 49.99, currency: 'USD' },
  merchantOrderId,
  containerId: 'klarna',
  credentials: {
    accessToken: session.accessToken,
    sessionId: session.sessionId,
    chBaseUrl: 'https://your-merchant-backend.example.com',
    providerClientToken: session.providerClientToken,
    eventsBaseUrl: 'https://your-merchant-backend.example.com',
  },
});
await checkout.init();
```

## Event vocabulary

v1 emitted ad-hoc events per adapter. v2 has a fixed set:

- `INITIALIZING`
- `SDK_LOADED`
- `PAYMENT_METHOD_READY`
- `PAYMENT_AUTHORIZING`
- `REDIRECT_REQUIRED`
- `PAYMENT_PENDING` (async only)
- `PAYMENT_AUTHORIZED` (sync auth-only success)
- `PAYMENT_COMPLETED` (terminal, captured)
- `PAYMENT_FAILED` (terminal)
- `PAYMENT_CANCELLED` (terminal)

`parity.test.ts` asserts that every v1 event sequence maps cleanly into this vocabulary.

## Are you migrating?

Both SDKs can coexist in the same monorepo. v1 keeps serving the existing test-harness demo while you build out the v2 integration in your platform. There is no shared global state — the package boundaries enforce isolation.

When you're confident in v2, archive v1 and ship.
