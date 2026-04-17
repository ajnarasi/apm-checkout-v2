/**
 * v2.2 harness — 8-phase payment lifecycle trace pane.
 *
 * Gives the user a single view of the entire payment flow instead of a
 * flat list of HTTP calls. Each phase has its own descriptor and is
 * either "executed" (harness has artifacts), "simulated" (short-circuited
 * in HARNESS_MODE — the user can see exactly what would happen with real
 * credentials), or "awaiting" (the run hasn't reached it yet).
 *
 * Phases (in lifecycle order):
 *   ① Session init           — POST /v2/sessions from browser
 *   ② Security credentials    — merchant backend → CH /payments-vas/v1/security/credentials
 *                               (simulated in harness mode)
 *   ③ Provider SDK load       — <script> injection from the SDK pane
 *   ④ Tokenization            — provider SDK returns a token
 *   ⑤ Order submit            — POST /v2/orders/:apm from browser
 *   ⑥ CH routing              — CH internal fan-out to PPRO/Klarna/PayPal
 *                               (simulated in harness mode)
 *   ⑦ Webhook / SSE           — async webhook → event bus → browser SSE
 *   ⑧ Terminal state          — state machine lands in completed/failed/cancelled
 *
 * Data sources:
 *   - netlog from api.js (HTTP requests)
 *   - inspector state (current state machine / events)
 *   - sdk-loader load state (for phase ③)
 *   - callbacks fire log (appended as phase ⑤a interactions)
 */

import { escapeHtml } from './catalog.js';
import { netlog, onNetlog } from './api.js';
import { getLoadState } from './sdk-loader.js';

const PHASES = [
  {
    id: 'session_init',
    num: '①',
    title: 'Session init',
    description:
      'Merchant frontend calls POST /v2/sessions. The reference server validates the APM + amount, then either hits CH to mint an access token (live) or synthesizes one (harness).',
    matcher: (n) => n.method === 'POST' && n.url === '/v2/sessions',
  },
  {
    id: 'credentials_api',
    num: '②',
    title: 'Commerce Hub Credentials API',
    description:
      'Reference server → CH POST /payments-vas/v1/security/credentials. Exchanges Api-Key + HMAC for a short-lived access token. The browser never sees this call.',
    simulatedInHarness: true,
    simulatedNote:
      'Short-circuited by HARNESS_MODE. With real credentials the reference server would POST to https://cert.api.firstdata.com/payments-vas/v1/security/credentials here.',
  },
  {
    id: 'sdk_load',
    num: '③',
    title: 'Provider SDK load',
    description:
      'Browser injects the provider CDN <script> (paypal.com/sdk/js, kit.cash.app, x.klarnacdn.net, etc). The harness polls window.<global> until the SDK exposes its API.',
    bindToSdkLoader: true,
  },
  {
    id: 'bnpl',
    num: '④',
    title: 'Provider tokenization',
    description:
      'User interacts with the provider button/widget. The provider SDK returns a single-use token (Klarna authorization_token, PayPal orderID, Apple Pay paymentData, Google Pay paymentMethodToken).',
    simulatedInHarness: true,
    simulatedNote:
      'The harness does not wire every provider button to the inspector yet. Where a real button renders (SDK pane), you can click it to exercise the real tokenization.',
  },
  {
    id: 'order_submit',
    num: '⑤',
    title: 'Order submit',
    description:
      'Browser POSTs the token + amount to /v2/orders/:apm. Reference server forwards to CH /checkouts/v1/orders with paymentMethod.provider set from the APM mapping.',
    matcher: (n) => n.method === 'POST' && /^\/v2\/orders\/[^/]+$/.test(n.url),
  },
  {
    id: 'ch_routing',
    num: '⑥',
    title: 'CH internal routing',
    description:
      'Commerce Hub reads paymentMethod.provider and fans out to the downstream provider (PPRO /v1/payment-charges for IDEAL/BANCONTACT/..., Klarna /payments/v1/authorizations, PayPal /v2/checkout/orders, etc). The merchant backend never sees this.',
    simulatedInHarness: true,
    simulatedNote:
      'Short-circuited by HARNESS_MODE — the synthetic CH response encodes what CH would return based on X-Harness-Scenario.',
  },
  {
    id: 'webhook_sse',
    num: '⑦',
    title: 'Webhook / SSE relay',
    description:
      'For async APMs, the provider notifies CH, CH POSTs /v2/webhooks/:provider, the event bus publishes, and the browser SSE stream delivers the terminal transition.',
    matcher: (n) =>
      (n.method === 'POST' && n.url.startsWith('/v2/harness/webhook-inject/')) ||
      (n.method === 'SSE' && n.url.startsWith('/v2/events/')),
  },
  {
    id: 'capture_void_refund',
    num: '⑧',
    title: 'Capture / Void / Refund',
    description:
      'For merchant-initiated flows, the merchant calls /v2/orders/:orderId/capture|void|refund after the initial AUTHORIZED. Each of these hits CH /checkouts/v1/orders with the right field combo.',
    matcher: (n) =>
      n.method === 'POST' &&
      /^\/v2\/orders\/[^/]+\/(capture|void|refund)$/.test(n.url),
  },
  {
    id: 'terminal',
    num: '⑨',
    title: 'Terminal state',
    description:
      'State machine lands in completed, failed, cancelled, auth_expired, or script_load_failed. The first-writer-wins cache ensures webhook arrival and sync response agree.',
    bindToRunnerState: true,
  },
];

