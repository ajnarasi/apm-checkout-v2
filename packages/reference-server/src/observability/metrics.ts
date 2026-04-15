/**
 * Prometheus metrics — exposed at /metrics.
 *
 * Catalog (see OBSERVABILITY.md):
 *   - http_request_duration_ms (histogram)  request latency by route+status
 *   - session_create_duration_ms (histogram)  CH create-session latency
 *   - ch_request_total (counter)  upstream CH calls by status
 *   - circuit_breaker_state (gauge)  0=closed, 1=half-open, 2=open
 *   - webhook_received_total (counter)  webhook events by provider+kind
 *   - sse_connections_active (gauge)  SSE clients connected
 */

import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const sessionCreateDuration = new client.Histogram({
  name: 'session_create_duration_ms',
  help: 'Commerce Hub session creation duration',
  labelNames: ['apm', 'status'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const chRequestTotal = new client.Counter({
  name: 'ch_request_total',
  help: 'Commerce Hub upstream calls by status code',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const circuitBreakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state: 0=closed, 1=half-open, 2=open',
  registers: [registry],
});

export const webhookReceivedTotal = new client.Counter({
  name: 'webhook_received_total',
  help: 'Webhook events received by provider and kind',
  labelNames: ['provider', 'kind'] as const,
  registers: [registry],
});

export const sseConnectionsActive = new client.Gauge({
  name: 'sse_connections_active',
  help: 'Active SSE connections',
  registers: [registry],
});

export function setBreakerStateMetric(state: 'closed' | 'half-open' | 'open'): void {
  const map: Record<typeof state, number> = { closed: 0, 'half-open': 1, open: 2 };
  circuitBreakerState.set(map[state]);
}
