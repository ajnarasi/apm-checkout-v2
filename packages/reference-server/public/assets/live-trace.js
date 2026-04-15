/**
 * v2.2 harness — Live API Trace.
 *
 * Real-time animated sequence diagram that updates as actual requests fire.
 * Unlike the original static "phase summary" Trace pane, this one is driven
 * directly by the `api.js` netlog and the callback/SDK events, and renders a
 * swim-lane SVG with pulsing arrows in the moment each request happens.
 *
 * Lanes (vertical columns, left → right, in semantic order):
 *   1. Browser SDK
 *   2. Merchant Backend (the reference server)
 *   3. CH Credentials API   — POST /payments-vas/v1/security/credentials
 *   4. CH Orders API        — POST /checkouts/v1/orders
 *   5. APM Provider Server  — PPRO / Klarna / PayPal / etc.
 *   6. Webhook / SSE        — CH → merchant backend → browser
 *
 * Events come from:
 *   - api.js netlog subscription (HTTP calls out of the browser)
 *   - sdk-loader events (CDN load, tokenization, callbacks)
 *   - inspector state machine transitions (from → to)
 *   - callbacks.js fire events (provider → adapter → merchant round-trip)
 *
 * Every event becomes an arrow between two lanes, animated with a growing
 * stroke-dasharray + a fade-in label. Pending requests pulse their arrow in
 * an amber color; completed requests go green; failures red. Clicking an
 * arrow expands its payload underneath the diagram.
 */

import { netlog, onNetlog } from './api.js';
import { escapeHtml } from './catalog.js';

const LANES = [
  { id: 'browser',    label: 'Browser SDK',         sub: 'checkout-sdk-browser' },
  { id: 'merchant',   label: 'Merchant Backend',    sub: 'reference-server' },
  { id: 'chCreds',    label: 'CH Credentials API',  sub: '/payments-vas/v1/security/credentials' },
  { id: 'chOrders',   label: 'CH Orders API',       sub: '/checkouts/v1/orders' },
  { id: 'provider',   label: 'APM Provider',        sub: 'PPRO · Klarna · PayPal · Apple · Google' },
  { id: 'webhook',    label: 'Webhook / SSE',       sub: 'async settlement' },
];
const LANE_IDS = LANES.map((l) => l.id);
const LANE_INDEX = Object.fromEntries(LANE_IDS.map((id, i) => [id, i]));

// ────────────────────────────────────────────────────────────────────────
// Netlog URL → lane classifier.
// ────────────────────────────────────────────────────────────────────────

