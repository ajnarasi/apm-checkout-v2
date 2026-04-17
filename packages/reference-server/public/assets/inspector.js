/**
 * v2.2 Test Harness — Inspector dock: per-APM detail + runner + panes.
 *
 * Renders the right-hand inspector for the currently selected APM:
 *   · Header with wire preview (the load-bearing v2.2 fields)
 *   · Tabs: Runner · Capabilities · Wire preview · State · Events · Network
 *   · Live state machine visualization during scenario runs
 *   · Local event log (driven by HTTP + SSE)
 *   · Network inspector (driven by api.js netlog subscription)
 */

import { api, connectEvents, onNetlog, netlog, clearNetlog } from './api.js';
import { escapeHtml } from './catalog.js';
import { loadProviderSdk, unloadProviderSdk, getCredentials, saveCredentials, getLoadState } from './sdk-loader.js';
import { CallbacksPane } from './callbacks.js';
import { LiveTrace } from './live-trace.js';
import { TraceConsole } from './trace-console.js';

// Canonical state machine (matches ADR-003 — 11 states)
const STATES = [
  'idle', 'initializing', 'ready', 'authorizing', 'pending',
  'awaiting_merchant_capture', 'capturing',
  'completed', 'failed', 'cancelled', 'auth_expired',
];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'auth_expired', 'script_load_failed']);

export class Inspector {
  constructor({ emptyEl, bodyEl, scenarios, sdkRegistry, allApms }) {
    this.emptyEl = emptyEl;
    this.bodyEl = bodyEl;
    this.scenarios = scenarios;
    this.sdkRegistry = sdkRegistry ?? [];
    this._allApms = allApms ?? [];
    this.apm = null;
    // Default tab is Trace so the 6-lane live API sequence diagram is
    // visible the moment the user selects an APM, without needing to know
    // which tab to click.
    this.activeTab = 'trace';
    this.scenarioId = 'sale_ok';
    this.events = []; // { ts, type, data }
    this.sseHandle = null;
    this.activeSessionId = null;
    this.activeOrderId = null;
    this.activeReferenceId = null;
    this.runState = 'idle';
    this.visitedStates = new Set(['idle']);
    this.currentState = 'idle';

    this.callbacksPane = new CallbacksPane({
      rootEl: document.querySelector('[data-callbacks-root]'),
      onFire: ({ key, payload, response }) => {
        this.pushLocalEvent(`CALLBACK:${key}`, { payload, response });
        // Also push into the Live Trace with an SDK-callback arrow.
        this.liveTrace.pushEvent({
          from: 'provider',
          to: 'browser',
          label: `${key} fired`,
          kind: 'event',
          extra: { payload },
        });
        this.liveTrace.pushEvent({
          from: 'browser',
          to: 'merchant',
          label: `${key} recomputed`,
          kind: 'event',
          extra: { response },
        });
        this.liveTrace.pushEvent({
          from: 'merchant',
          to: 'provider',
          label: `${key} updated totals`,
          kind: 'event',
          extra: { response },
        });
      },
    });
    this.liveTrace = new LiveTrace({
      rootEl: document.querySelector('[data-trace-root]'),
      getRunnerSnapshot: () => ({
        apm: this.apm,
        currentState: this.currentState,
        events: this.events,
        orderId: this.activeOrderId,
        sessionId: this.activeSessionId,
      }),
      // Expose the runner controls to the embedded form at the top of the
      // Trace tab. This is how we make payment-testing discoverable without
      // asking the user to navigate away from the default tab.
      getRunnerControls: () => {
        if (!this.apm) return null;
        const eligible = new Set(this.apm.capabilities.eligibleScenarios);
        return {
          apmName: this.apm.displayName,
          currentScenario: this.scenarioId,
          amount: parseFloat(this.cache.amount?.value ?? '49.99') || 49.99,
          currency: this.cache.currency?.value || (this.apm.currencies[0] ?? 'USD'),
          initiator: this.cache.initiator?.value ?? 'GATEWAY',
          currencies: this.apm.currencies.length ? this.apm.currencies : ['USD', 'EUR', 'GBP'],
          scenarios: this.scenarios.map((s) => ({
            id: s.id,
            title: s.title,
            disabled: !eligible.has(s.id),
          })),
        };
      },
      onRunScenario: ({ scenario, amount, currency, initiator }) => {
        // Sync the form inputs from the embedded control into the Runner tab's
        // inputs so state stays consistent if the user flips to Runner later.
        if (this.cache.amount) this.cache.amount.value = String(amount);
        if (this.cache.currency) this.cache.currency.value = currency;
        if (this.cache.initiator) this.cache.initiator.value = initiator;
        this.scenarioId = scenario;
        this.runActive();
      },
    });

    // Plaid-style Trace Console: eligibility bar + Run button + JSON
    // inspector + persona toggle rendered above the 6-lane SVG. Replaces
    // the rejected Iteration-3 Init/Render/Authorize/Teardown button row.
    this.traceConsole = new TraceConsole({
      rootEl: document.querySelector('[data-trace-console-root]'),
      inspectorEl: document.querySelector('[data-trace-inspector]'),
      snippetEl: document.querySelector('[data-trace-snippet]'),
      getApm: () => this.apm,
      getAllApms: () => (this._allApms ?? []),
      onRunScenario: ({ scenarioId, events }) => {
        this.liveTrace.reset();
        this.traceConsole.clearInspector();
        // Play the scripted event sequence into the LiveTrace event bus
        // with realistic spacing, and stream each row into the inspector.
        let delay = 0;
        for (const ev of events) {
          delay += ev.delayMs ?? 600;
          setTimeout(() => {
            this.liveTrace.pushEvent({
              from: ev.from,
              to: ev.to,
              label: ev.label,
              kind: ev.kind ?? 'scenario',
              status: ev.status ?? 'OK',
              extra: { req: ev.requestBody, resp: ev.responseBody, caption: ev.caption },
            });
            this.traceConsole.pushRow(ev);
          }, delay);
        }
      },
    });

    this.cache = {
      amount: document.getElementById('runner-amount'),
      currency: document.getElementById('runner-currency'),
      initiator: document.getElementById('runner-initiator'),
      order: document.getElementById('runner-order'),
      btnRun: document.getElementById('btn-run'),
      btnRunAll: document.getElementById('btn-run-all'),
      status: document.querySelector('[data-runner-status]'),
      result: document.querySelector('[data-runner-result]'),
      summary: document.querySelector('[data-runner-summary]'),
      // Sandbox creds section (Klarna / CashApp / PPRO)
      credsRoot: document.querySelector('[data-runner-creds]'),
      credsFields: document.querySelector('[data-runner-creds-fields]'),
      credsReload: document.querySelector('[data-creds-reload]'),
      credsToggle: document.querySelector('[data-creds-toggle]'),
      credsRun: document.querySelector('[data-sandbox-run]'),
      credsSub: document.querySelector('[data-creds-sub]'),
      credsHint: document.querySelector('[data-creds-action-hint]'),
      credsResult: document.querySelector('[data-creds-result]'),
      credsStatus: document.querySelector('[data-creds-status]'),
      credsBody: document.querySelector('[data-creds-result-body]'),
    };

    this.sandboxCreds = null;
    this.sandboxKey = null;

    this.eventLogEl = document.querySelector('[data-event-log]');
    this.netLogEl = document.querySelector('[data-net-log]');
    this.smEl = document.querySelector('[data-statemachine]');

    // Tab switching
    for (const tab of document.querySelectorAll('[data-itab]')) {
      tab.addEventListener('click', () => this.setTab(tab.dataset.itab));
    }

    // Run buttons
    this.cache.btnRun.addEventListener('click', () => this.runActive());
    this.cache.btnRunAll.addEventListener('click', () => this.runEligibleBatch());

    // Sandbox credential controls
    if (this.cache.credsReload) {
      this.cache.credsReload.addEventListener('click', () => this.reloadSandboxCreds());
    }
    if (this.cache.credsToggle) {
      this.cache.credsToggle.addEventListener('click', () => this.toggleSandboxCredsFields());
    }
    if (this.cache.credsRun) {
      this.cache.credsRun.addEventListener('click', () => this.runSandboxCall());
    }

    // Live network inspector binding
    onNetlog(() => {
      if (this.activeTab === 'network') this.renderNetwork();
    });
  }