export class TracePane {
  constructor({ rootEl, getRunnerSnapshot }) {
    this.root = rootEl;
    this.getSnapshot = getRunnerSnapshot;
    onNetlog(() => this.render());
  }

  render() {
    if (!this.root) return;
    const snapshot = this.getSnapshot();
    const sdkState = snapshot?.apm ? getLoadState(snapshot.apm.id) : null;

    this.root.innerHTML = '';

    const intro = document.createElement('div');
    intro.className = 'trace__intro';
    intro.innerHTML = `
      <div class="kicker">Lifecycle trace</div>
      <h3>Payment flow for ${snapshot?.apm ? escapeHtml(snapshot.apm.displayName) : 'the selected APM'}</h3>
      <p class="muted">
        End-to-end view of every phase the v2.2 wire path touches. Phases
        marked <strong class="trace__sim-label">simulated</strong> are
        short-circuited by HARNESS_MODE — they show you what <em>would</em>
        happen if you disabled harness mode and pointed at a real CH sandbox.
      </p>
    `;
    this.root.appendChild(intro);

    for (const phase of PHASES) {
      const block = document.createElement('details');
      block.className = 'trace__phase';
      block.open = false;

      const state = this.resolvePhase(phase, snapshot, sdkState);
      block.classList.add(`trace__phase--${state.status}`);

      const head = document.createElement('summary');
      head.className = 'trace__head';
      head.innerHTML = `
        <span class="trace__num">${phase.num}</span>
        <span class="trace__title">${escapeHtml(phase.title)}</span>
        <span class="trace__status">${statusBadge(state.status, phase.simulatedInHarness)}</span>
        <span class="trace__meta">${escapeHtml(state.metaLine ?? '')}</span>
      `;
      block.appendChild(head);

      const body = document.createElement('div');
      body.className = 'trace__body';
      body.innerHTML = `
        <p class="trace__desc">${escapeHtml(phase.description)}</p>
        ${phase.simulatedInHarness ? `<div class="trace__sim">⚠ ${escapeHtml(phase.simulatedNote ?? '')}</div>` : ''}
        ${renderPhaseArtifacts(state)}
      `;
      block.appendChild(body);
      this.root.appendChild(block);
    }
  }

