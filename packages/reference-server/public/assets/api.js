/**
 * v2.2 Test Harness — HTTP + SSE client.
 *
 * Thin wrapper over fetch() that:
 *   - Tracks every request into a global network log (consumed by the
 *     Network inspector pane)
 *   - Attaches X-Correlation-ID and X-Harness-Scenario headers
 *   - Handles SSE stream for async webhook-driven flows
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

export const netlog = [];
const netSubs = new Set();

export function onNetlog(fn) {
  netSubs.add(fn);
  return () => netSubs.delete(fn);
}

function notifyNet() {
  for (const fn of netSubs) fn(netlog);
}

function shortId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

async function send(method, path, { body, headers = {}, scenario } = {}) {
  const correlationId = `harness-${shortId()}`;
  const startedAt = performance.now();
  const entry = {
    id: shortId(),
    ts: Date.now(),
    method,
    url: path,
    correlationId,
    scenario: scenario ?? null,
    reqBody: body ?? null,
    status: null,
    durationMs: null,
    respBody: null,
    ok: null,
    error: null,
  };
  netlog.unshift(entry);
  notifyNet();

  try {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body ? JSON_HEADERS : {}),
        'x-correlation-id': correlationId,
        ...(scenario ? { 'x-harness-scenario': scenario } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    entry.status = res.status;
    entry.durationMs = Math.round(performance.now() - startedAt);
    entry.ok = res.ok;

    const text = await res.text();
    try {
      entry.respBody = text ? JSON.parse(text) : null;
    } catch {
      entry.respBody = text;
    }
    notifyNet();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = entry.respBody;
      throw err;
    }
    return entry.respBody;
  } catch (err) {
    entry.error = String(err?.message ?? err);
    entry.durationMs = entry.durationMs ?? Math.round(performance.now() - startedAt);
    notifyNet();
    throw err;
  }
}

// ─── Harness metadata ─────────────────────────────────────────────
export const api = {
  status: () => send('GET', '/v2/harness/status'),
  catalog: () => send('GET', '/v2/harness/catalog'),
  catalogOne: (apm) => send('GET', `/v2/harness/catalog/${encodeURIComponent(apm)}`),
  scenarios: () => send('GET', '/v2/harness/scenarios'),
  sdkRegistry: () => send('GET', '/v2/harness/sdk-registry'),
  health: () => send('GET', '/readyz').catch(() => null),

  // ─── Production routes (exercised by the runner) ─────────────
  createSession: ({ apm, amount, currency, merchantOrderId }) =>
    send('POST', '/v2/sessions', {
      body: {
        apm,
        amount: { value: amount, currency },
        merchantOrderId,
      },
    }),

  authorizeOrder: ({ apm, amount, currency, merchantOrderId, initiator, intent, scenario, returnUrls }) =>
    send('POST', `/v2/orders/${encodeURIComponent(apm)}`, {
      scenario,
      body: {
        apm,
        merchantOrderId,
        amount: { value: amount, currency },
        paymentInitiator: initiator,
        intent,
        returnUrls: returnUrls ?? {
          successUrl: 'https://harness.example/return/success',
          cancelUrl: 'https://harness.example/return/cancel',
        },
      },
    }),

  captureOrder: ({ orderId, referenceTransactionId, amount, currency }) =>
    send('POST', `/v2/orders/${encodeURIComponent(orderId)}/capture`, {
      body: {
        referenceTransactionId,
        amount: amount ? { value: amount, currency } : undefined,
      },
    }),

  voidOrder: ({ orderId, referenceTransactionId, reason }) =>
    send('POST', `/v2/orders/${encodeURIComponent(orderId)}/void`, {
      body: { referenceTransactionId, reason },
    }),

  refundOrder: ({ orderId, referenceTransactionId, amount, currency, reason }) =>
    send('POST', `/v2/orders/${encodeURIComponent(orderId)}/refund`, {
      body: {
        referenceTransactionId,
        amount: { value: amount, currency },
        reason,
      },
    }),

  injectWebhook: ({ sessionId, kind, apm, orderId, referenceTransactionId }) =>
    send('POST', `/v2/harness/webhook-inject/${encodeURIComponent(sessionId)}`, {
      body: { kind, apm, orderId, referenceTransactionId },
    }),

  reset: () => send('POST', '/v2/harness/reset'),

  // ─── Sandbox credential helpers (Klarna / CashApp / PPRO) ────
  sandboxDefaults: (apm) =>
    send('GET', `/v2/harness/sandbox-defaults?apm=${encodeURIComponent(apm)}`),

  sandboxCall: ({ apm, action, body }) =>
    send(
      'POST',
      `/v2/harness/sandbox-call/${encodeURIComponent(apm)}/${encodeURIComponent(action)}`,
      { body }
    ),
};

// ─── SSE event stream ─────────────────────────────────────────────

export function connectEvents(sessionId, { onEvent, onError, lastEventId } = {}) {
  if (typeof EventSource === 'undefined') {
    if (onError) onError(new Error('EventSource not supported'));
    return { close: () => {} };
  }

  const url = `/v2/events/${encodeURIComponent(sessionId)}`;
  // Last-Event-ID is a request header; EventSource only honors it on reconnect.
  // For first-connect replay we query-param it.
  const full = lastEventId ? `${url}?lastEventId=${encodeURIComponent(lastEventId)}` : url;
  const es = new EventSource(full);

  // Expose the raw connect as a net entry (synthetic)
  netlog.unshift({
    id: shortId(),
    ts: Date.now(),
    method: 'SSE',
    url: full,
    correlationId: null,
    scenario: null,
    reqBody: null,
    status: 'open',
    durationMs: null,
    respBody: null,
    ok: true,
    error: null,
  });
  notifyNet();

  es.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (onEvent) onEvent(data, ev.lastEventId);
    } catch (err) {
      if (onError) onError(err);
    }
  });
  es.addEventListener('error', (err) => {
    if (onError) onError(err);
  });

  return {
    close: () => es.close(),
  };
}

// ─── Local network log ─────────────────────────────────────────────
export function clearNetlog() {
  netlog.length = 0;
  notifyNet();
}