  // ─── Sandbox credentials (Klarna / CashApp / PPRO) ───────────
  sandboxApmKey(entry) {
    if (!entry) return null;
    const id = String(entry.id || '').toLowerCase();
    if (id === 'klarna' || id === 'cashapp' || id === 'ppro') return id;
    if (entry.isPproRouted) return 'ppro';
    return null;
  }

  async refreshSandboxCreds(entry) {
    const key = this.sandboxApmKey(entry);
    this.sandboxKey = key;
    if (!this.cache.credsRoot) return;
    if (!key) {
      this.cache.credsRoot.hidden = true;
      this.sandboxCreds = null;
      return;
    }
    this.cache.credsRoot.hidden = false;
    if (this.cache.credsResult) this.cache.credsResult.hidden = true;
    if (this.cache.credsSub) {
      const label = entry.displayName || entry.id;
      this.cache.credsSub.textContent =
        key === 'ppro'
          ? `${label} routes through PPRO — using PPRO sandbox credentials.`
          : `${label} sandbox credentials are pre-filled from the server.`;
    }
    try {
      const resp = await api.sandboxDefaults(key);
      this.sandboxCreds = resp && resp.creds ? resp.creds : null;
      this.renderSandboxCredFields();
    } catch (err) {
      this.sandboxCreds = null;
      if (this.cache.credsFields) {
        this.cache.credsFields.innerHTML = `<div class="log__empty">Could not load sandbox defaults: ${escapeHtml(err?.message ?? 'error')}</div>`;
      }
    }
  }

  sandboxFieldSpec(key) {
    if (key === 'klarna') {
      return [
        { key: 'baseUrl',    label: 'Base URL',    helper: 'Klarna playground endpoint' },
        { key: 'username',   label: 'API username' },
        { key: 'password',   label: 'API password', mono: true },
        { key: 'merchantId', label: 'Merchant ID' },
      ];
    }
    if (key === 'cashapp') {
      return [
        { key: 'baseUrl',    label: 'Base URL' },
        { key: 'clientId',   label: 'Client ID' },
        { key: 'apiKeyId',   label: 'API key id' },
        { key: 'brandId',    label: 'Brand id' },
        { key: 'merchantId', label: 'Merchant id' },
      ];
    }
    if (key === 'ppro') {
      return [
        { key: 'baseUrl',    label: 'Base URL' },
        { key: 'token',      label: 'Bearer token', mono: true },
        { key: 'merchantId', label: 'Merchant id' },
      ];
    }
    return [];
  }

  renderSandboxCredFields() {
    const fields = this.sandboxFieldSpec(this.sandboxKey);
    if (!this.cache.credsFields) return;
    if (!fields.length || !this.sandboxCreds) {
      this.cache.credsFields.innerHTML = '';
      return;
    }
    this.cache.credsFields.innerHTML = fields
      .map((f) => {
        const value = this.sandboxCreds[f.key] ?? '';
        const id = `creds-${this.sandboxKey}-${f.key}`;
        const monoClass = f.mono ? ' field__input--mono' : '';
        return `
          <label class="field field--creds">
            <span class="field__label">${escapeHtml(f.label)}</span>
            <input type="text" id="${id}" class="field__input${monoClass}"
                   data-cred-key="${escapeHtml(f.key)}"
                   value="${escapeHtml(String(value))}"
                   spellcheck="false" autocomplete="off" />
            ${f.helper ? `<span class="field__helper">${escapeHtml(f.helper)}</span>` : ''}
          </label>`;
      })
      .join('');
    if (this.cache.credsHint) {
      const actionName = this.sandboxKey === 'klarna'
        ? 'Klarna POST /credit/session'
        : this.sandboxKey === 'cashapp'
          ? 'Cash App POST /customer-request'
          : 'PPRO POST /payments/v2/payments';
      this.cache.credsHint.textContent = `→ ${actionName}`;
    }
  }