  resolvePhase(phase, snapshot, sdkState) {
    // SDK loader phase
    if (phase.bindToSdkLoader) {
      if (!sdkState || sdkState.status === 'idle') {
        return { status: 'awaiting', metaLine: 'SDK not loaded yet' };
      }
      if (sdkState.status === 'loading') {
        return { status: 'running', metaLine: 'loading…' };
      }
      if (sdkState.status === 'failed') {
        return {
          status: 'failed',
          metaLine: `failed after ${sdkState.durationMs ?? '?'} ms`,
          artifacts: { 'cdn url': sdkState.cdnUrl, error: sdkState.error },
        };
      }
      return {
        status: 'ok',
        metaLine: `loaded in ${sdkState.durationMs} ms`,
        artifacts: {
          'cdn url': sdkState.cdnUrl,
          global: sdkState.global,
          'loaded at': new Date(sdkState.loadedAt).toLocaleTimeString(),
        },
      };
    }

    // Runner state binding (terminal)
    if (phase.bindToRunnerState) {
      const s = snapshot?.currentState;
      if (!s || s === 'idle') return { status: 'awaiting', metaLine: 'no run yet' };
      const terminalOk = ['completed'].includes(s);
      const terminalErr = ['failed', 'auth_expired', 'script_load_failed'].includes(s);
      const terminalCancel = ['cancelled'].includes(s);
      const status = terminalOk ? 'ok' : terminalErr ? 'failed' : terminalCancel ? 'info' : 'running';
      return {
        status,
        metaLine: `state = ${s}`,
        artifacts: {
          'current state': s,
          'events observed': snapshot.events?.length ?? 0,
          orderId: snapshot.orderId ?? '—',
          sessionId: snapshot.sessionId ?? '—',
        },
      };
    }

    // Simulated phases — always green "simulated" label
    if (phase.simulatedInHarness) {
      return { status: 'simulated', metaLine: 'short-circuited by HARNESS_MODE' };
    }

    // Network-matched phase
    const matches = netlog.filter(phase.matcher ?? (() => false)).slice().reverse();
    if (!matches.length) return { status: 'awaiting', metaLine: 'no request yet' };
    const last = matches[matches.length - 1];
    const status = last.error || (last.status && last.status >= 400) ? 'failed' : last.ok ? 'ok' : 'running';
    return {
      status,
      metaLine: `${matches.length} call${matches.length === 1 ? '' : 's'} · last ${last.status ?? '…'} in ${last.durationMs ?? '?'} ms`,
      artifacts: matches.map((m) => ({
        method: m.method,
        url: m.url,
        status: m.status,
        scenario: m.scenario,
        duration: m.durationMs,
        req: m.reqBody,
        resp: m.respBody,
      })),
    };
  }
}

function statusBadge(status, simulated) {
  if (simulated && status === 'simulated') return `<span class="badge badge--sim">simulated</span>`;
  const map = {
    ok: ['ok', 'is-ok'],
    failed: ['failed', 'is-err'],
    running: ['running', 'is-running'],
    awaiting: ['awaiting', ''],
    info: ['cancelled', 'is-info'],
    simulated: ['simulated', 'badge--sim'],
  };
  const [label, cls] = map[status] ?? [status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderPhaseArtifacts(state) {
  if (!state.artifacts) return '';
  if (Array.isArray(state.artifacts)) {
    return (
      '<div class="trace__artifacts">' +
      state.artifacts
        .map(
          (a) => `
        <div class="trace__artifact">
          <div class="trace__artifact-head">
            <span class="trace__artifact-method">${escapeHtml(a.method)}</span>
            <span class="trace__artifact-url">${escapeHtml(a.url)}</span>
            <span class="trace__artifact-status">${a.status ?? '—'}</span>
            ${a.scenario ? `<span class="trace__artifact-tag">scenario: ${escapeHtml(a.scenario)}</span>` : ''}
            <span class="trace__artifact-dur">${a.duration ?? '—'} ms</span>
          </div>
          <pre class="code-block">${escapeHtml(JSON.stringify({ req: a.req, resp: a.resp }, null, 2))}</pre>
        </div>
      `
        )
        .join('') +
      '</div>'
    );
  }
  return (
    '<dl class="trace__kvs">' +
    Object.entries(state.artifacts)
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? '—'))}</dd>`)
      .join('') +
    '</dl>'
  );
}
