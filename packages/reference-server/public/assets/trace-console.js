/**
 * Trace console — the "Plaid-style" demo surface.
 *
 * Renders inside the Trace tab of the inspector:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Eligibility bar:                                              │
 *   │  Country · Currency · Amount · Capture mode · APM · Scenario │
 *   │                          [▶ Run] [Persona: Dev ▾]            │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ 6-lane SVG (LiveTrace) │ JSON inspector (stream of events)   │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │ Read-only scenario script (TS-ish snippet)                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The actual 6-lane SVG is rendered by `live-trace.js` into a sibling
 * node. This module owns the eligibility bar, the Run button, the
 * inspector stream, and the persona toggle. When the user hits Run,
 * it asks `inspector.js` (via the `onRunScenario` callback) to replay
 * the scripted scenario events into the LiveTrace event bus.
 *
 * Persona toggle flips three body classes:
 *   .persona-leadership  — hide JSON, show plain-English captions only
 *   .persona-dev         — SDK snippet visible, JSON collapsed
 *   .persona-engineer    — JSON auto-expanded, timing + copy-as-curl
 *
 * Eligibility filter reuses `capabilities-lookup.js` to derive the
 * eligible APM list from (country, currency, captureMode) — no 70-button
 * wall, matching Checkout.com Flow Demo's pattern.
 */

import { escapeHtml } from './catalog.js';
import { getEligibleApms, uniqueCountries, uniqueCurrencies } from './capabilities-lookup.js';
import { buildScenariosForApm } from './trace-scenarios.js';

const PERSONA_DEFAULT = 'dev';

export class TraceConsole {
  constructor({ rootEl, inspectorEl, snippetEl, getApm, getAllApms, onRunScenario }) {
    this.root = rootEl;
    this.inspectorEl = inspectorEl;
    this.snippetEl = snippetEl;
    this.getApm = getApm;
    this.getAllApms = getAllApms;
    this.onRunScenario = onRunScenario;
    this.state = {
      country: 'NL',
      currency: 'EUR',
      amount: 49.99,
      captureMode: 'GATEWAY',
      apmId: null,
      scenarioId: 'sync_sale_ok',
      persona: PERSONA_DEFAULT,
    };
    this.rowsFired = [];
    document.body.classList.add('persona-' + this.state.persona);
  }

  /**
   * Re-render the console when a new APM is loaded from the catalog.
   * Seeds eligibility fields from the APM's first country/currency so
   * the filter starts in a consistent place.
   */
  resetForApm() {
    const apm = this.getApm();
    if (apm) {
      if (apm.countries?.length && !apm.countries.includes(this.state.country)) {
        this.state.country = apm.countries[0];
      }
      if (apm.currencies?.length && !apm.currencies.includes(this.state.currency)) {
        this.state.currency = apm.currencies[0];
      }
      this.state.apmId = apm.id;
      this.state.scenarioId = 'sync_sale_ok';
    }
    this.rowsFired = [];
    this.render();
    this.renderInspector();
    this.renderSnippet();
  }

  clearInspector() {
    this.rowsFired = [];
    this.renderInspector();
  }

  /**
   * Called per event by inspector.js as it fires the scripted scenario
   * into live-trace. We just append a row to the inspector pane — the
   * SVG animation is handled by live-trace.js.
   */
  pushRow(ev) {
    this.rowsFired.push(ev);
    this.renderInspector();
  }

