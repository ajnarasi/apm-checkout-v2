# Security — Commerce Hub Checkout SDK v2

> **POC MODE**: This SDK uses static access tokens for sandbox testing only. HMAC signing is stubbed and throws. Multiple defense-in-depth tripwires refuse to boot in production.

## Defense-in-depth: 4 layers of refuse-production

| Layer | Where | Trigger | Effect |
|---|---|---|---|
| 1 | `reference-server/src/env.ts` | `NODE_ENV=production` at boot | Process exits with code 1, `[FATAL] REFUSED PRODUCTION` |
| 2 | `commerce-hub-node/src/static-auth.ts` | `StaticAuth` constructor in production | Throws `RefusedProductionError` — catches anyone who imports the node package directly |
| 3 | `commerce-hub-node/src/client.ts` | `CommerceHubClient` constructor with non-`*.firstdata.com` host in production | Throws `RefusedProductionError` |
| 4 | `commerce-hub-node` package.json | `npm install @commercehub/node` without `@poc` dist-tag | Install fails until HMAC ships |

A single misconfigured env var cannot bypass production safety.

## The HMAC upgrade path

When you're ready to deploy to production:

1. **Implement `sign()` in `commerce-hub-node/src/hmac.ts`** per Fiserv's signing guide. The current stub throws `NotImplementedError`. The function signature is fixed; only the body changes.
2. **Add HMAC vector tests** to `test/hmac.test.ts` against known expected outputs.
3. **Switch `authMode`** in your CommerceHubClient construction:
   ```ts
   const auth = new HmacAuth({ apiKey, apiSecret });  // new class, not yet implemented
   const client = new CommerceHubClient({ auth, ... });
   ```
4. **Remove the production refusal** in `static-auth.ts` constructor — but keep `StaticAuth` for sandbox use.
5. **Remove `"publishConfig.tag": "poc"`** from `commerce-hub-node/package.json`.
6. **Bump major version** to `2.1.0` and publish.

## PII redaction

The reference server's pino logger has a redact allowlist that blocks every field that could contain customer PII or secrets. The full list lives in `reference-server/src/observability/logger.ts`. Highlights:

- `req.headers.authorization`, `req.headers["api-key"]`
- `*.customer`, `*.billingAddress`, `*.shippingAddress`
- `*.source`, `*.encryptionData`, `*.paymentTokens`
- `*.cardNumber`, `*.cvv`, `*.pan`
- `*.accessToken`, `*.refreshToken`, `*.staticAccessToken`, `*.apiSecret`

**Do NOT log `req.body` directly.** Use the `redact()` helper:
```ts
import { redact } from '@commercehub/node';
logger.info({ payload: redact(req.body) }, 'request received');
```

An ESLint rule (TODO — not in POC, see issues/eslint-rule.md) forbids `logger.*(req.body)` entirely.

## Idempotency

`Client-Request-Id` is a UUIDv4 generated per **logical business operation** (one per call to `createSession()`). HTTP retries within `CommerceHubClient.withRetry()` reuse the same id. The Commerce Hub 5-minute timestamp window defines the idempotency horizon — beyond that, the same `clientRequestId` may be treated as a new request.

Caller-level retries (e.g. user clicks "Pay" twice) should pass an explicit `clientRequestId` so CH treats them as the same logical attempt.

## CSP guidance

For frontends embedding the SDK, recommended Content Security Policy:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://x.klarnacdn.net https://www.paypalobjects.com 'nonce-{NONCE}';
  connect-src 'self' https://your-merchant-backend.example.com https://cert.api.firstdata.com;
  frame-src https://x.klarnacdn.net;
  img-src 'self' data: https:;
```

Adjust `connect-src` to your merchant-backend host and the Commerce Hub host you target.

## Webhook signature verification

`POST /v2/webhooks/:provider` requires an `X-Webhook-Signature: sha256=<hex>` header. The reference server uses `timingSafeEqual` to compare against `HMAC-SHA256(CH_WEBHOOK_SECRET, rawBody)`. Requests without a valid signature get `401`.

Rotate `CH_WEBHOOK_SECRET` quarterly. Deploy with overlap: accept old + new for one rotation cycle.

## Rate limiting

`express-rate-limit` per-IP buckets are configured per-route:

| Route | Limit |
|---|---|
| `POST /v2/sessions` | 60 / minute / IP |
| `POST /v2/orders/:apm` | 120 / minute / IP |
| `POST /v2/webhooks/:provider` | 600 / minute / IP |

In-memory by default. Multi-instance production must use `rate-limit-redis`.

## Multi-tenancy

**v2 is single-tenant by design.** One `CH_API_KEY` per instance. Run one reference-server instance per merchant tenant. Multi-tenant support requires a clean-sheet `TenantContext` interface and is on the v3 roadmap.