function classifyNetEntry(n) {
  // Browser → Merchant
  if (n.url.startsWith('/v2/sessions')) {
    return { from: 'browser', to: 'merchant', label: 'POST /v2/sessions', simulates: ['chCreds'] };
  }
  if (/^\/v2\/orders\/[^/]+$/.test(n.url)) {
    const apm = n.url.split('/').pop();
    return {
      from: 'browser',
      to: 'merchant',
      label: `POST /v2/orders/${apm}`,
      simulates: ['chOrders', 'provider'],
    };
  }
  if (/^\/v2\/orders\/[^/]+\/(capture|void|refund)$/.test(n.url)) {
    const [, , , orderId, op] = n.url.split('/');
    return {
      from: 'browser',
      to: 'merchant',
      label: `POST /v2/orders/${orderId.slice(0, 8)}…/${op}`,
      simulates: ['chOrders'],
    };
  }
  if (n.url.startsWith('/v2/harness/webhook-inject/')) {
    return {
      from: 'webhook',
      to: 'merchant',
      label: 'webhook inject',
      simulates: [],
    };
  }
  if (n.method === 'SSE' && n.url.startsWith('/v2/events/')) {
    return { from: 'merchant', to: 'browser', label: 'SSE connect', simulates: [] };
  }
  if (n.url.startsWith('/v2/harness/')) {
    return { from: 'browser', to: 'merchant', label: n.method + ' ' + n.url, simulates: [] };
  }
  if (n.url.startsWith('/v2/applepay/merchant-validation')) {
    return {
      from: 'browser',
      to: 'merchant',
      label: 'apple pay merchant validation',
      simulates: ['provider'],
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// LiveTrace — the rendering + subscription machinery.
// ────────────────────────────────────────────────────────────────────────

export class LiveTrace {
  constructor({ rootEl, getRunnerSnapshot, onRunScenario, getRunnerControls }) {
    this.root = rootEl;
    this.getSnapshot = getRunnerSnapshot;
    this.onRunScenario = onRunScenario;
    this.getRunnerControls = getRunnerControls;
    this.seenNetIds = new Set();
    this.events = []; // timeline events, in fire order
    this.unsub = onNetlog(() => this.ingestNetlog());
  }

  reset() {
    this.events = [];
    this.seenNetIds = new Set();
    this.render();
  }

  ingestNetlog() {
    for (const n of netlog) {
      if (this.seenNetIds.has(n.id)) continue;
      this.seenNetIds.add(n.id);
      const cls = classifyNetEntry(n);
      if (!cls) continue;
      // Main arrow browser → merchant (or whatever)
      this.events.push({
        ts: n.ts,
        from: cls.from,
        to: cls.to,
        label: cls.label,
        kind: 'http',
        status: n.status,
        durationMs: n.durationMs,
        ok: n.ok,
        error: n.error,
        scenario: n.scenario,
        netId: n.id,
        reqBody: n.reqBody,
        respBody: n.respBody,
      });
      // Derived simulated arrows (CH credentials, CH orders, provider)
      if (cls.simulates?.length) {
        let prev = cls.to;
        for (const sim of cls.simulates) {
          this.events.push({
            ts: n.ts + 1,
            from: prev,
            to: sim,
            label: simulatedLabel(sim, cls.label),
            kind: 'simulated',
            status: 'SIM',
            durationMs: null,
            ok: true,
            netId: n.id + '-sim-' + sim,
          });
          // Return arrow
          this.events.push({
            ts: n.ts + 2,
            from: sim,
            to: prev,
            label: simulatedReturnLabel(sim),
            kind: 'simulated',
            status: 'SIM',
            durationMs: null,
            ok: true,
            netId: n.id + '-sim-return-' + sim,
          });
          prev = sim;
        }
      }
    }
    this.events.sort((a, b) => a.ts - b.ts);
    this.render();
  }

  /**
   * Public: emit a non-HTTP trace event (from sdk-loader, callbacks,
   * state machine). Inspector pushes these in as they happen.
   */
  pushEvent({ from, to, label, kind = 'event', status = 'OK', extra = null }) {
    this.events.push({
      ts: Date.now(),
      from,
      to,
      label,
      kind,
      status,
      durationMs: null,
      ok: true,
      netId: 'evt-' + this.events.length,
      extra,
    });
    this.events.sort((a, b) => a.ts - b.ts);
    this.render();
  }

  /**
   * Canonical concept flow rendered on empty state so the 6 lanes are
   * always populated with something meaningful. Real events replace this
   * the moment the user runs a scenario.
   */
  getBaselineConceptEvents() {
    const now = Date.now();
    return [
      { ts: now + 1,  from: 'browser',  to: 'merchant', label: 'POST /v2/sessions',                                  kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-1', extra: null },
      { ts: now + 2,  from: 'merchant', to: 'chCreds',  label: 'POST /payments-vas/v1/security/credentials',         kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-2', extra: null },
      { ts: now + 3,  from: 'chCreds',  to: 'merchant', label: '200 { accessToken }',                                kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-3', extra: null },
      { ts: now + 4,  from: 'merchant', to: 'browser',  label: '200 { sessionId }',                                  kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-4', extra: null },
      { ts: now + 5,  from: 'browser',  to: 'merchant', label: 'POST /v2/orders/:apm',                               kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-5', extra: null },
      { ts: now + 6,  from: 'merchant', to: 'chOrders', label: 'POST /checkouts/v1/orders + Bearer {accessToken}',   kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-6', extra: null },
      { ts: now + 7,  from: 'chOrders', to: 'provider', label: 'CH fan-out (PPRO / Klarna / PayPal ...)',            kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-7', extra: null },
      { ts: now + 8,  from: 'provider', to: 'chOrders', label: 'authorized',                                         kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-8', extra: null },
      { ts: now + 9,  from: 'chOrders', to: 'merchant', label: '200 { CAPTURED | PENDING | AUTHORIZED }',            kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-9', extra: null },
      { ts: now + 10, from: 'webhook',  to: 'merchant', label: 'webhook (async APMs) → SSE',                         kind: 'baseline', status: 'baseline', durationMs: null, ok: true,  netId: 'b-10', extra: null },
    ];
  }

  render() {
    if (!this.root) return;

    // Empty state → render the canonical concept flow so the user can
    // see what a full run would look like BEFORE firing any scenario.
    const isEmpty = this.events.length === 0;
    const renderEvents = isEmpty ? this.getBaselineConceptEvents() : this.events;

    const W = 1180; // logical SVG width — actual element scales
    const laneW = W / LANES.length;
    const topPad = 54;
    const rowH = 52;
    const H = topPad + Math.max(renderEvents.length, 1) * rowH + 40;

    this.root.innerHTML = `
      <div class="ltrace__intro">
        <div class="kicker">Commerce flow${isEmpty ? ' · baseline concept' : ' · live'}</div>
        <h3>${isEmpty ? '6-lane architecture — ready for a test run' : 'Every request, every lane, every phase'}</h3>
        <p class="muted">
          ${isEmpty
            ? 'Use the lifecycle buttons above to step through <strong>Init → Render → Authorize → Handle Return → Teardown</strong>. Real HTTP arrows will replace this baseline concept as each step fires.'
            : 'This view updates in real time as lifecycle steps fire. Amber arrows are <span class="ltrace__sim-pill">simulated</span> in HARNESS_MODE — they show you what <em>would</em> happen with real credentials. Click any arrow to expand its payload.'}
        </p>
      </div>

      <div class="ltrace__legend">
        <span class="ltrace__legend-pill ltrace__legend-pill--http">HTTP</span>
        <span class="ltrace__legend-pill ltrace__legend-pill--sim">simulated</span>
        <span class="ltrace__legend-pill ltrace__legend-pill--event">SDK event</span>
        <span class="ltrace__legend-pill ltrace__legend-pill--webhook">webhook</span>
        ${isEmpty ? '<span class="ltrace__legend-pill ltrace__legend-pill--baseline">baseline concept</span>' : ''}
        <span class="ltrace__legend-pill ltrace__legend-pill--ok">ok</span>
        <span class="ltrace__legend-pill ltrace__legend-pill--err">error</span>
      </div>

      <div class="ltrace__svg-wrap">
        <svg class="ltrace__svg ${isEmpty ? 'is-baseline' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet">
          <defs>
            <marker id="arrow-http" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
            <marker id="arrow-sim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>

          ${LANES.map((lane, i) => {
            const cx = laneW * i + laneW / 2;
            return `
              <g class="ltrace__lane" data-lane="${lane.id}">
                <line x1="${cx}" y1="${topPad - 4}" x2="${cx}" y2="${H - 20}" class="ltrace__lane-line" />
                <rect x="${cx - laneW / 2 + 8}" y="10" width="${laneW - 16}" height="${topPad - 20}" rx="8" class="ltrace__lane-head" />
                <text x="${cx}" y="28" class="ltrace__lane-label" text-anchor="middle">${escapeHtml(lane.label)}</text>
                <text x="${cx}" y="42" class="ltrace__lane-sub"  text-anchor="middle">${escapeHtml(lane.sub)}</text>
              </g>
            `;
          }).join('')}

          ${renderEvents
            .slice(-24)
            .map((ev, idx) => this.renderArrow(ev, idx, laneW, topPad, rowH))
            .join('')}
        </svg>
      </div>

      <div class="ltrace__rows-head">
        <div class="kicker">Trace events</div>
      </div>

      <div class="ltrace__rows" data-ltrace-rows>
        ${renderEvents.slice(-24).map((ev) => `
          <details class="ltrace__row ltrace__row--${ev.kind} ${ev.ok ? '' : 'is-err'}">
            <summary>
              <span class="ltrace__row-ts">${isEmpty ? '—' : new Date(ev.ts).toTimeString().slice(0, 8)}</span>
              <span class="ltrace__row-arrow">${escapeHtml(laneLabel(ev.from))} → ${escapeHtml(laneLabel(ev.to))}</span>
              <span class="ltrace__row-label">${escapeHtml(ev.label)}</span>
              <span class="ltrace__row-status">${escapeHtml(String(ev.status ?? '—'))}${ev.durationMs != null ? ' · ' + ev.durationMs + ' ms' : ''}</span>
            </summary>
            <pre class="code-block">${escapeHtml(JSON.stringify({
              scenario: ev.scenario,
              req: ev.reqBody,
              resp: ev.respBody,
              error: ev.error,
              extra: ev.extra,
            }, null, 2))}</pre>
          </details>
        `).join('')}
      </div>
    `;

    // Wire the embedded runner form
    const runBtn = this.root.querySelector('[data-ltrace-run]');
    if (runBtn && this.onRunScenario) {
      runBtn.addEventListener('click', () => {
        const scenario = this.root.querySelector('[data-ltrace-scenario]')?.value;
        const amount = parseFloat(this.root.querySelector('[data-ltrace-amount]')?.value || '49.99');
        const currency = this.root.querySelector('[data-ltrace-currency]')?.value || 'USD';
        const initiator = this.root.querySelector('[data-ltrace-initiator]')?.value || 'GATEWAY';
        this.onRunScenario({ scenario, amount, currency, initiator });
      });
    }
  }

  renderArrow(ev, idx, laneW, topPad, rowH) {
    const fromIdx = LANE_INDEX[ev.from];
    const toIdx = LANE_INDEX[ev.to];
    if (fromIdx == null || toIdx == null) return '';
    const x1 = laneW * fromIdx + laneW / 2;
    const x2 = laneW * toIdx + laneW / 2;
    const y = topPad + idx * rowH + rowH / 2;
    const dir = x2 > x1 ? 1 : -1;
    const midX = (x1 + x2) / 2;
    const className = `ltrace__arrow ltrace__arrow--${ev.kind} ${ev.ok ? 'is-ok' : 'is-err'}`;
    const labelY = y - 6;

    // Curve slightly for same-lane (self-loop) — small arc above the node
    if (fromIdx === toIdx) {
      return `
        <g class="${className}">
          <path d="M ${x1 - 14} ${y - 10} a 14 14 0 1 1 28 0" fill="none" marker-end="url(#arrow-${(ev.kind === 'simulated' || ev.kind === 'baseline') ? 'sim' : 'http'})" />
          <text x="${x1}" y="${labelY - 10}" text-anchor="middle" class="ltrace__arrow-label">${escapeHtml(ev.label)}</text>
        </g>
      `;
    }

    return `
      <g class="${className}">
        <line x1="${x1 + dir * 12}" y1="${y}" x2="${x2 - dir * 12}" y2="${y}"
              marker-end="url(#arrow-${(ev.kind === 'simulated' || ev.kind === 'baseline') ? 'sim' : 'http'})"
              class="ltrace__arrow-line" />
        <text x="${midX}" y="${labelY}" text-anchor="middle" class="ltrace__arrow-label">${escapeHtml(ev.label)}</text>
        ${ev.durationMs != null
          ? `<text x="${midX}" y="${y + 14}" text-anchor="middle" class="ltrace__arrow-dur">${ev.durationMs} ms</text>`
          : `<text x="${midX}" y="${y + 14}" text-anchor="middle" class="ltrace__arrow-dur">${ev.kind === 'simulated' ? 'simulated' : ''}</text>`}
      </g>
    `;
  }
}

function laneLabel(id) {
  return LANES.find((l) => l.id === id)?.label ?? id;
}

function simulatedLabel(lane, origin) {
  switch (lane) {
    case 'chCreds': return 'POST /payments-vas/v1/security/credentials (mocked)';
    case 'chOrders': return 'POST /checkouts/v1/orders (mocked)';
    case 'provider':
      if (origin?.includes('ideal') || origin?.includes('ppro')) return 'PPRO /v1/payment-charges (not reached)';
      return 'provider rail (mocked)';
    default: return lane;
  }
}

function simulatedReturnLabel(lane) {
  switch (lane) {
    case 'chCreds': return '200 accessToken';
    case 'chOrders': return '200 CAPTURED / PENDING / AUTHORIZED';
    case 'provider': return 'authorized';
    default: return 'response';
  }
}
