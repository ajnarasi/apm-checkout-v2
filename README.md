# Checkout SDK v2.1 — Commerce Hub Orders Integration

A ready-to-use, industry-standard checkout SDK wired to Fiserv Commerce Hub
across **two server-side endpoints**:

- `POST /payments-vas/v1/security/credentials` — session creation (Credentials API, v1.26.0302)
- `POST /checkouts/v1/orders` — auth/sale/capture/void/refund settlement (Orders API, v1.26.0302)

Supports 55 Alternative Payment Methods (APMs) across 6 patterns: BNPL,
redirect-wallet, bank-redirect, QR-code, voucher-cash, and native-wallet.

## Adapter coverage classification (v2.1)

Honest breakdown — not the marketing number:

| Class | Count | Members |
|---|---|---|
| **REAL** (production-shaped real-SDK reference code) | **3** | Klarna · PayPal · Apple Pay |
| **STUB** (placeholder w/ explicit "in production" comment) | 1 | Google Pay |
| **MOCK-WRAPPER** (thin RedirectAdapterBase / PproAdapter wrapper) | 51 | All other adapters from v2.0 |

The 3 hero adapters validate the production-shaped pattern using the 6 base
classes in `adapters/base/`. Each is 250–350 LOC of copy-paste-ready reference
code with capability declarations, real provider SDK calls, and a co-located
provider fake for testing without CDN access. v2.2 will mechanically clone the
pattern across the remaining ~52 adapters.

> **⚠ POC MODE**: This SDK ships with **static access token authentication**
> for sandbox testing only. HMAC signing is stubbed and will throw
> `NotImplementedError`. Do NOT deploy to production until HMAC is implemented —
> multiple defense-in-depth tripwires will refuse to boot in that configuration.
> See [docs/SECURITY.md](./docs/SECURITY.md).

## Packages

| Package | Purpose |
|---|---|
| `@commercehub/shared-types` | Zero-runtime TypeScript types shared across browser + node |
| `@commercehub/node` | Server-side Commerce Hub client (HMAC stub, retry, circuit breaker, cache) |
| `@commercehub/checkout-sdk-browser` | Browser SDK consumed by merchant frontends |
| `@commercehub/reference-server` | Express reference backend — session creation + orders proxy + webhooks + SSE |

## Industry Pattern (Stripe / Braintree / Adyen)

```
Merchant Frontend          Merchant Backend              Commerce Hub
     |                           |                            |
     | POST /v2/sessions ────────▶                            |
     |                           | POST /v1/security/...  ───▶|
     |                           |                            |
     |                           |◀─── { accessToken, ... }   |
     |◀── { accessToken, ... }   |                            |
     |                           |                            |
createCheckout({                 |                            |
  credentials: { accessToken }   |                            |
})                               |                            |
     |                           |                            |
     | ─── Authorization: Bearer {accessToken} ────────────────▶
     |                                                        |
     |◀────────────── OrderResult ─────────────────────────────
```

For **async APMs** (iDEAL, PayTo, Boleto, Alipay+, most PPROs), completion is delivered via webhooks → reference server → browser via Server-Sent Events.

## Quickstart

### Option A — Docker (recommended)

```bash
git clone <repo>
cd checkout-sdk-v2/packages/reference-server
cp .env.example .env  # edit with your CH credentials
docker compose up
# open examples/basic-checkout.html in a browser
```

### Option B — Local Node

```bash
git clone <repo>
cd checkout-sdk-v2
npm install
cd packages/reference-server
cp .env.example .env
npm run dev
# server listens on :3848; open examples/basic-checkout.html in a browser
```

See [docs/INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md) for the full 15-minute integration guide.

## Status

POC — static auth only. Not production-ready. See [docs/SECURITY.md](./docs/SECURITY.md) for the HMAC upgrade path.