  render() {
    if (!this.root) return;
    const catalog = this.getAllApms?.() ?? [];
    const eligible = getEligibleApms({
      country: this.state.country,
      currency: this.state.currency,
      captureMode: this.state.captureMode,
      catalog,
    });
    const countries = catalog.length ? uniqueCountries(catalog) : ['NL', 'US', 'BR', 'JP'];
    const currencies = catalog.length ? uniqueCurrencies(catalog) : ['EUR', 'USD', 'BRL', 'JPY'];

    // If the currently selected APM isn't in the eligible set, default to
    // the first eligible one.
    if (!eligible.find((a) => a.id === this.state.apmId)) {
      this.state.apmId = eligible[0]?.id ?? null;
    }
    const selectedApm = catalog.find((a) => a.id === this.state.apmId);
    const scenarios = selectedApm ? buildScenariosForApm(selectedApm, {
      amount: this.state.amount,
      currency: this.state.currency,
      country: this.state.country,
    }) : {};
    const scenarioList = Object.values(scenarios);
    if (!scenarios[this.state.scenarioId]) {
      this.state.scenarioId = scenarioList[0]?.id ?? 'sync_sale_ok';
    }

    this.root.innerHTML = `
      <div class="tcon__bar">
        <div class="tcon__bar-kicker">
          <span class="kicker">Live API trace · scenario console</span>
          <span class="tcon__eligible-count">${eligible.length} eligible APMs</span>
        </div>
        <div class="tcon__grid">
          <label class="field field--compact">
            <span class="field__label">Country</span>
            <select data-tcon-country>
              ${countries.map((c) => `<option value="${c}" ${c === this.state.country ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label class="field field--compact">
            <span class="field__label">Currency</span>
            <select data-tcon-currency>
              ${currencies.map((c) => `<option value="${c}" ${c === this.state.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label class="field field--compact">
            <span class="field__label">Amount</span>
            <input type="number" step="0.01" min="0.01" value="${this.state.amount}" data-tcon-amount />
          </label>
          <label class="field field--compact">
            <span class="field__label">Capture mode</span>
            <select data-tcon-capture>
              <option value="GATEWAY" ${this.state.captureMode === 'GATEWAY' ? 'selected' : ''}>Gateway (sale)</option>
              <option value="MERCHANT" ${this.state.captureMode === 'MERCHANT' ? 'selected' : ''}>Merchant (auth + capture)</option>
            </select>
          </label>
          <label class="field field--compact field--apm">
            <span class="field__label">APM (${eligible.length})</span>
            <select data-tcon-apm ${eligible.length === 0 ? 'disabled' : ''}>
              ${eligible.length === 0
                ? '<option>None eligible for this combo</option>'
                : eligible.map((a) => `<option value="${a}" ${a.id === this.state.apmId ? 'selected' : ''} data-id="${a.id}">${escapeHtml(a.displayName)} · ${a.pattern}</option>`)
                    .map((s) => s.replace(`value="${eligible.find((e) => `${e}` === s.match(/value="([^"]+)"/)?.[1])?.id}"`, (m) => m))
                    .join('')}
            </select>
          </label>
          <label class="field field--compact field--scenario">
            <span class="field__label">Scenario</span>
            <select data-tcon-scenario ${scenarioList.length === 0 ? 'disabled' : ''}>
              ${scenarioList.map((s) => `<option value="${s.id}" ${s.id === this.state.scenarioId ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="tcon__actions">
          <button type="button" class="btn btn--primary btn--lg" data-tcon-run ${!selectedApm || scenarioList.length === 0 ? 'disabled' : ''}>
            ▶ Run scenario
          </button>
          <div class="tcon__persona" role="tablist" aria-label="Persona view">
            ${['leadership', 'dev', 'engineer'].map((p) => `
              <button type="button"
                      class="tcon__persona-btn ${this.state.persona === p ? 'is-active' : ''}"
                      data-tcon-persona="${p}"
                      role="tab"
                      aria-selected="${this.state.persona === p}">${p[0].toUpperCase() + p.slice(1)}</button>
            `).join('')}
          </div>
        </div>
        ${selectedApm ? `
          <div class="tcon__scenario-desc">
            <strong>${escapeHtml(scenarios[this.state.scenarioId]?.title ?? '')}</strong>
            — ${escapeHtml(scenarios[this.state.scenarioId]?.description ?? '')}
          </div>
        ` : ''}
      </div>
    `;

    // The native <select> renderer above has a bug — I'm emitting option
    // values as JSON-stringified objects. Fix by re-populating APM select
    // cleanly here.
    const apmSel = this.root.querySelector('[data-tcon-apm]');
    if (apmSel && eligible.length > 0) {
      apmSel.innerHTML = eligible
        .map((a) => `<option value="${a.id}" ${a.id === this.state.apmId ? 'selected' : ''}>${escapeHtml(a.displayName)} · ${a.pattern}</option>`)
        .join('');
    }

    // Wire events
    this.root.querySelector('[data-tcon-country]')?.addEventListener('change', (e) => {
      this.state.country = e.target.value; this.render(); this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-currency]')?.addEventListener('change', (e) => {
      this.state.currency = e.target.value; this.render(); this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-amount]')?.addEventListener('change', (e) => {
      this.state.amount = parseFloat(e.target.value) || 49.99; this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-capture]')?.addEventListener('change', (e) => {
      this.state.captureMode = e.target.value; this.render(); this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-apm]')?.addEventListener('change', (e) => {
      this.state.apmId = e.target.value; this.render(); this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-scenario]')?.addEventListener('change', (e) => {
      this.state.scenarioId = e.target.value; this.render(); this.renderSnippet();
    });
    this.root.querySelector('[data-tcon-run]')?.addEventListener('click', () => this.run());
    this.root.querySelectorAll('[data-tcon-persona]').forEach((btn) => {
      btn.addEventListener('click', () => this.setPersona(btn.dataset.tconPersona));
    });
  }

  run() {
    const apm = this.getAllApms().find((a) => a.id === this.state.apmId);
    if (!apm) return;
    const scenarios = buildScenariosForApm(apm, {
      amount: this.state.amount,
      currency: this.state.currency,
      country: this.state.country,
    });
    const scenario = scenarios[this.state.scenarioId];
    if (!scenario) return;
    this.rowsFired = [];
    this.renderInspector();
    this.onRunScenario?.({ scenarioId: scenario.id, events: scenario.events });
  }

  setPersona(p) {
    if (!['leadership', 'dev', 'engineer'].includes(p)) return;
    document.body.classList.remove('persona-leadership', 'persona-dev', 'persona-engineer');
    document.body.classList.add('persona-' + p);
    this.state.persona = p;
    this.render();
    this.renderInspector();
    this.renderSnippet();
  }

  renderInspector() {
    if (!this.inspectorEl) return;
    if (this.rowsFired.length === 0) {
      this.inspectorEl.innerHTML = `<div class="log__empty">Run a scenario to see the request / response stream here.</div>`;
      return;
    }
    const engineer = this.state.persona === 'engineer';
    const leadership = this.state.persona === 'leadership';
    this.inspectorEl.innerHTML = `
      <div class="tcon__rows">
        ${this.rowsFired.map((ev, idx) => {
          const statusClass = ev.status === 'ERR' ? 'is-err' : ev.status === 'PENDING' ? 'is-pending' : 'is-ok';
          const req = ev.requestBody ? JSON.stringify(ev.requestBody, null, 2) : null;
          const resp = ev.responseBody ? JSON.stringify(ev.responseBody, null, 2) : null;
          return `
            <details class="tcon__row ${statusClass}" ${engineer && (req || resp) ? 'open' : ''}>
              <summary>
                <span class="tcon__row-num">${String(idx + 1).padStart(2, '0')}</span>
                <span class="tcon__row-arrow">${escapeHtml(ev.from)} → ${escapeHtml(ev.to)}</span>
                <span class="tcon__row-label">${escapeHtml(ev.label)}</span>
                <span class="tcon__row-status">${escapeHtml(ev.status ?? 'OK')}</span>
              </summary>
              ${leadership
                ? `<div class="tcon__row-caption">${escapeHtml(ev.caption ?? '')}</div>`
                : `
                  ${ev.caption ? `<div class="tcon__row-caption">${escapeHtml(ev.caption)}</div>` : ''}
                  ${req ? `<div class="tcon__row-side"><div class="kicker">Request body</div><pre class="code-block">${escapeHtml(req)}</pre></div>` : ''}
                  ${resp ? `<div class="tcon__row-side"><div class="kicker">Response body</div><pre class="code-block">${escapeHtml(resp)}</pre></div>` : ''}
                  ${engineer && (req || resp) ? `<button type="button" class="btn btn--ghost btn--xs" data-tcon-curl="${idx}">copy as curl</button>` : ''}
                `}
            </details>
          `;
        }).join('')}
      </div>
    `;
    this.inspectorEl.querySelectorAll('[data-tcon-curl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ev = this.rowsFired[parseInt(btn.dataset.tconCurl, 10)];
        const body = ev?.requestBody ?? ev?.responseBody ?? {};
        const curl = `curl -X POST https://cert.api.firstdata.com${ev.label.replace(/^POST\s+/, '')} \\\n` +
          `  -H 'Api-Key: $CH_API_KEY' \\\n` +
          `  -H 'Authorization: Bearer $CH_ACCESS_TOKEN' \\\n` +
          `  -H 'Content-Type: application/json' \\\n` +
          `  -d '${JSON.stringify(body)}'`;
        navigator.clipboard?.writeText(curl);
        btn.textContent = '✓ copied';
        setTimeout(() => { btn.textContent = 'copy as curl'; }, 1500);
      });
    });
  }

  renderSnippet() {
    if (!this.snippetEl) return;
    const apm = this.getAllApms?.().find((a) => a.id === this.state.apmId);
    if (!apm) {
      this.snippetEl.hidden = true;
      return;
    }
    // Show in dev + engineer, hide in leadership (collapsed state).
    this.snippetEl.hidden = this.state.persona === 'leadership';
    this.snippetEl.textContent = `// v2.2 SDK — ${apm.displayName} sample call
import { createCheckout } from '@fiserv/apm-checkout-sdk-v2';

const checkout = await createCheckout({
  apm: '${apm.id}',
  amount: { total: ${this.state.amount}, currency: '${this.state.currency}' },
  country: '${this.state.country}',
  paymentInitiator: '${this.state.captureMode}',  // GATEWAY or MERCHANT
  credentials: { accessToken }, // minted server-side via /payments-vas/v1/security/credentials
});

checkout.on('PAYMENT_COMPLETED', (e) => console.log('done', e));
checkout.on('PAYMENT_FAILED',    (e) => console.error('failed', e));
await checkout.authorize();`;
  }
}
