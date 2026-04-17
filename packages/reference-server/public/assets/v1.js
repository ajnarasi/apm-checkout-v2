/**
 * v2.2 harness — V1 Legacy mode.
 *
 * Embeds v1's 6 HTML pages inside the v2.2 Fiserv-orange chrome via the
 * reference server's /v1/ static proxy and /v1-api/ reverse proxy (backed
 * by an auto-spawned child process running test-harness/server.js on :3847).
 *
 * Pattern mirrors DocsView in docs.js: lazy activate() → one-time build() →
 * selectPage() swaps the iframe src. All classes v1-prefixed.
 */

import { escapeHtml } from './catalog.js';

const STATUS_POLL_MS = 5000;
const LOGS_POLL_MS = 3000;
const LOGS_TAIL = 50;

const v1Origin = () => `${location.protocol}//${location.host}`;

const V1_PAGES = Object.freeze([
  {
    file: 'checkout-sdk-test.html',
    title: 'Unified 54-APM harness',
    description: 'Main v1 E2E harness. Init → Render → Authorize → Handle Return across all 54 APMs grouped by region.',
  },
  {
    file: 'index.html',
    title: 'v1 portal hub',
    description: 'Landing page with Swagger UI, PRD tabs, documentation browser.',
  },
  {
    file: 'klarna.html',
    title: 'Klarna solo test',
    description: 'Klarna BNPL widget end-to-end against Klarna playground sandbox.',
  },
  {
    file: 'cashapp.html',
    title: 'Cash App Pay solo test',
    description: 'Cash App sandbox customer-request flow with live polling.',
  },
  {
    file: 'ppro.html',
    title: 'PPRO 52-APM matrix',
    description: 'Regional test matrix hitting /api/ppro/charge for every PPRO method.',
  },
  {
    file: 'zepto-setup.html',
    title: 'Zepto OAuth bootstrap',
    description: 'One-time OAuth credential setup UI (writes .zepto-tokens.json).',
  },
]);

const DEFAULT_PAGE = 'checkout-sdk-test.html';

const COMPARE_ROWS = Object.freeze([
  {
    capability: 'Server endpoint pattern',
    v1: 'Per-APM convention routes (<code>/api/klarna/session</code>, <code>/api/cashapp/request</code>, <code>/api/ppro/charge</code>, ...)',
    v2: 'Unified: <code>POST /v2/sessions</code> → <code>POST /v2/orders/:apm</code> → one CH <code>/checkouts/v1/orders</code> (ADR-004)',
  },
  {
    capability: 'Test harness architecture',
    v1: 'Per-APM solo HTML pages + unified 54-APM harness',
    v2: 'Single unified v2.2 harness with Inspector + Docs + V1 Legacy modes',
  },
  {
    capability: 'APM catalog',
    v1: '54 APMs hardcoded in <code>APMS</code> object',
    v2: '70 APMs in typed <code>APM_MAPPING</code> registry (shared-types)',
  },
  {
    capability: 'Authentication flow',
    v1: 'Token per auth endpoint',
    v2: 'Single accessToken from CH Credentials API, reused as Bearer on all Orders calls',
  },
  {
    capability: 'Settlement operations',
    v1: 'Scattered <code>/api/klarna/capture</code>, <code>/api/klarna/refund</code>, ...',
    v2: 'Single Orders API: <code>POST /v2/orders/:orderId/(capture|void|refund)</code>',
  },
  {
    capability: 'Async APM completion',
    v1: 'Polling loop per page',
    v2: 'SSE: <code>GET /v2/events/:sessionId</code> + first-writer-wins OrderResultCache',
  },
  {
    capability: 'Callback event support',
    v1: '18 events, manually mapped per APM',
    v2: '16 canonical events enforced by the 11-state FSM (ADR-003)',
  },
  {
    capability: 'Provider SDK integration',
    v1: 'Inline script tags',
    v2: '6 base adapter classes (redirect / bnpl / native-wallet / button-sdk / qr / voucher)',
  },
  {
    capability: 'Rate limiting',
    v1: 'None',
    v2: 'Per-bucket: <code>/v2/sessions</code>, <code>/v2/orders/*</code>, <code>/v2/webhooks/*</code>',
  },
  {
    capability: 'Admin visibility',
    v1: '<code>GET /api/test-log</code> stub',
    v2: '<code>GET /metrics</code> Prometheus format + structured logs with correlationId',
  },
]);

