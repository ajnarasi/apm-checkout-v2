/**
 * v2.2 harness — Interactive callbacks pane.
 *
 * For each interactive callback declared in the APM's capability matrix,
 * renders:
 *   - An enable/disable toggle
 *   - A payload editor prefilled with a realistic sample
 *   - A "Fire" button that runs the callback round-trip:
 *       provider → adapter → merchant → adapter → provider
 *   - A response log showing the recomputed totals / updated sheet data
 *
 * The round-trip is simulated locally — the harness has no real wallet
 * sheet to push updates back into. The purpose is to validate the
 * merchant's handler logic and surface the canonical payload shapes.
 */

import { escapeHtml } from './catalog.js';
import { registerLiveCallback, getLoadState } from './sdk-loader.js';

const CALLBACK_DEFS = [
  {
    key: 'onShippingAddressChange',
    label: 'Shipping address change',
    description:
      'Fires when the user selects a shipping address in the wallet sheet. The merchant must return an updated total + available shipping methods.',
    samplePayload: {
      countryCode: 'US',
      administrativeArea: 'CA',
      locality: 'San Francisco',
      postalCode: '94105',
    },
    sampleResponse: {
      newTotal: { label: 'Total', amount: '52.99' },
      newLineItems: [
        { label: 'Subtotal', amount: '49.99' },
        { label: 'Shipping (Standard)', amount: '3.00' },
      ],
      newShippingMethods: [
        { identifier: 'standard', label: 'Standard', amount: '3.00', detail: '5-7 days' },
        { identifier: 'express', label: 'Express', amount: '12.00', detail: '1-2 days' },
      ],
    },
  },
  {
    key: 'onShippingMethodChange',
    label: 'Shipping method change',
    description:
      'Fires when the user picks a shipping method. The merchant must return a new total reflecting the selected method.',
    samplePayload: { identifier: 'express', amount: '12.00' },
    sampleResponse: {
      newTotal: { label: 'Total', amount: '61.99' },
      newLineItems: [
        { label: 'Subtotal', amount: '49.99' },
        { label: 'Shipping (Express)', amount: '12.00' },
      ],
    },
  },
  {
    key: 'onCouponChange',
    label: 'Coupon code change',
    description:
      'Fires when the user applies or removes a coupon. The merchant validates the code and returns a discount line.',
    samplePayload: { code: 'SAVE10' },
    sampleResponse: {
      newTotal: { label: 'Total', amount: '44.99' },
      newLineItems: [
        { label: 'Subtotal', amount: '49.99' },
        { label: 'Coupon SAVE10', amount: '-5.00' },
      ],
    },
  },
  {
    key: 'onPaymentMethodChange',
    label: 'Payment method change',
    description:
      'Fires on native wallets when the user switches the payment card/funding source mid-sheet.',
    samplePayload: { type: 'debit', displayName: 'Visa •••• 4242' },
    sampleResponse: {
      newTotal: { label: 'Total', amount: '49.99' },
      newLineItems: [{ label: 'Subtotal', amount: '49.99' }],
    },
  },
];

export class CallbacksPane {
  constructor({ rootEl, onFire }) {
    this.root = rootEl;
    this.onFire = onFire;
    this.apm = null;
    // apm-scoped config: { [callbackKey]: { enabled, payload, response, lastRun } }
    this.state = new Map();
  }

  load(apm) {
    this.apm = apm;
    if (!this.state.has(apm.id)) {
      const perCbState = {};
      for (const def of CALLBACK_DEFS) {
        perCbState[def.key] = {
          enabled: !!apm.capabilities[def.key],
          payload: JSON.stringify(def.samplePayload, null, 2),
          response: JSON.stringify(def.sampleResponse, null, 2),
          lastRun: null,
        };
      }
      this.state.set(apm.id, perCbState);
    }
    this.render();
  }