  readSandboxCredsFromForm() {
    if (!this.cache.credsFields) return null;
    const inputs = this.cache.credsFields.querySelectorAll('input[data-cred-key]');
    const out = {};
    for (const input of inputs) {
      out[input.dataset.credKey] = input.value;
    }
    return out;
  }

  async reloadSandboxCreds() {
    if (!this.apm) return;
    await this.refreshSandboxCreds(this.apm);
  }

  toggleSandboxCredsFields() {
    if (!this.cache.credsFields || !this.cache.credsToggle) return;
    const isHidden = this.cache.credsFields.hidden;
    this.cache.credsFields.hidden = !isHidden;
    this.cache.credsToggle.textContent = isHidden ? 'Hide' : 'Show';
    this.cache.credsToggle.setAttribute('aria-expanded', String(isHidden));
  }

  async runSandboxCall() {
    if (!this.sandboxKey) return;
    const key = this.sandboxKey;
    const action = key === 'klarna' ? 'session' : key === 'cashapp' ? 'request' : 'charge';
    const amount = parseFloat(this.cache.amount.value || '49.99');
    const currency = this.cache.currency.value || 'USD';
    const merchantReference =
      this.cache.order.value || `harness-${Date.now().toString(36)}`;

    const body =
      key === 'klarna'
        ? {
            amount,
            currency,
            merchantReference,
            shippingAddress: { country: 'US' },
            billingAddress: { country: 'US' },
            items: [
              {
                name: 'Harness test item',
                quantity: 1,
                unitPrice: amount,
                grossAmount: amount,
              },
            ],
          }
        : key === 'cashapp'
          ? { amount, currency, merchantReference }
          : {
              amount,
              currency,
              customerName: 'Harness Tester',
              customerEmail: 'harness@example.com',
              country: 'DE',
              paymentMethod: 'SOFORT',
              captureFlag: true,
              returnUrl: 'https://harness.example/return',
              merchantOrderId: merchantReference,
            };

    const overrides = this.readSandboxCredsFromForm();
    if (overrides && Object.keys(overrides).length) body.__sandboxCreds = overrides;

    if (this.cache.credsResult) this.cache.credsResult.hidden = false;
    if (this.cache.credsStatus) {
      this.cache.credsStatus.className = 'badge is-running';
      this.cache.credsStatus.textContent = 'running';
    }
    if (this.cache.credsBody) this.cache.credsBody.textContent = '';
    try {
      const resp = await api.sandboxCall({ apm: key, action, body });
      if (this.cache.credsStatus) {
        this.cache.credsStatus.className = 'badge is-ok';
        this.cache.credsStatus.textContent = 'ok';
      }
      if (this.cache.credsBody) {
        this.cache.credsBody.textContent = JSON.stringify(resp, null, 2);
      }
    } catch (err) {
      if (this.cache.credsStatus) {
        this.cache.credsStatus.className = 'badge is-err';
        this.cache.credsStatus.textContent = 'failed';
      }
      if (this.cache.credsBody) {
        const detail = err?.body ?? { error: err?.message ?? 'unknown' };
        this.cache.credsBody.textContent = JSON.stringify(detail, null, 2);
      }
    }
  }

  load(entry) {
    this.apm = entry;
    this.emptyEl.hidden = true;
    this.bodyEl.hidden = false;

    // Fill header
    document.querySelector('[data-inspector-region]').textContent = entry.capabilities.region.toUpperCase();
    document.querySelector('[data-inspector-name]').textContent = entry.displayName;
    document.querySelector('[data-inspector-id]').textContent = entry.id;
    document.querySelector('[data-inspector-pattern]').textContent = entry.pattern;
    // Replace "aggregator" with a meaningful routing chain. For PPRO sub-methods
    // we show "CH → PPRO → <PROVIDER>" to make it explicit that CH owns the
    // fan-out to PPRO internally. For direct methods we show "CH → <PROVIDER>".
    const routingEl = document.querySelector('[data-inspector-aggregator]');
    if (entry.isPproRouted) {
      routingEl.textContent = `CH → PPRO → ${entry.chProvider ?? entry.id.toUpperCase()}`;
    } else if (entry.chProvider) {
      routingEl.textContent = `CH → ${entry.chProvider}`;
    } else if (entry.chWalletType) {
      routingEl.textContent = `CH → wallet ${entry.chWalletType}`;
    } else {
      routingEl.textContent = `CH → ${entry.id.toUpperCase()}`;
    }
    document.querySelector('[data-wire-source]').textContent = entry.chSourceType;
    document.querySelector('[data-wire-wallet]').textContent = entry.chWalletType ?? '—';
    const providerEl = document.querySelector('[data-wire-provider]');
    providerEl.textContent = entry.chProvider ?? '—';

    // Prefill runner
    this.cache.order.value = `harness-${entry.id}-${Date.now().toString(36)}`;
    this.fillCurrencyOptions(entry.currencies);

    // Default scenario
    const eligible = entry.capabilities.eligibleScenarios;
    this.scenarioId = eligible[0] ?? 'sale_ok';

    this.cache.btnRun.disabled = false;
    this.cache.btnRunAll.disabled = false;

    this.renderScenarios();
    // Re-render the trace console for the newly selected APM
    this.traceConsole.resetForApm();
    // Explicitly activate the default tab so the .is-active class lands on
    // Trace (not Runner, which is the stale default in the HTML markup).
    this.setTab(this.activeTab);
    this.resetRunnerResult();
    this.updateCallbacksLiveBadge();
    // Fire-and-forget sandbox creds fetch for Klarna / CashApp / PPRO.
    this.refreshSandboxCreds(entry);
  }

  fillCurrencyOptions(currencies) {
    const sel = this.cache.currency;
    sel.innerHTML = '';
    const pool = currencies.length ? currencies : ['USD', 'EUR', 'GBP'];
    for (const c of pool) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
  }