function formatUptime(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export class V1View {
  constructor({ rootEl }) {
    this.root = rootEl;
    this.activePage = DEFAULT_PAGE;
    this.isActive = false;
    this.statusTimer = null;
    this.logsTimer = null;
    this.lastStatus = null;
  }

  async activate() {
    if (!this.root.dataset.built) {
      this.build();
      this.root.dataset.built = '1';
    }
    this.isActive = true;
    await Promise.allSettled([this.renderStatus(), this.renderLogs()]);
    this.startPolling();
  }

  deactivate() {
    this.isActive = false;
    this.stopPolling();
  }

  build() {
    this.root.innerHTML = `
      <div class="v1-layout">
        <aside class="v1-nav" aria-label="V1 pages">
          <div class="v1-nav__header">
            <div class="kicker">V1 Legacy</div>
            <h2 class="v1-nav__title">6 pages</h2>
            <button class="btn btn--ghost v1-nav__launch" type="button" data-v1-launch>
              Launch v1 in new tab ↗
            </button>
          </div>
          <div class="v1-nav__list">
            ${V1_PAGES.map((p) => `
              <button
                class="v1-nav__item${p.file === this.activePage ? ' is-active' : ''}"
                data-v1-page="${escapeHtml(p.file)}"
                type="button"
              >
                <span class="v1-nav__item-title">${escapeHtml(p.title)}</span>
                <span class="v1-nav__item-file">${escapeHtml(p.file)}</span>
                <span class="v1-nav__item-desc">${escapeHtml(p.description)}</span>
              </button>
            `).join('')}
          </div>
        </aside>

        <main class="v1-main" data-v1-main>
          <header class="v1-header">
            <div class="kicker">V1 Legacy harness</div>
            <h1 class="v1-header__title" data-v1-title></h1>
            <p class="v1-header__desc" data-v1-desc></p>
          </header>

          <div class="v1-status" data-v1-status role="status" aria-live="polite">
            <span class="v1-status__dot"></span>
            <span class="v1-status__text">checking v1 server…</span>
          </div>

          <div class="v1-chrome" data-v1-chrome>
            <div class="v1-chrome__bar">
              <span class="v1-chrome__dot v1-chrome__dot--r"></span>
              <span class="v1-chrome__dot v1-chrome__dot--y"></span>
              <span class="v1-chrome__dot v1-chrome__dot--g"></span>
              <span class="v1-chrome__url" data-v1-url></span>
              <button class="btn btn--ghost v1-chrome__open" type="button" data-v1-open>
                ↗ Open in new tab
              </button>
            </div>
            <iframe
              data-v1-iframe
              title="v1 legacy harness"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals"
              loading="lazy"
            ></iframe>
          </div>

          <section class="v1-logs-section">
            <header class="v1-logs-section__head">
              <div class="kicker">v1 server logs</div>
              <span class="v1-logs-section__hint">last ${LOGS_TAIL} lines · auto-refresh 3s</span>
            </header>
            <pre class="v1-logs" data-v1-logs>loading logs…</pre>
          </section>

          <section class="v1-compare-section">
            <div class="kicker">v1 ↔ v2.2 comparison</div>
            <h2 class="v1-compare-section__title">What changed in v2.2</h2>
            <div class="v1-compare-wrap">
              <table class="v1-compare">
                <thead>
                  <tr>
                    <th scope="col">Capability</th>
                    <th scope="col">v1</th>
                    <th scope="col">v2.2</th>
                  </tr>
                </thead>
                <tbody>
                  ${COMPARE_ROWS.map((row) => `
                    <tr>
                      <th scope="row">${escapeHtml(row.capability)}</th>
                      <td>${row.v1}</td>
                      <td>${row.v2}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    `;

    for (const btn of this.root.querySelectorAll('[data-v1-page]')) {
      btn.addEventListener('click', () => this.selectPage(btn.dataset.v1Page));
    }
    const launchBtn = this.root.querySelector('[data-v1-launch]');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        const url = `${v1Origin()}/v1/${DEFAULT_PAGE}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    }
    const openBtn = this.root.querySelector('[data-v1-open]');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const url = `${v1Origin()}/v1/${this.activePage}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    }
    this.applyActivePage();
  }

  selectPage(filename) {
    const page = V1_PAGES.find((p) => p.file === filename);
    if (!page) return;
    this.activePage = filename;
    for (const btn of this.root.querySelectorAll('[data-v1-page]')) {
      btn.classList.toggle('is-active', btn.dataset.v1Page === filename);
    }
    this.applyActivePage();
  }

  applyActivePage() {
    const page = V1_PAGES.find((p) => p.file === this.activePage);
    if (!page) return;
    const title = this.root.querySelector('[data-v1-title]');
    const desc = this.root.querySelector('[data-v1-desc]');
    const url = this.root.querySelector('[data-v1-url]');
    const iframe = this.root.querySelector('[data-v1-iframe]');
    if (title) title.textContent = page.title;
    if (desc) desc.textContent = page.description;
    const path = `/v1/${page.file}`;
    if (url) url.textContent = path;
    if (iframe && iframe.getAttribute('src') !== path) {
      iframe.setAttribute('src', path);
    }
  }

  startPolling() {
    this.stopPolling();
    this.statusTimer = setInterval(() => {
      if (!this.isActive) return;
      this.renderStatus().catch(() => {});
    }, STATUS_POLL_MS);
    this.logsTimer = setInterval(() => {
      if (!this.isActive) return;
      this.renderLogs().catch(() => {});
    }, LOGS_POLL_MS);
  }

  stopPolling() {
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (this.logsTimer)   { clearInterval(this.logsTimer);   this.logsTimer = null; }
  }

  async renderStatus() {
    const host = this.root.querySelector('[data-v1-status]');
    if (!host) return;
    let state;
    try {
      const data = await fetchJson('/v2/harness/v1-status');
      this.lastStatus = data;
      if (data && data.spawned === true) {
        state = {
          kind: 'running',
          label: `● running (pid ${escapeHtml(String(data.pid ?? '—'))}, uptime ${escapeHtml(formatUptime(data.uptime))})`,
        };
      } else if (data && data.status === 'starting') {
        state = { kind: 'starting', label: '⟳ starting…' };
      } else {
        state = {
          kind: 'failed',
          label: '✗ not running · <a href="/v2/harness/v1-logs" target="_blank" rel="noreferrer">view logs</a>',
        };
      }
    } catch (err) {
      state = {
        kind: 'failed',
        label: `✗ status unreachable (${escapeHtml(String(err?.message ?? err))})`,
      };
    }

    host.classList.remove('v1-status--running', 'v1-status--starting', 'v1-status--failed');
    host.classList.add(`v1-status--${state.kind}`);
    host.innerHTML = `<span class="v1-status__dot"></span><span class="v1-status__text">${state.label}</span>`;
  }

  async renderLogs() {
    const host = this.root.querySelector('[data-v1-logs]');
    if (!host) return;
    try {
      const data = await fetchJson(`/v2/harness/v1-logs?tail=${LOGS_TAIL}`);
      const lines = Array.isArray(data?.logs) ? data.logs : [];
      if (lines.length === 0) {
        host.textContent = '(no v1 server log lines yet)';
        return;
      }
      host.textContent = lines.join('\n');
    } catch (err) {
      host.textContent = `failed to load logs: ${String(err?.message ?? err)}`;
    }
  }
}