  render() {
    if (!this.apm) return;
    const perCbState = this.state.get(this.apm.id);
    const caps = this.apm.capabilities;
    this.root.innerHTML = '';

    // SDK load status — are we wired to a real live button?
    const sdkState = getLoadState(this.apm.id);
    const liveWired = sdkState.status === 'loaded';

    // Summary header
    const summary = document.createElement('div');
    summary.className = 'cb-summary';
    const activeCount = CALLBACK_DEFS.filter((d) => caps[d.key]).length;
    summary.innerHTML = `
      <div class="kicker">Interactive callbacks</div>
      <h3>${escapeHtml(this.apm.displayName)} supports ${activeCount} of ${CALLBACK_DEFS.length} interactive callbacks</h3>
      <p class="muted">
        Each callback is a bi-directional RPC between the wallet sheet and the
        merchant. When the user interacts with the sheet (picks an address,
        applies a coupon), the provider fires the callback; the merchant
        responds with a recomputed total; the sheet re-renders.
      </p>
      <div class="cb-live-banner ${liveWired ? 'is-live' : 'is-offline'}">
        ${liveWired
          ? `<span class="cb-live-banner__dot"></span>
             <strong>Live wiring active.</strong> The ${escapeHtml(this.apm.displayName)} SDK is loaded — your response handlers below are registered as real callbacks on the live button in the <em>SDK</em> tab. Click the button over there and interact with the provider sheet to exercise the real round-trip.`
          : `<span class="cb-live-banner__dot"></span>
             <strong>Simulator mode.</strong> Load the ${escapeHtml(this.apm.displayName)} SDK from the <em>SDK</em> tab to wire these handlers into the real provider button. Fires below use a local round-trip instead.`}
      </div>
    `;
    this.root.appendChild(summary);

    // Register every edited response as a live callback handler so the
    // provider button fires them as soon as the SDK is loaded.
    for (const def of CALLBACK_DEFS) {
      if (!caps[def.key]) continue;
      registerLiveCallback(this.apm.id, def.key, (data) => {
        try {
          return { response: JSON.parse(perCbState[def.key].response), data };
        } catch (err) {
          return { reject: true, error: String(err?.message ?? err) };
        }
      });
    }

    for (const def of CALLBACK_DEFS) {
      const supported = !!caps[def.key];
      const s = perCbState[def.key];
      const card = document.createElement('div');
      card.className = 'cb-card' + (supported ? '' : ' cb-card--disabled');
      card.innerHTML = `
        <header class="cb-card__head">
          <div>
            <h4>${escapeHtml(def.label)}</h4>
            <div class="cb-card__key"><code>${def.key}</code></div>
          </div>
          <label class="toggle" title="${supported ? 'Enable/disable this callback' : 'Not supported by this APM'}">
            <input type="checkbox" ${supported ? '' : 'disabled'} ${s.enabled && supported ? 'checked' : ''} data-cb-enable="${def.key}" />
            <span class="toggle__slider"></span>
          </label>
        </header>
        <p class="cb-card__desc muted">${escapeHtml(def.description)}</p>

        <div class="cb-card__grid">
          <div class="cb-card__col">
            <div class="kicker">Payload from provider</div>
            <textarea class="cb-editor" data-cb-payload="${def.key}" spellcheck="false" ${supported ? '' : 'disabled'}>${escapeHtml(s.payload)}</textarea>
          </div>
          <div class="cb-card__col">
            <div class="kicker">Merchant response</div>
            <textarea class="cb-editor" data-cb-response="${def.key}" spellcheck="false" ${supported ? '' : 'disabled'}>${escapeHtml(s.response)}</textarea>
          </div>
        </div>

        <footer class="cb-card__foot">
          <button class="btn btn--outline" data-cb-fire="${def.key}" ${supported ? '' : 'disabled'} type="button">▶ Fire round-trip</button>
          <span class="cb-card__last">${s.lastRun ? `Last: ${s.lastRun.result} · ${s.lastRun.durationMs} ms` : 'Not yet fired'}</span>
        </footer>
      `;
      this.root.appendChild(card);
    }

    // Wire events
    this.root.querySelectorAll('[data-cb-enable]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        perCbState[cb.dataset.cbEnable].enabled = e.target.checked;
      });
    });
    this.root.querySelectorAll('[data-cb-payload]').forEach((ta) => {
      ta.addEventListener('input', () => { perCbState[ta.dataset.cbPayload].payload = ta.value; });
    });
    this.root.querySelectorAll('[data-cb-response]').forEach((ta) => {
      ta.addEventListener('input', () => { perCbState[ta.dataset.cbResponse].response = ta.value; });
    });
    this.root.querySelectorAll('[data-cb-fire]').forEach((btn) => {
      btn.addEventListener('click', () => this.fire(btn.dataset.cbFire));
    });
  }

  async fire(key) {
    const perCb = this.state.get(this.apm.id)[key];
    const startedAt = performance.now();

    // Parse payload + response to validate JSON
    let payload, response;
    try {
      payload = JSON.parse(perCb.payload);
      response = JSON.parse(perCb.response);
    } catch (err) {
      perCb.lastRun = { result: 'JSON error', durationMs: 0 };
      this.render();
      return;
    }

    // Emit a round-trip trace event — inspector picks this up
    const trace = [
      { step: 'provider.fire', payload },
      { step: 'adapter.receive', payload },
      { step: 'merchant.handle', payload, response },
      { step: 'adapter.forward', response },
      { step: 'provider.update', response },
    ];
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 60));

    perCb.lastRun = {
      result: 'ok',
      durationMs: Math.round(performance.now() - startedAt),
    };
    this.render();
    if (this.onFire) this.onFire({ key, payload, response, trace, apm: this.apm.id });
  }
}