  setTab(tab) {
    this.activeTab = tab;
    for (const t of document.querySelectorAll('[data-itab]')) {
      t.classList.toggle('is-active', t.dataset.itab === tab);
    }
    for (const p of document.querySelectorAll('[data-ipane]')) {
      p.classList.toggle('is-active', p.dataset.ipane === tab);
    }
    // Wide-trace mode: collapse the left filter rail + catalog when the
    // Trace tab is active so the progressive test flow + commerce flow
    // diagram have room to breathe (per frontend-architect spec).
    document.body.classList.toggle('wide-trace', tab === 'trace');
    this.renderActiveTab();
  }

  renderActiveTab() {
    if (!this.apm) return;
    if (this.activeTab === 'capabilities') this.renderCapabilities();
    if (this.activeTab === 'wire') this.renderWirePreview();
    if (this.activeTab === 'state') this.renderStateMachine();
    if (this.activeTab === 'events') this.renderEvents();
    if (this.activeTab === 'network') this.renderNetwork();
    if (this.activeTab === 'sdk') this.renderSdkPane();
    if (this.activeTab === 'callbacks') this.callbacksPane.load(this.apm);
    if (this.activeTab === 'trace') {
      this.traceConsole.render();
      this.liveTrace.render();
    }
  }

  // Light up / dim the LIVE badge on the Callbacks tab button. Reads
  // from sdk-loader's load-state map: when ANY SDK is loaded for the
  // currently-selected APM, the badge is on.
  updateCallbacksLiveBadge() {
    const tab = document.querySelector('[data-itab="callbacks"]');
    if (!tab || !this.apm) return;
    const state = getLoadState(this.apm.id);
    const isLive = state.status === 'loaded';
    let badge = tab.querySelector('.itab__badge');
    if (isLive) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'itab__badge';
        badge.setAttribute('title', 'Live SDK callbacks wired');
        badge.textContent = 'LIVE';
        tab.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  // Surgical status update — does not touch mount nodes, so widgets
  // already painted by the provider SDK survive.
  updateSdkStatusInPlace(status, errorMsg, durationMs, cdnUrl) {
    const el = document.querySelector('.sdk__status');
    if (!el) return;
    el.className = `sdk__status is-${status}`;
    const strong = el.querySelector('strong');
    if (strong) strong.textContent = status.toUpperCase();
    const dds = el.querySelectorAll('dd');
    if (cdnUrl && dds[0]) dds[0].textContent = cdnUrl;
    if (dds[2]) dds[2].textContent = durationMs != null ? `${durationMs} ms` : '—';
    const existingErr = el.querySelector('.sdk__status-err');
    if (existingErr) existingErr.remove();
    if (errorMsg) {
      const errEl = document.createElement('div');
      errEl.className = 'sdk__status-err';
      errEl.style.cssText = 'color:var(--err);font-size:0.72rem;margin-top:4px;';
      errEl.textContent = errorMsg;
      el.appendChild(errEl);
    }
  }

  // ─── SDK pane ──────────────────────────────────────────────
  renderSdkPane() {
    const root = document.querySelector('[data-sdk-root]');
    if (!this.apm) {
      root.innerHTML = '<div class="log__empty">Select an APM.</div>';
      return;
    }
    const entry = this.sdkRegistry.find((e) => e.apm === this.apm.id);
    if (!entry) {
      root.innerHTML = `
        <div class="sdk__heading">
          <div class="kicker">Provider SDK</div>
          <h3>${escapeHtml(this.apm.displayName)} has no browser SDK entry</h3>
          <p>
            This APM settles entirely server-side — there is no provider CDN
            script to load in the browser. The merchant backend forwards the
            order to CH, which internally routes to the downstream provider.
          </p>
        </div>
      `;
      return;
    }

    const creds = getCredentials(entry.apm);
    const state = getLoadState(entry.apm);

    root.innerHTML = `
      <div class="sdk__heading">
        <div class="kicker">Provider SDK sandbox</div>
        <h3>${escapeHtml(entry.displayName)}</h3>
        <p>
          Load the real provider CDN and render the live button / promo widget
          using your sandbox credentials. No HARNESS_MODE short-circuit here —
          this pane hits the provider directly from the browser.
        </p>
      </div>

      <div class="sdk__status is-${state.status}">
        <div class="sdk__status-dot"></div>
        <div><strong style="color:var(--ink-0);text-transform:uppercase;letter-spacing:0.08em;font-size:0.68rem;">${escapeHtml(state.status)}</strong></div>
        ${state.error ? `<div style="color:var(--err);font-size:0.72rem">${escapeHtml(state.error)}</div>` : ''}
        <dl>
          <dt>cdn</dt><dd>${escapeHtml(state.cdnUrl ?? entry.cdnUrl ?? '—')}</dd>
          <dt>global</dt><dd>window.${escapeHtml(entry.globalVariable)}</dd>
          <dt>loaded</dt><dd>${state.durationMs != null ? state.durationMs + ' ms' : '—'}</dd>
        </dl>
      </div>

      <form class="sdk__form" data-sdk-form>
        <div class="sdk__form-grid">
          ${entry.credentialFields
            .map(
              (f) => `
            <label class="field">
              <span class="field__label">${escapeHtml(f.label)}${f.required ? ' *' : ''}</span>
              <input type="text" name="${escapeHtml(f.key)}"
                     placeholder="${escapeHtml(f.placeholder)}"
                     value="${escapeHtml(creds[f.key] ?? '')}"
                     spellcheck="false" autocomplete="off" />
              ${f.helper ? `<span class="sdk__helper">${escapeHtml(f.helper)}</span>` : ''}
            </label>`
            )
            .join('')}
        </div>
        ${entry.notes ? `<div class="sdk__notes">${escapeHtml(entry.notes)}</div>` : ''}
        <div class="sdk__actions">
          <button type="submit" class="btn btn--primary">▶ Load SDK</button>
          <button type="button" class="btn btn--outline" data-sdk-unload>× Unload</button>
        </div>
      </form>

      <div class="sdk__mounts">
        ${entry.renderables.includes('button') ? `
          <div class="sdk__mount">
            <div class="sdk__mount-head"><div class="kicker">Live button</div></div>
            <div class="sdk__mount-body" data-sdk-button><div class="sdk__mount-empty">Load the SDK to render the live button.</div></div>
          </div>` : ''}
        ${entry.renderables.includes('promo-widget') ? `
          <div class="sdk__mount">
            <div class="sdk__mount-head"><div class="kicker">Promotional widget</div></div>
            <div class="sdk__mount-body" data-sdk-promo><div class="sdk__mount-empty">Load the SDK to render the promo widget.</div></div>
          </div>` : ''}
        ${entry.renderables.includes('price-tag') ? `
          <div class="sdk__mount">
            <div class="sdk__mount-head"><div class="kicker">Price-tag messaging</div></div>
            <div class="sdk__mount-body" data-sdk-pricetag><div class="sdk__mount-empty">Renders inline with product pricing.</div></div>
          </div>` : ''}
      </div>
    `;

    // Wire form — in-place updates only (no full re-render between load and
    // widget mount, otherwise mount nodes become detached before the
    // provider SDK's render() resolves).
    const form = root.querySelector('[data-sdk-form]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      saveCredentials(entry.apm, data);
      const mounts = {
        buttonEl: root.querySelector('[data-sdk-button]'),
        promoEl: root.querySelector('[data-sdk-promo]'),
        priceTagEl: root.querySelector('[data-sdk-pricetag]'),
      };
      if (mounts.buttonEl) mounts.buttonEl.innerHTML = '<div class="sdk__mount-empty">Loading…</div>';
      if (mounts.promoEl) mounts.promoEl.innerHTML = '<div class="sdk__mount-empty">Loading…</div>';
      this.updateSdkStatusInPlace('loading', null, null);

      const result = await loadProviderSdk(entry, data, mounts);

      // Update the status badge in place (stable mounts, stable form)
      this.updateSdkStatusInPlace(
        result.status,
        result.error ?? result.render?.reason,
        result.durationMs,
        result.cdnUrl
      );
      if (result.status === 'loaded' && result.render && !result.render.ok && mounts.buttonEl) {
        mounts.buttonEl.innerHTML = `<div class="widget-err">${escapeHtml(result.render.reason ?? 'Render failed')}</div>`;
      }
      // Flip the Callbacks tab LIVE badge when an SDK successfully loads so
      // the user can see live wiring is active without switching tabs.
      this.updateCallbacksLiveBadge();
    });
    root.querySelector('[data-sdk-unload]').addEventListener('click', () => {
      unloadProviderSdk(entry.apm, {
        buttonEl: root.querySelector('[data-sdk-button]'),
        promoEl: root.querySelector('[data-sdk-promo]'),
        priceTagEl: root.querySelector('[data-sdk-pricetag]'),
      });
      this.renderSdkPane();
    });
  }

