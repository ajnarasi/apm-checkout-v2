# API Reference

## `@commercehub/checkout-sdk-browser`

### `createCheckout(config: CheckoutConfig): CheckoutHandle`
Top-level factory. Validates config, picks the adapter from the registry, wires `SessionClient` + `EventBus` + (optional) `WebhookListener`, returns a handle.

### `CheckoutConfig`
| Field | Type | Required |
|---|---|---|
| `apm` | string | yes |
| `amount` | `{ value: number, currency: string }` | yes |
| `merchantOrderId` | string | yes |
| `credentials.accessToken` | string | **yes** |
| `credentials.sessionId` | string | yes |
| `credentials.chBaseUrl` | string | yes |
| `credentials.providerClientToken` | string | no (required for widget APMs) |
| `credentials.eventsBaseUrl` | string | no (defaults to chBaseUrl) |
| `containerId` | string | no (required for widget APMs) |
| `customer` | object | no |
| `returnUrls.successUrl` | string | yes for redirect/voucher patterns |
| `returnUrls.cancelUrl` | string | yes for redirect/voucher patterns |

### `CheckoutHandle`
| Method | Returns | Description |
|---|---|---|
| `init()` | `Promise<void>` | Validate, load SDK, wire listeners, transition `idle → ready` |
| `render()` | `Promise<void>` | Mount widget for widget APMs; no-op for redirect flows |
| `authorize()` | `Promise<void>` | Begin authorization. Sync APMs return immediately; async transition to `pending` |
| `destroy()` | `Promise<void>` | Tear down event listeners, SSE connection, DOM |
| `on(type, listener)` | `() => void` | Subscribe to a specific event type |
| `onAny(listener)` | `() => void` | Subscribe to all events |

### Event types
See [SCENARIOS.md](./SCENARIOS.md). Terminal events: `PAYMENT_COMPLETED | PAYMENT_FAILED | PAYMENT_CANCELLED`.

---

## `@commercehub/node`

### `CommerceHubClient`
```ts
new CommerceHubClient({
  baseUrl: 'https://cert.api.firstdata.com',
  auth: new StaticAuth({ apiKey, staticAccessToken }),
  retry?: Partial<RetryPolicy>,
  tokenCache?: TokenCache,
  breaker?: CircuitBreaker,
  logger?: Logger,
})
```

`createSession(input)` parameters:
- `apm`, `amount`, `merchantOrderId` — required
- `customer`, `billingAddress`, `orderData` — optional
- `clientRequestId` — auto-generated UUIDv4 if absent; reused across HTTP retries
- `deadline` — absolute epoch ms; retries fail fast if exhausted
- `correlationId` — propagated to CH and into logs
- `cacheKey` — when set, enables token-cache lookup

Returns:
```ts
{
  accessToken: string;
  sessionId: string;
  expiresAt: number;
  providerClientToken?: string;
  orderId?: string;
  apiTraceId?: string;
  raw: CredentialsResponse;
}
```

### Errors
All thrown errors are subclasses of `CommerceHubError`. Switch on `err.code`:
`VALIDATION_ERROR | AUTH_FAILED | FORBIDDEN | NOT_FOUND | TOO_EARLY | RATE_LIMITED | SERVER_ERROR | NETWORK_ERROR | TIMEOUT | DEADLINE_EXCEEDED | CIRCUIT_OPEN | NOT_IMPLEMENTED | REFUSED_PRODUCTION | UNKNOWN`.

---

## Reference server endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v2/sessions` | Create CH session — returns access token |
| POST | `/v2/orders/:apm` | Authorize order — proxy to CH orders endpoint |
| GET | `/v2/orders/:orderId` | Fetch existing order |
| POST | `/v2/orders/:orderId/cancel` | Cancel pending order |
| POST | `/v2/webhooks/:provider` | Receive webhook (HMAC-signed) |
| GET | `/v2/events/:sessionId` | SSE stream of webhook envelopes |
| GET | `/livez` | Process liveness |
| GET | `/readyz` | Readiness check (CH connectivity, breaker state) |
| GET | `/metrics` | Prometheus metrics |
