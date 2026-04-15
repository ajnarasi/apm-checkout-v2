# Integration Guide — Commerce Hub Checkout SDK v2

A 15-minute walkthrough from clone to first authorized sandbox payment.

> **POC mode reminder**: this SDK uses static access tokens. It refuses to boot when `NODE_ENV=production`. Implement HMAC signing in `@commercehub/node` before any production deployment. See [SECURITY.md](./SECURITY.md).

## Prerequisites

- Node.js 18.17 or later
- Commerce Hub sandbox credentials (API key + a long-lived access token from go.sandbox.firstdata.com)
- Either Docker OR npm

---

## Option A — Docker (recommended)

```bash
git clone <repo>
cd checkout-sdk-v2/packages/reference-server
cp .env.example .env
# Edit .env with your CH_API_KEY and CH_STATIC_ACCESS_TOKEN
docker compose up
```

The reference server listens on `http://localhost:3848`. Open `examples/basic-checkout.html` in a browser to run a sandbox payment.

---

## Option B — Local Node

```bash
git clone <repo>
cd checkout-sdk-v2
npm install
npm run build

cd packages/reference-server
cp .env.example .env
# Edit .env with your CH_API_KEY and CH_STATIC_ACCESS_TOKEN
npm run dev
```

Open `examples/basic-checkout.html` in a browser via a static server (e.g. `npx serve checkout-sdk-v2/examples`).

---

## Required environment variables

| Var | Required? | Description |
|---|---|---|
| `CH_BASE_URL` | yes | `https://cert.api.firstdata.com` for sandbox |
| `CH_API_KEY` | yes | From the Fiserv developer portal |
| `CH_STATIC_ACCESS_TOKEN` | yes (POC) | Long-lived bearer token |
| `CH_WEBHOOK_SECRET` | yes (prod) | HMAC secret for webhook signature verification |
| `CORS_ORIGINS` | yes (prod) | Comma-separated allowlist. No `*`. |
| `NODE_ENV` | no | `development` (default), `test`, or `production` (refuses to boot in POC mode) |
| `PORT` | no | Default `3848` |
| `INSTANCE_COUNT` | no | Default `1`. >1 refuses to boot — webhook event bus is in-memory. |

---

## The two-call pattern

Every checkout runs the same two HTTP calls, exactly like Stripe / Adyen / Braintree:

### 1. Merchant backend → `POST /v2/sessions`

```bash
curl -X POST http://localhost:3848/v2/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "apm": "klarna",
    "amount": { "value": 49.99, "currency": "USD" },
    "merchantOrderId": "ORDER-12345"
  }'
```

Response:
```json
{
  "accessToken": "ch-tok-abc",
  "sessionId": "CH-ORDER-1",
  "expiresAt": 1700000000000,
  "providerClientToken": "klarna-ct-xyz",
  "apm": "klarna",
  "currency": "USD",
  "amountMinor": 4999
}
```

### 2. Merchant frontend → `createCheckout({ credentials })`

```ts
import { createCheckout } from '@commercehub/checkout-sdk-browser';

const checkout = createCheckout({
  apm: 'klarna',
  amount: { value: 49.99, currency: 'USD' },
  merchantOrderId: 'ORDER-12345',
  credentials: {
    accessToken: session.accessToken,
    sessionId: session.sessionId,
    chBaseUrl: 'https://your-merchant-backend.example.com',
    providerClientToken: session.providerClientToken,
    eventsBaseUrl: 'https://your-merchant-backend.example.com',
  },
  containerId: 'klarna-container',
  returnUrls: {
    successUrl: 'https://your-site.example.com/checkout/success',
    cancelUrl: 'https://your-site.example.com/checkout/cancel',
  },
});

checkout.onAny((event) => {
  console.log(event.type, event);
});

await checkout.init();
await checkout.render();
await checkout.authorize();
```

That's the entire integration. The SDK handles state transitions, error mapping, redirects, webhooks, and SSE delivery.

---

## Async APMs and webhooks

Roughly half of the 55 supported APMs are async (PayTo, iDEAL, Boleto, Alipay+, most PPROs). For these:

1. `authorize()` returns immediately with `status: 'pending_authorization'`
2. The state machine transitions to `pending` and emits `PAYMENT_PENDING`
3. The user authorizes at the bank / wallet
4. Commerce Hub sends a webhook to `POST /v2/webhooks/:provider` on your reference server
5. The reference server publishes to its in-memory event bus
6. SSE relays the event to the connected browser
7. The browser SDK's `WebhookListener` drives the state machine to `completed`
8. Your code sees `PAYMENT_COMPLETED`

You do not need to write any of this — it's wired automatically by `createCheckout()`.

See [WEBHOOKS.md](./WEBHOOKS.md) for signature verification, replay semantics, and multi-instance gotchas.

---

## Single-tenant only (v2)

The v2 reference server is **explicitly single-tenant**. One `CH_API_KEY` per instance. Multi-tenant support is on the v3 roadmap with a clean-sheet `TenantContext` interface.

If you operate multiple merchant accounts, run one reference-server instance per tenant.

---

## Production checklist (when HMAC ships)

- [ ] HMAC signing implemented in `@commercehub/node/src/hmac.ts`
- [ ] Removed the `@poc` dist-tag from package.json
- [ ] Removed the `RefusedProductionError` throw in `static-auth.ts`
- [ ] `NODE_ENV=production`, `CORS_ORIGINS` populated with explicit allowlist
- [ ] `CH_WEBHOOK_SECRET` rotated and stored in your secret manager
- [ ] `CH_BASE_URL` matches `https://*.firstdata.com`
- [ ] Multi-instance deployment uses `RedisEventBus` (not the in-memory default)
- [ ] PII redaction allowlist reviewed for your specific customer payload shape
- [ ] Prometheus `/metrics` scraped and dashboarded
- [ ] `/livez` and `/readyz` wired to your orchestrator probes