  // ─── Runner ─────────────────────────────────────────────────
  renderScenarios() {
    const root = document.querySelector('[data-runner-scenarios]');
    root.innerHTML = '';
    const eligibleSet = new Set(this.apm.capabilities.eligibleScenarios);
    const byCategory = new Map();
    for (const s of this.scenarios) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s);
      byCategory.set(s.category, list);
    }
    for (const [cat, list] of byCategory) {
      const group = document.createElement('div');
      group.className = 'scenario-group';
      const title = document.createElement('div');
      title.className = 'scenario-group__title';
      title.textContent = formatCategory(cat);
      group.appendChild(title);
      const listEl = document.createElement('div');
      listEl.className = 'scenario-group__list';
      for (const s of list) {
        const btn = document.createElement('button');
        btn.className = 'scenario';
        btn.type = 'button';
        const eligible = eligibleSet.has(s.id);
        btn.disabled = !eligible;
        if (this.scenarioId === s.id) btn.classList.add('is-selected');
        btn.innerHTML = `<strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.id)}</small>`;
        btn.addEventListener('click', () => {
          this.scenarioId = s.id;
          this.renderScenarios();
        });
        listEl.appendChild(btn);
      }
      group.appendChild(listEl);
      root.appendChild(group);
    }
  }

  resetRunnerResult() {
    this.cache.result.hidden = true;
    this.cache.summary.innerHTML = '';
    this.setStatus('idle');
  }

  setStatus(state) {
    this.runState = state;
    const el = this.cache.status;
    el.className = 'badge';
    el.textContent = state;
    if (state === 'running') el.classList.add('is-running');
    if (state === 'ok') el.classList.add('is-ok');
    if (state === 'failed') el.classList.add('is-err');
    if (state === 'cancelled') el.classList.add('is-info');
    if (state === 'pending') el.classList.add('is-warn');
  }

  async runActive() {
    if (!this.apm) return;
    const scenario = this.scenarios.find((s) => s.id === this.scenarioId);
    if (!scenario) return;

    this.cache.result.hidden = false;
    this.cache.summary.innerHTML = '';
    this.setStatus('running');

    // Auto-navigate to Trace so the arrows animate in the user's field of
    // view. Without this the user stays on Runner and never sees the trace
    // fire (the #1 UX complaint from iteration 2).
    if (this.activeTab !== 'trace') this.setTab('trace');
    if (this.liveTrace?.reset) this.liveTrace.reset();

    // Reset state tracking
    this.events = [];
    this.visitedStates = new Set(['idle']);
    this.currentState = 'idle';
    clearNetlog();
    this.renderEvents();
    this.renderStateMachine();

    const amount = parseFloat(this.cache.amount.value || '49.99');
    const currency = this.cache.currency.value;
    const initiator = this.cache.initiator.value;
    const merchantOrderId = this.cache.order.value || `harness-${Date.now().toString(36)}`;

    // Some scenarios override the intent based on category
    const intent = scenario.intent;

    try {
      // 1. Create session
      this.pushLocalEvent('INITIALIZING', { apm: this.apm.id });
      this.advanceState('initializing');
      const session = await api.createSession({
        apm: this.apm.id,
        amount,
        currency,
        merchantOrderId,
      });
      this.activeSessionId = session.sessionId;
      this.pushLocalEvent('SDK_LOADED', { sessionId: session.sessionId });
      this.advanceState('ready');

      // Open SSE stream so webhook injections arrive live
      if (this.sseHandle) this.sseHandle.close();
      this.sseHandle = connectEvents(session.sessionId, {
        onEvent: (envelope) => this.onSseEvent(envelope),
        onError: () => {},
      });

      // 2. Authorize / sale
      this.pushLocalEvent('PAYMENT_METHOD_READY', {});
      this.pushLocalEvent('PAYMENT_AUTHORIZING', { intent });
      this.advanceState('authorizing');
      const order = await api.authorizeOrder({
        apm: this.apm.id,
        amount,
        currency,
        merchantOrderId,
        initiator,
        intent,
        scenario: scenario.id,
      });

      const gw = order?.gatewayResponse ?? {};
      const txState = gw.transactionState;
      this.activeOrderId = gw?.transactionProcessingDetails?.orderId;
      this.activeReferenceId = gw?.transactionProcessingDetails?.transactionId;

      // Interpret the response
      switch (txState) {
        case 'CAPTURED':
          this.pushLocalEvent('PAYMENT_AUTHORIZED', { orderId: this.activeOrderId });
          this.pushLocalEvent('PAYMENT_COMPLETED', { transactionState: txState });
          this.advanceState('completed');
          this.setStatus('ok');
          break;
        case 'AUTHORIZED':
          this.pushLocalEvent('PAYMENT_AUTHORIZED', { orderId: this.activeOrderId });
          if (initiator === 'MERCHANT' || scenario.category === 'merchant-initiated') {
            this.pushLocalEvent('AWAITING_MERCHANT_CAPTURE', { orderId: this.activeOrderId });
            this.advanceState('awaiting_merchant_capture');
            await this.runPostAuthStep(scenario, { amount, currency });
          } else {
            this.pushLocalEvent('PAYMENT_COMPLETED', { transactionState: txState });
            this.advanceState('completed');
            this.setStatus('ok');
          }
          break;
        case 'PAYER_ACTION_REQUIRED': {
          const actionUrl = order?.checkoutInteractions?.actions?.url;
          this.pushLocalEvent('REDIRECT_REQUIRED', { url: actionUrl });
          this.pushLocalEvent('PAYMENT_PENDING', { orderId: this.activeOrderId });
          this.advanceState('pending');
          this.setStatus('pending');
          // Schedule a webhook injection to drive the terminal transition
          if (scenario.webhook) {
            setTimeout(() => this.injectScenarioWebhook(scenario), scenario.webhook.delayMs);
          }
          break;
        }
        case 'DECLINED': {
          const err = order?.error?.[0];
          this.pushLocalEvent('PAYMENT_FAILED', err ?? { code: 'DECLINED' });
          this.advanceState('failed');
          this.setStatus('failed');
          break;
        }
        default:
          this.pushLocalEvent('PAYMENT_FAILED', { code: 'UNKNOWN_STATE', raw: txState });
          this.advanceState('failed');
          this.setStatus('failed');
      }
    } catch (err) {
      this.pushLocalEvent('PAYMENT_FAILED', { code: 'HTTP_ERROR', message: String(err?.message ?? err) });
      this.advanceState('failed');
      this.setStatus('failed');
    }

    this.summarize();
  }

  async runPostAuthStep(scenario, { amount, currency }) {
    // Merchant-initiated flows do a follow-up capture/void/refund
    if (scenario.id === 'authorize_ok_capture_ok') {
      this.pushLocalEvent('CAPTURING', { orderId: this.activeOrderId });
      this.advanceState('capturing');
      try {
        await api.captureOrder({
          orderId: this.activeOrderId,
          referenceTransactionId: this.activeReferenceId,
          amount, currency,
        });
        this.pushLocalEvent('PAYMENT_COMPLETED', { via: 'capture' });
        this.advanceState('completed');
        this.setStatus('ok');
      } catch (err) {
        this.pushLocalEvent('PAYMENT_FAILED', { at: 'capture', message: String(err?.message) });
        this.advanceState('failed');
        this.setStatus('failed');
      }
      return;
    }
    if (scenario.id === 'authorize_ok_partial_capture') {
      this.pushLocalEvent('CAPTURING', { orderId: this.activeOrderId, partial: true });
      this.advanceState('capturing');
      try {
        await api.captureOrder({
          orderId: this.activeOrderId,
          referenceTransactionId: this.activeReferenceId,
          amount: +(amount / 2).toFixed(2),
          currency,
        });
        this.pushLocalEvent('PAYMENT_COMPLETED', { via: 'partial_capture' });
        this.advanceState('completed');
        this.setStatus('ok');
      } catch (err) {
        this.pushLocalEvent('PAYMENT_FAILED', { at: 'partial_capture', message: String(err?.message) });
        this.advanceState('failed');
        this.setStatus('failed');
      }
      return;
    }
    if (scenario.id === 'authorize_ok_void') {
      try {
        await api.voidOrder({
          orderId: this.activeOrderId,
          referenceTransactionId: this.activeReferenceId,
          reason: 'harness_void',
        });
        this.pushLocalEvent('PAYMENT_CANCELLED', { via: 'void' });
        this.advanceState('cancelled');
        this.setStatus('cancelled');
      } catch (err) {
        this.pushLocalEvent('PAYMENT_FAILED', { at: 'void', message: String(err?.message) });
        this.advanceState('failed');
        this.setStatus('failed');
      }
      return;
    }
    if (scenario.id === 'authorize_ok_auth_expires') {
      this.pushLocalEvent('AUTH_EXPIRING', {});
      setTimeout(() => {
        this.pushLocalEvent('AUTH_EXPIRED', {});
        this.advanceState('auth_expired');
        this.setStatus('failed');
      }, 600);
      return;
    }
    if (scenario.id === 'refund_ok') {
      try {
        await api.refundOrder({
          orderId: this.activeOrderId,
          referenceTransactionId: this.activeReferenceId,
          amount, currency,
          reason: 'harness_refund',
        });
        this.pushLocalEvent('PAYMENT_COMPLETED', { via: 'refund' });
        this.advanceState('completed');
        this.setStatus('ok');
      } catch (err) {
        this.pushLocalEvent('PAYMENT_FAILED', { at: 'refund', message: String(err?.message) });
        this.advanceState('failed');
        this.setStatus('failed');
      }
      return;
    }
    // Fallback: just complete
    this.pushLocalEvent('PAYMENT_COMPLETED', {});
    this.advanceState('completed');
    this.setStatus('ok');
  }

  async injectScenarioWebhook(scenario) {
    if (!scenario.webhook || !this.activeSessionId) return;
    const kindMap = {
      'CAPTURED': 'payment.succeeded',
      'DECLINED': 'payment.failed',
      'CANCELLED': 'payment.cancelled',
      'AUTH_EXPIRED': 'payment.expired',
      'AUTHORIZED': 'payment.authorized',
    };
    const wKind = kindMap[scenario.webhook.kind] ?? 'payment.succeeded';
    try {
      await api.injectWebhook({
        sessionId: this.activeSessionId,
        kind: wKind,
        apm: this.apm.id,
        orderId: this.activeOrderId,
        referenceTransactionId: this.activeReferenceId,
      });
    } catch (err) {
      this.pushLocalEvent('PAYMENT_FAILED', { at: 'webhook_inject', message: String(err?.message) });
    }
  }

  onSseEvent(envelope) {
    this.pushLocalEvent('WEBHOOK_RECEIVED', envelope);
    switch (envelope.kind) {
      case 'payment.succeeded':
        this.pushLocalEvent('PAYMENT_COMPLETED', { via: 'webhook' });
        this.advanceState('completed');
        this.setStatus('ok');
        break;
      case 'payment.failed':
        this.pushLocalEvent('PAYMENT_FAILED', { via: 'webhook' });
        this.advanceState('failed');
        this.setStatus('failed');
        break;
      case 'payment.cancelled':
        this.pushLocalEvent('PAYMENT_CANCELLED', { via: 'webhook' });
        this.advanceState('cancelled');
        this.setStatus('cancelled');
        break;
      case 'payment.expired':
        this.pushLocalEvent('AUTH_EXPIRED', { via: 'webhook' });
        this.advanceState('auth_expired');
        this.setStatus('failed');
        break;
    }
    this.summarize();
  }

  pushLocalEvent(type, data) {
    this.events.push({ ts: Date.now(), type, data });
    if (this.activeTab === 'events') this.renderEvents();
  }

  advanceState(state) {
    this.currentState = state;
    this.visitedStates.add(state);
    if (this.activeTab === 'state') this.renderStateMachine();
  }

  summarize() {
    const lines = [
      `apm = ${this.apm.id}`,
      `scenario = ${this.scenarioId}`,
      `state = ${this.currentState}`,
      `events = ${this.events.length}`,
      `orderId = ${this.activeOrderId ?? '—'}`,
      `sessionId = ${this.activeSessionId ?? '—'}`,
    ];
    this.cache.summary.textContent = lines.join('\n');
  }

  async runEligibleBatch() {
    const eligible = this.scenarios.filter((s) =>
      this.apm.capabilities.eligibleScenarios.includes(s.id)
    );
    for (const s of eligible) {
      this.scenarioId = s.id;
      this.renderScenarios();
      await this.runActive();
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  // ─── Capabilities pane ──────────────────────────────────────
  renderCapabilities() {
    const grid = document.querySelector('[data-capgrid]');
    grid.innerHTML = '';
    const c = this.apm.capabilities;
    const sections = [
      ['Flow', [
        ['Gateway initiated', c.supportsGatewayInitiated],
        ['Merchant initiated', c.supportsMerchantInitiated],
        ['Separate capture', c.supportsSeparateCapture],
        ['Partial capture', c.supportsPartialCapture],
        ['Void', c.supportsVoid],
        ['Refund', c.supportsRefund],
        ['Partial refund', c.supportsPartialRefund],
        ['Default initiator', c.defaultInitiator],
      ]],
      ['Token lifecycle', [
        ['Single-use token', c.tokenSingleUse],
        ['Token TTL', c.tokenTTLMs != null ? `${(c.tokenTTLMs / 1000 / 60).toFixed(0)} min` : '—'],
        ['Auth hold TTL', c.authHoldTTLMs != null ? `${(c.authHoldTTLMs / 1000 / 60 / 60 / 24).toFixed(0)} d` : '—'],
      ]],
      ['Provider SDK', [
        ['Requires client script', c.requiresClientScript],
        ['CDN', c.cdnUrl ?? '—'],
        ['Global', c.globalVariable ?? '—'],
      ]],
      ['UI', [
        ['Provides button', c.providesButton],
        ['Provides icon', c.providesIcon],
        ['BNPL promo widget', c.providesPromoWidget],
        ['Price-tag messaging', c.providesPriceTagMessaging],
        ['Merchant validation', c.requiresDomainVerification],
        ['Capability check', c.requiresMerchantCapabilityCheck],
      ]],
      ['Interactive callbacks', [
        ['Shipping address', c.onShippingAddressChange],
        ['Shipping method', c.onShippingMethodChange],
        ['Coupon', c.onCouponChange],
        ['Payment method', c.onPaymentMethodChange],
      ]],
      ['Async', [
        ['Requires webhook', c.requiresWebhook],
        ['Polling fallback', c.pollingFallback],
        ['Terminal via webhook', c.terminalFromWebhook],
      ]],
      ['Wire', [
        ['Amount transform', c.amountTransform],
        ['chSourceType', this.apm.chSourceType],
        ['chWalletType', this.apm.chWalletType ?? '—'],
        ['chProvider', this.apm.chProvider ?? '—'],
      ]],
    ];
    for (const [title, items] of sections) {
      const s = document.createElement('div');
      s.className = 'capsection';
      s.textContent = title;
      grid.appendChild(s);
      for (const [label, value] of items) {
        const row = document.createElement('div');
        row.className = 'capitem';
        const v = typeof value === 'boolean'
          ? `<span class="capitem__value ${value ? 'is-on' : 'is-off'}">${value ? '✓ yes' : '— no'}</span>`
          : `<span class="capitem__value">${escapeHtml(String(value))}</span>`;
        row.innerHTML = `<span class="capitem__label">${escapeHtml(label)}</span>${v}`;
        grid.appendChild(row);
      }
    }
  }

  // ─── Wire preview pane ─────────────────────────────────────
  renderWirePreview() {
    const amount = parseFloat(this.cache.amount.value || '49.99');
    const currency = this.cache.currency.value || this.apm.currencies[0] || 'USD';
    const merchantOrderId = this.cache.order.value || `harness-${this.apm.id}-${Date.now().toString(36)}`;

    const sessionBody = {
      apm: this.apm.id,
      merchantOrderId,
      amount: { value: amount, currency },
    };

    const orderBody = {
      order: { intent: this.cache.initiator.value === 'MERCHANT' ? 'AUTHORIZE' : 'SALE' },
      paymentSource: {
        sourceType: this.apm.chSourceType,
        ...(this.apm.chWalletType ? { walletType: this.apm.chWalletType } : {}),
      },
      ...(this.apm.chProvider ? { paymentMethod: { provider: this.apm.chProvider } } : {}),
      checkoutInteractions: {
        channel: 'WEB',
        paymentInitiator: this.cache.initiator.value,
        returnUrls: {
          successUrl: 'https://harness.example/return/success',
          cancelUrl: 'https://harness.example/return/cancel',
        },
      },
      transactionDetails: {
        captureFlag: this.cache.initiator.value !== 'MERCHANT',
        merchantOrderId,
      },
      amount: {
        total: Math.round(amount * 100),
        currency,
      },
    };

    document.querySelector('[data-wire-session]').innerHTML = highlightJson(sessionBody);
    document.querySelector('[data-wire-order]').innerHTML = highlightJson(orderBody, {
      highlightPath: ['paymentMethod', 'provider'],
    });
  }

  // ─── State machine pane ────────────────────────────────────
  renderStateMachine() {
    const el = this.smEl;
    el.innerHTML = '';
    STATES.forEach((s, i) => {
      const chip = document.createElement('div');
      chip.className = 'smstate';
      chip.textContent = s;
      if (this.visitedStates.has(s)) chip.classList.add('is-visited');
      if (this.currentState === s) chip.classList.add('is-current');
      if (TERMINAL.has(s)) {
        chip.classList.add('is-terminal');
        if (s === 'failed') chip.classList.add('is-terminal-failed');
        if (s === 'cancelled') chip.classList.add('is-terminal-cancelled');
      }
      el.appendChild(chip);
      if (i < STATES.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'sm-arrow';
        arrow.textContent = '›';
        el.appendChild(arrow);
      }
    });
  }

  // ─── Events pane ───────────────────────────────────────────
  renderEvents() {
    const el = this.eventLogEl;
    if (this.events.length === 0) {
      el.innerHTML = `<div class="log__empty">No events yet. Run a scenario.</div>`;
      return;
    }
    el.innerHTML = '';
    for (const e of this.events) {
      const row = document.createElement('div');
      row.className = 'logrow ' + classifyEvent(e.type);
      const t = new Date(e.ts).toTimeString().slice(0, 8);
      row.innerHTML = `
        <div class="logrow__time">${t}</div>
        <div class="logrow__type">${escapeHtml(e.type)}</div>
        <div class="logrow__data">${escapeHtml(JSON.stringify(e.data))}</div>
      `;
      row.addEventListener('click', () => {
        row.querySelector('.logrow__data').style.whiteSpace =
          row.querySelector('.logrow__data').style.whiteSpace === 'pre-wrap' ? 'nowrap' : 'pre-wrap';
      });
      el.appendChild(row);
    }
  }

  // ─── Network pane ──────────────────────────────────────────
  renderNetwork() {
    const el = this.netLogEl;
    if (netlog.length === 0) {
      el.innerHTML = `<div class="netlog__empty">No requests yet. Run a scenario.</div>`;
      return;
    }
    el.innerHTML = '';
    for (const n of netlog) {
      const row = document.createElement('div');
      row.className = 'netrow ' + (n.ok === false || (n.status && n.status >= 400) ? 'is-err' : n.ok ? 'is-ok' : '');
      row.innerHTML = `
        <div class="netrow__method">${escapeHtml(n.method)}</div>
        <div class="netrow__status">${n.status ?? (n.error ? 'ERR' : '…')}</div>
        <div class="netrow__url">${escapeHtml(n.url)}</div>
        <div class="netrow__dur">${n.durationMs != null ? n.durationMs + ' ms' : '—'}</div>
      `;
      const body = document.createElement('pre');
      body.className = 'netrow__body';
      body.hidden = true;
      body.textContent = JSON.stringify({ req: n.reqBody, resp: n.respBody, error: n.error }, null, 2);
      row.appendChild(body);
      row.addEventListener('click', () => { body.hidden = !body.hidden; });
      el.appendChild(row);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function classifyEvent(type) {
  if (type === 'PAYMENT_COMPLETED') return 'is-terminal';
  if (type === 'PAYMENT_FAILED' || type === 'SCRIPT_LOAD_FAILED' || type === 'AUTH_EXPIRED') return 'is-error';
  if (type === 'PAYMENT_CANCELLED') return 'is-info';
  if (type === 'PAYMENT_PENDING' || type === 'REDIRECT_REQUIRED' || type === 'AWAITING_MERCHANT_CAPTURE') return 'is-pending';
  return 'is-lifecycle';
}

function formatCategory(c) {
  return c.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function highlightJson(obj, { highlightPath } = {}) {
  const json = JSON.stringify(obj, null, 2);
  let html = escapeHtml(json);
  // Highlight "provider": "XXX" when present at paymentMethod.provider
  if (obj?.paymentMethod?.provider) {
    const p = obj.paymentMethod.provider;
    html = html.replace(
      `"provider": "${p}"`,
      `<span class="k">"provider"</span>: <span class="b">"${p}"</span>`
    );
  }
  // Basic syntax highlight
  html = html.replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:');
  html = html.replace(/: "([^"]*)"/g, (m, s) => {
    // Don't re-highlight the provider line we already marked
    if (s === obj?.paymentMethod?.provider) return m;
    return `: <span class="s">"${s}"</span>`;
  });
  html = html.replace(/: (\d+(?:\.\d+)?)/g, ': <span class="n">$1</span>');
  html = html.replace(/: (true|false)/g, ': <span class="b">$1</span>');
  html = html.replace(/: (null)/g, ': <span class="null">$1</span>');
  return html;
}
