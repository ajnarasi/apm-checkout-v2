# Observability — Logs, Metrics, Health, Correlation

## Logging

Pino structured JSON to stdout. Every log line includes:
- `level` (info | warn | error)
- `time` (ISO-8601)
- `correlationId` (when available)
- `requestId` (when in a request context)
- additional contextual fields per event

PII is redacted by allowlist before serialization. See [SECURITY.md](./SECURITY.md) for the redact paths.

### Log levels by event

| Event | Level |
|---|---|
| `session.created` | info |
| `session.cache_hit` | info |
| `ch.request` | info |
| `ch.success` | info |
| `ch.error` (4xx) | warn |
| `ch.error` (5xx) | warn |
| `ch.network_error` | error |
| `webhook.received` | info |
| `webhook.signature_invalid` | warn |
| `sse.connected` / `sse.disconnected` | info |
| `request.unhandled_error` | error |
| `shutdown.*` | info / warn |

## Metrics

Prometheus exposition format at `GET /metrics`.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_request_duration_ms` | Histogram | `method`, `route`, `status` | HTTP latency per route |
| `session_create_duration_ms` | Histogram | `apm`, `status` | CH session creation latency |
| `ch_request_total` | Counter | `status` | Upstream CH calls by status |
| `circuit_breaker_state` | Gauge | – | 0=closed, 1=half-open, 2=open |
| `webhook_received_total` | Counter | `provider`, `kind` | Webhooks received |
| `sse_connections_active` | Gauge | – | SSE clients connected |
| Default node metrics | – | – | `prom-client.collectDefaultMetrics` (eventloop, gc, memory, etc.) |

### Suggested Grafana panels

- p50 / p95 / p99 of `http_request_duration_ms{route="/v2/sessions"}`
- Rate of `ch_request_total{status=~"5.."}` — alert if >1% of total
- `circuit_breaker_state` — alert if non-zero for >60s
- `sse_connections_active` — alert if drops to 0 unexpectedly during business hours
- p95 of `session_create_duration_ms` — alert if >800ms (NFR target)

## Health endpoints

### `GET /livez`
Always returns 200 if the event loop is responsive. Container orchestrators should hit this for restart decisions only — not for traffic routing.

```json
{ "status": "live", "timestamp": 1700000000000 }
```

### `GET /readyz`
Returns 200 only if:
- Circuit breaker is not `open`
- `CH_BASE_URL` and `CH_API_KEY` are set
- (Future) Token cache responsive

Returns 503 otherwise. Container orchestrators should use this for traffic routing.

```json
{
  "status": "ready",
  "breaker": "closed",
  "activeSessions": 12,
  "timestamp": 1700000000000
}
```

## Correlation IDs

`X-Correlation-Id` flows through every layer:
- Browser SDK generates one per `createCheckout()` call
- Sent on every request to the reference server in `X-Correlation-Id` header
- Reference server reads or generates one in `correlationMiddleware`
- Forwarded to Commerce Hub via the same header
- Logged on every event in both server and node-package logs
- Propagated to webhooks via the merchant order id mapping
- Echoed back to clients in response headers `X-Correlation-Id` + `X-Request-Id`

To debug a single payment end-to-end: grep all logs for one `correlationId`.

## OpenTelemetry (optional)

The plan includes an OpenTelemetry stub but it is NOT wired in the POC. To enable:

1. Install `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`
2. Wrap `index.ts` boot with the OTel SDK
3. Set `OTEL_EXPORTER_OTLP_ENDPOINT` env var
4. Spans automatically capture `correlationId` if the `X-Correlation-Id` header is propagated

Out of scope for the POC.
