/**
 * v2.2 harness — Docs mode.
 *
 * Renders the top-level Docs section with 4 nav groups:
 *   1. Architecture & workflows (sync / async / merchant-capture / state machine + adapter hierarchy)
 *   2. 5 audience views (executive / stakeholder / engineering / PM / QA)
 *   3. Implementation guide (12 steps)
 *   4. Technical diagrams (all 6 Mermaid diagrams)
 *
 * Mermaid is loaded lazily from the CDN when Docs mode is first activated.
 * The animated adapter hierarchy binds to the live APM catalog so clicking
 * a base class filters the child chips to APMs that use that base.
 */

import { AUDIENCE_VIEWS, IMPLEMENTATION_STEPS, MERMAID_DIAGRAMS, HERO_COOKBOOKS, WHY_ARCHITECTURE } from './docs-content.js';
import { APM_REQUIREMENTS, REQUIREMENTS_STATS, getApmRequirements, PATTERN_COLORS } from './apm-requirements.js';
import { renderStateMachineViz } from './state-machine-viz.js';
import { escapeHtml } from './catalog.js';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

let mermaidLoaderPromise = null;

async function loadMermaid() {
  if (mermaidLoaderPromise) return mermaidLoaderPromise;
  mermaidLoaderPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ MERMAID_CDN);
      const mermaid = mod.default ?? mod;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#ff6a13',
          primaryTextColor: '#fafafa',
          primaryBorderColor: '#ff6a13',
          lineColor: '#ff6a13',
          secondaryColor: '#1c1c20',
          tertiaryColor: '#13131a',
          background: '#0b0b0f',
          mainBkg: '#1c1c20',
          secondBkg: '#13131a',
          textColor: '#e8e8e8',
          fontFamily: 'Inter, system-ui, sans-serif',
        },
        securityLevel: 'loose',
        flowchart: { htmlLabels: true, curve: 'basis' },
        sequence: { showSequenceNumbers: true, mirrorActors: false },
      });
      return mermaid;
    } catch (err) {
      console.error('[docs] mermaid failed to load', err);
      throw err;
    }
  })();
  return mermaidLoaderPromise;
}

// Adapter → base class lookup derived from the pattern field.
const PATTERN_TO_BASE = {
  redirect: 'RedirectBase',
  tokenization: 'TokenizationBase',
  'native-wallet': 'NativeWalletBase',
  'button-sdk': 'ButtonSdkBase',
  qr: 'QrBase',
  voucher: 'VoucherBase',
};

const BASE_CLASSES = [
  { id: 'RedirectBase',     title: 'RedirectBase',      pattern: 'redirect' },
  { id: 'TokenizationBase', title: 'TokenizationBase',  pattern: 'tokenization' },
  { id: 'NativeWalletBase', title: 'NativeWalletBase',  pattern: 'native-wallet' },
  { id: 'ButtonSdkBase',    title: 'ButtonSdkBase',     pattern: 'button-sdk' },
  { id: 'QrBase',           title: 'QrBase',            pattern: 'qr' },
  { id: 'VoucherBase',      title: 'VoucherBase',       pattern: 'voucher' },
];

export class DocsView {
  constructor({ rootEl, catalogEntries }) {
    this.root = rootEl;
    this.catalog = catalogEntries;
    this.activeKey = 'architecture';
    this.activeBase = 'RedirectBase';
    this.mermaidRendered = new Set();
  }

  async activate() {
    if (!this.root.dataset.built) {
      this.build();
      this.root.dataset.built = '1';
    }
    // Trigger initial render for the current section
    await this.renderSection(this.activeKey);
  }

  build() {
    this.root.innerHTML = `
      <div class="docs-layout">
        <aside class="docs-nav" aria-label="Docs navigation">
          <div class="docs-nav__group">Why this architecture</div>
          <button class="docs-nav__link is-active" data-section="why-overview" type="button">The "why" — 6 design decisions</button>
          ${WHY_ARCHITECTURE.map((w) => `<button class="docs-nav__link" data-section="why:${w.id}" type="button">${escapeHtml(w.title)}</button>`).join('')}

          <div class="docs-nav__group">Architecture &amp; workflows</div>
          <button class="docs-nav__link" data-section="architecture" type="button">Overview &amp; adapter hierarchy</button>
          <button class="docs-nav__link" data-section="sequence-sync" type="button">Sync sale flow (+ Credentials)</button>
          <button class="docs-nav__link" data-section="sequence-async" type="button">Async webhook flow (+ Credentials)</button>
          <button class="docs-nav__link" data-section="sequence-capture" type="button">Merchant capture flow (+ Credentials)</button>

          <div class="docs-nav__group">Audience views</div>
          <button class="docs-nav__link" data-section="executive" type="button">Executive (30k ft)</button>
          <button class="docs-nav__link" data-section="stakeholder" type="button">Stakeholder (20k ft)</button>
          <button class="docs-nav__link" data-section="engineering" type="button">Engineering (10k ft)</button>
          <button class="docs-nav__link" data-section="productManager" type="button">Product manager</button>
          <button class="docs-nav__link" data-section="qa" type="button">QA playbook</button>

          <div class="docs-nav__group">Implementation</div>
          <button class="docs-nav__link" data-section="impl-guide" type="button">14-step guide with code</button>

          <div class="docs-nav__group">APM Requirements (70)</div>
          <button class="docs-nav__link" data-section="requirements-overview" type="button">All 70 APMs — filterable grid</button>
          <button class="docs-nav__link" data-section="capability-matrix" type="button">Capability matrix (70 × 12 cols)</button>

          <div class="docs-nav__group">APM Cookbooks</div>
          ${HERO_COOKBOOKS.map((c) => `<button class="docs-nav__link" data-section="cookbook:${c.apm}" type="button">${escapeHtml(c.displayName)}</button>`).join('')}

          <div class="docs-nav__group">Technical diagrams</div>
          <button class="docs-nav__link" data-section="diagram-state" type="button">State machine</button>
          <button class="docs-nav__link" data-section="diagram-class" type="button">Class hierarchy</button>
          <button class="docs-nav__link" data-section="diagram-adapters" type="button">Adapter graph</button>
        </aside>

        <main class="docs-main" data-docs-main>
          <div class="log__empty">Loading…</div>
        </main>
      </div>
    `;
    this.activeKey = 'why-overview';
    for (const btn of this.root.querySelectorAll('[data-section]')) {
      btn.addEventListener('click', () => this.switchTo(btn.dataset.section));
    }
  }

  async switchTo(key) {
    this.activeKey = key;
    for (const btn of this.root.querySelectorAll('[data-section]')) {
      btn.classList.toggle('is-active', btn.dataset.section === key);
    }
    await this.renderSection(key);
    // Scroll main to top
    this.root.querySelector('[data-docs-main]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async renderSection(key) {
    const main = this.root.querySelector('[data-docs-main]');
    if (!main) return;

    // ─── Why this architecture: overview (6 cards) ───
    if (key === 'why-overview') {
      main.innerHTML = `
        <div class="kicker">Why this architecture</div>
        <h1>Six design decisions, explained</h1>
        <div class="docs-tldr">v2.2 makes six specific architectural choices that look expensive at first glance and pay for themselves within the first production incident. Each card pairs the problem the naïve approach creates with the v2.2 solution and cites the evidence in the codebase.</div>
        <div class="why-grid">
          ${WHY_ARCHITECTURE.map((w) => `
            <article class="why-card" data-why-id="${w.id}">
              <header class="why-card__head">
                <h3>${escapeHtml(w.title)}</h3>
              </header>
              <section class="why-card__problem">
                <div class="kicker">Problem</div>
                ${w.problem}
              </section>
              <section class="why-card__solution">
                <div class="kicker">v2.2 solution</div>
                ${w.solution}
              </section>
              <footer class="why-card__evidence">
                <div class="kicker">Evidence</div>
                <ul>${w.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
              </footer>
            </article>
          `).join('')}
        </div>
      `;
      return;
    }

    // ─── Why this architecture: single card ───
    if (key.startsWith('why:')) {
      const id = key.slice(4);
      const w = WHY_ARCHITECTURE.find((x) => x.id === id);
      if (w) {
        main.innerHTML = `
          <div class="kicker">Why this architecture</div>
          <h1>${escapeHtml(w.title)}</h1>
          <div class="docs-tldr">Understand the trade-off in one card. Problem → v2.2 solution → evidence.</div>
          <article class="why-card why-card--full">
            <section class="why-card__problem">
              <div class="kicker">Problem</div>
              ${w.problem}
            </section>
            <section class="why-card__solution">
              <div class="kicker">v2.2 solution</div>
              ${w.solution}
            </section>
            <footer class="why-card__evidence">
              <div class="kicker">Evidence</div>
              <ul>${w.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
            </footer>
          </article>
        `;
        return;
      }
    }

    // ─── Capability Matrix: full-width 70 × 12 columns ───
    if (key === 'capability-matrix') {
      const rows = APM_REQUIREMENTS.map((r) => {
        // Derive boolean cells from requirements + serverParams heuristics
        const hasRedirect = r.returnUrlRequired;
        const hasWebhook = r.webhookRequired;
        const isBNPL = r.pattern === 'tokenization';
        const isWallet = r.pattern === 'native-wallet';
        const isButtonSdk = r.pattern === 'button-sdk';
        return {
          displayName: r.displayName,
          apm: r.apm,
          pattern: r.pattern,
          routing: r.routingChain,
          cells: {
            sale: true,
            auth: isWallet || isButtonSdk || isBNPL,
            capture: isWallet || isButtonSdk || isBNPL,
            partial: isWallet || isButtonSdk || isBNPL,
            void: !hasWebhook,
            refund: true,
            webhook: hasWebhook,
            promo: isBNPL,
            ship: isWallet || r.apm === 'paypal' || r.apm === 'paypal_paylater',
            method: isWallet || r.apm === 'paypal' || r.apm === 'paypal_paylater',
            coupon: r.apm === 'applepay',
            paym: isWallet,
          },
        };
      });
      main.innerHTML = `
        <div class="kicker">Capability matrix</div>
        <h1>70 APMs · 12 capability columns</h1>
        <div class="docs-tldr">Full-width matrix of every APM against every capability. Scroll horizontally if needed — the header row is sticky so you never lose column context. Click any APM name to jump to its full requirements detail.</div>
        <div class="capmat">
          <div class="capmat__wrap">
            <table class="capmat__table">
              <thead>
                <tr>
                  <th class="capmat__apm-head">APM</th>
                  <th title="Gateway-initiated sale (auth+capture)">Sale</th>
                  <th title="Merchant-initiated auth-only">Auth</th>
                  <th title="Separate capture after auth">Capture</th>
                  <th title="Partial capture">Partial</th>
                  <th title="Void before settlement">Void</th>
                  <th title="Refund after capture">Refund</th>
                  <th title="Async webhook required">Webhook</th>
                  <th title="BNPL promo widget (Pay in 4, etc)">Promo</th>
                  <th title="onShippingAddressChange">Ship</th>
                  <th title="onShippingMethodChange">Method</th>
                  <th title="onCouponChange (Apple Pay iOS 16+)">Coupon</th>
                  <th title="onPaymentMethodChange (native wallets)">PayM</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((r) => `
                  <tr data-capmat-apm="${escapeHtml(r.apm)}">
                    <td class="capmat__apm">
                      <strong>${escapeHtml(r.displayName)}</strong>
                      <small>${escapeHtml(r.apm)} · ${escapeHtml(r.pattern)}</small>
                    </td>
                    ${Object.entries(r.cells).map(([k, on]) => `
                      <td class="capmat__cell ${on ? 'is-on' : 'is-off'}">${on ? '●' : '—'}</td>
                    `).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
      main.querySelectorAll('[data-capmat-apm]').forEach((row) => {
        row.addEventListener('click', () => this.switchTo(`requirements:${row.dataset.capmatApm}`));
      });
      return;
    }

    // ─── APM Requirements Catalog: filterable grid (all 70) ───
    if (key === 'requirements-overview') {
      main.innerHTML = `
        <div class="kicker">APM Requirements Catalog</div>
        <h1>What every APM actually needs</h1>
        <div class="docs-tldr">All ${REQUIREMENTS_STATS.total} APMs (${REQUIREMENTS_STATS.ppro} PPRO-routed + ${REQUIREMENTS_STATS.direct} direct). Each card shows exactly what the browser SDK must collect, what the merchant backend must send to Commerce Hub, and the wire mapping rules. Use the filters to narrow by pattern.</div>

        <div class="reqcat__filters" data-reqcat-filters>
          <button class="chip is-on" data-reqcat-pattern="" type="button">All (${APM_REQUIREMENTS.length})</button>
          ${Object.entries(REQUIREMENTS_STATS.byPattern).sort().map(([p, n]) => `
            <button class="chip" data-reqcat-pattern="${escapeHtml(p)}" type="button">${escapeHtml(p)} (${n})</button>
          `).join('')}
          <button class="chip chip--toggle" data-reqcat-routed="ppro" type="button">PPRO-routed</button>
          <button class="chip chip--toggle" data-reqcat-routed="direct" type="button">Direct</button>
        </div>

        <div class="reqcat__grid" data-reqcat-grid>
          ${APM_REQUIREMENTS.map((r) => this.renderRequirementsCard(r)).join('')}
        </div>
      `;
      this.wireRequirementsFilters(main);
      return;
    }

    if (key.startsWith('requirements:')) {
      const apmId = key.slice('requirements:'.length);
      const r = getApmRequirements(apmId);
      if (r) {
        main.innerHTML = `
          <div class="kicker">APM Requirements · ${escapeHtml(r.pattern)}</div>
          <h1>${escapeHtml(r.displayName)}</h1>
          <div class="docs-audience">
            <span class="docs-audience__chip"><strong>id:</strong> ${escapeHtml(r.apm)}</span>
            <span class="docs-audience__chip"><strong>routing:</strong> ${escapeHtml(r.routingChain)}</span>
            <span class="docs-audience__chip"><strong>amount:</strong> ${escapeHtml(r.amountTransform)}</span>
          </div>
          <div class="docs-tldr">Full parameter contract for ${escapeHtml(r.displayName)}. Client params (browser SDK collects) + Server params (merchant backend sends to CH).</div>

          <h3>Client-side parameters</h3>
          <p class="muted">What the browser SDK / merchant frontend must collect before calling <code>POST /v2/sessions</code> and <code>POST /v2/orders/${r.apm}</code>.</p>
          <div class="reqcat__param-table"><table>
            <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Example</th><th>Description</th></tr></thead>
            <tbody>
              ${r.clientParams.map((p) => `
                <tr>
                  <td><code>${escapeHtml(p.name)}</code></td>
                  <td><code>${escapeHtml(p.type)}</code></td>
                  <td>${p.required ? '<strong>required</strong>' : 'optional'}</td>
                  <td><code>${escapeHtml(p.example)}</code></td>
                  <td>${escapeHtml(p.description)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>

          <h3>Server-side parameters</h3>
          <p class="muted">What the merchant backend must set on the <code>POST /checkouts/v1/orders</code> call to Commerce Hub.</p>
          <div class="reqcat__param-table"><table>
            <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Example</th><th>Description</th></tr></thead>
            <tbody>
              ${r.serverParams.map((p) => `
                <tr>
                  <td><code>${escapeHtml(p.name)}</code></td>
                  <td><code>${escapeHtml(p.type)}</code></td>
                  <td>${p.required ? '<strong>required</strong>' : 'optional'}</td>
                  <td><code>${escapeHtml(p.example)}</code></td>
                  <td>${escapeHtml(p.description)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>

          <h3>Async settlement &amp; URLs</h3>
          <ul>
            <li><strong>Webhook required:</strong> ${r.webhookRequired ? 'YES — CH will POST to <code>/v2/webhooks/:provider</code> on settlement' : 'No — this APM settles inline on the CH response'}</li>
            <li><strong>Return URLs required:</strong> ${r.returnUrlRequired ? 'YES — both <code>successUrl</code> and <code>cancelUrl</code>' : 'No'}</li>
            <li><strong>Token TTL:</strong> ${r.tokenTTLMs != null ? `${Math.round(r.tokenTTLMs / 1000)} s (${(r.tokenTTLMs / 60000).toFixed(1)} min)` : 'N/A for this pattern'}</li>
            <li><strong>Currencies:</strong> ${r.currencies.join(', ')}</li>
            <li><strong>Countries:</strong> ${r.countries.join(', ')}</li>
          </ul>

          <h3>Special notes</h3>
          <ul>
            ${r.specialNotes.map((n) => `<li>${n}</li>`).join('')}
          </ul>
        `;
        return;
      }
    }

    // ─── APM Cookbook: single hero ───
    if (key.startsWith('cookbook:')) {
      const apm = key.slice('cookbook:'.length);
      const c = HERO_COOKBOOKS.find((x) => x.apm === apm);
      if (c) {
        main.innerHTML = `
          <div class="kicker">APM Cookbook</div>
          <h1>${escapeHtml(c.displayName)}</h1>
          <div class="docs-audience">
            <span class="docs-audience__chip"><strong>Pattern:</strong> ${escapeHtml(c.pattern)}</span>
            <span class="docs-audience__chip"><strong>chProvider:</strong> ${escapeHtml(c.chProvider)}</span>
          </div>
          <div class="docs-tldr">${escapeHtml(c.tldr)}</div>
          <h3>Overview</h3>
          <p>${c.overview}</p>
          <h3>Wire payloads</h3>
          <div class="cookbook__wire">
            <div>
              <div class="kicker">Request → CH Orders</div>
              <pre class="code-block">${escapeHtml(JSON.stringify(c.wireRequest, null, 2))}</pre>
            </div>
            <div>
              <div class="kicker">Response from CH</div>
              <pre class="code-block">${escapeHtml(JSON.stringify(c.wireResponse, null, 2))}</pre>
            </div>
          </div>
          <h3>Integration steps</h3>
          ${c.steps.map((s) => `<section class="docs-step"><div class="docs-step__num">${String(s.num).padStart(2,'0')}</div><h3>Step ${s.num} — ${escapeHtml(s.title)}</h3>${s.body}</section>`).join('')}
          <h3>Error paths</h3>
          <table>
            <thead><tr><td>Code</td><td>Cause</td><td>Recovery</td></tr></thead>
            <tbody>
              ${c.errorPaths.map((e) => `<tr><td><code>${escapeHtml(e.code)}</code></td><td>${escapeHtml(e.cause)}</td><td>${escapeHtml(e.recovery)}</td></tr>`).join('')}
            </tbody>
          </table>
          <h3>Sandbox credentials</h3>
          <p>${escapeHtml(c.sandboxCredentials)}</p>
          <h3>Common pitfalls</h3>
          ${c.commonPitfalls}
        `;
        return;
      }
    }

    // Audience views
    const aud = AUDIENCE_VIEWS.find((v) => v.key === key);
    if (aud) {
      main.innerHTML = `
        <div class="kicker">${escapeHtml(aud.altitude)}</div>
        <h1>${escapeHtml(aud.title)}</h1>
        <div class="docs-audience">
          <span class="docs-audience__chip"><strong>For:</strong> ${escapeHtml(aud.audience)}</span>
          <span class="docs-audience__chip"><strong>Altitude:</strong> ${escapeHtml(aud.altitude)}</span>
        </div>
        <div class="docs-tldr">${escapeHtml(aud.tldr)}</div>
        ${aud.body}
      `;
      return;
    }

    if (key === 'architecture') {
      main.innerHTML = `
        <div class="kicker">Architecture &amp; workflows</div>
        <h1>How v2.2 is wired</h1>
        <div class="docs-tldr">One Commerce Hub endpoint, six base adapters, an 11-state FSM, and a single contract for 70 alternative payment methods.</div>

        <h3>Three-package split</h3>
        <p>
          The codebase lives in a single npm workspace with four packages:
          <code>shared-types</code> (zero-runtime types), <code>commerce-hub-node</code>
          (server-side CH client), <code>checkout-sdk-browser</code> (browser
          SDK), and <code>reference-server</code> (Express app that serves this
          harness and the <code>/v2/*</code> routes).
        </p>
        <p>
          The package boundary is enforced: the browser SDK has zero knowledge of
          CH wire fields, and the reference server is the only place that
          imports <code>commerce-hub-node</code>. Merchant code never imports a
          per-provider client (<strong>no PPRO client, no direct Klarna client</strong>).
        </p>

        <h3>Architecture diagram</h3>
        <div class="docs-mermaid" data-mermaid-host="adapter-hierarchy">
          <div class="docs-mermaid__title">Adapter hierarchy</div>
          <div class="docs-mermaid__desc">Registry → 6 base classes → 70 concrete adapters</div>
          <div class="docs-mermaid__svg" data-mermaid-slot="adapter-hierarchy">${escapeHtml(MERMAID_DIAGRAMS.adapterHierarchy.source)}</div>
        </div>

        <h3>Interactive adapter explorer</h3>
        <p>Click a base class to see which APMs use it. The right pane animates as the list refilters.</p>
        ${this.renderAdapterHierarchyInteractive()}
      `;
      await this.renderMermaidIn(main);
      this.wireAdapterHierarchy();
      return;
    }

    if (key === 'sequence-sync') {
      this.renderMermaidSection(main, 'Sync sale flow', MERMAID_DIAGRAMS.sequenceSync, 'sequence-sync');
      return;
    }
    if (key === 'sequence-async') {
      this.renderMermaidSection(main, 'Async webhook flow', MERMAID_DIAGRAMS.sequenceAsyncWebhook, 'sequence-async');
      return;
    }
    if (key === 'sequence-capture') {
      this.renderMermaidSection(main, 'Merchant-initiated capture flow', MERMAID_DIAGRAMS.sequenceMerchantCapture, 'sequence-capture');
      return;
    }
    if (key === 'diagram-state') {
      main.innerHTML = `
        <div class="kicker">Animated state machine · ADR-003</div>
        <h1>11 states · 18 transitions · autoplaying</h1>
        <div class="docs-tldr">Custom SVG visualization that replaces the messy Mermaid state diagram. The 18 legal transitions fire in a 20-second loop. Hover any state to freeze the autoplay and see its outbound transitions. Click a state to pin it and read the full description + outbound list. Respects <code>prefers-reduced-motion</code>.</div>
        <div data-smviz-host></div>
      `;
      const host = main.querySelector('[data-smviz-host]');
      if (host) renderStateMachineViz(host);
      return;
    }
    if (key === 'diagram-class') {
      this.renderMermaidSection(main, 'Class hierarchy', MERMAID_DIAGRAMS.classHierarchy, 'class-hierarchy');
      return;
    }
    if (key === 'diagram-adapters') {
      this.renderMermaidSection(main, 'Adapter graph', MERMAID_DIAGRAMS.adapterHierarchy, 'adapter-graph');
      return;
    }
    if (key === 'impl-guide') {
      main.innerHTML = `
        <div class="kicker">Implementation guide</div>
        <h1>${escapeHtml(IMPLEMENTATION_STEPS[0] ? 'Ship v2.2 in 12 steps' : '')}</h1>
        <div class="docs-tldr">From git clone to production-readiness checks in twelve steps. Every command is copy-paste runnable against the current harness.</div>
        ${IMPLEMENTATION_STEPS.map((step) => `
          <section class="docs-step">
            <div class="docs-step__num">${String(step.num).padStart(2, '0')}</div>
            <h3>Step ${step.num} — ${escapeHtml(step.title)}</h3>
            ${step.body}
          </section>
        `).join('')}
      `;
      return;
    }

    main.innerHTML = `<p class="muted">Section not found.</p>`;
  }

  async renderMermaidSection(main, title, diagram, slotId) {
    main.innerHTML = `
      <div class="kicker">Technical diagram</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="docs-tldr">${escapeHtml(diagram.description)}</div>
      <div class="docs-mermaid">
        <div class="docs-mermaid__title">${escapeHtml(diagram.title)}</div>
        <div class="docs-mermaid__desc">${escapeHtml(diagram.description)}</div>
        <div class="docs-mermaid__svg" data-mermaid-slot="${escapeHtml(slotId)}">${escapeHtml(diagram.source)}</div>
      </div>
    `;
    await this.renderMermaidIn(main);
  }

  async renderMermaidIn(container) {
    try {
      const mermaid = await loadMermaid();
      const slots = container.querySelectorAll('[data-mermaid-slot]');
      for (const slot of slots) {
        const src = slot.textContent.trim();
        const id = 'mmd-' + slot.dataset.mermaidSlot + '-' + Math.random().toString(36).slice(2, 7);
        try {
          const { svg } = await mermaid.render(id, src);
          slot.innerHTML = svg;
        } catch (err) {
          slot.innerHTML = `<div class="docs-mermaid__err">Failed to render diagram: ${escapeHtml(String(err?.message ?? err))}</div><pre class="code-block">${escapeHtml(src)}</pre>`;
        }
      }
    } catch (err) {
      for (const slot of container.querySelectorAll('[data-mermaid-slot]')) {
        const src = slot.textContent.trim();
        slot.innerHTML = `<div class="docs-mermaid__err">Mermaid failed to load (CDN blocked?). Showing raw source:</div><pre class="code-block">${escapeHtml(src)}</pre>`;
      }
    }
  }

  renderRequirementsCard(r) {
    const color = PATTERN_COLORS[r.pattern] ?? 'var(--brand-orange)';
    return `
      <article class="reqcat-card" data-reqcat-apm="${escapeHtml(r.apm)}" data-pattern="${escapeHtml(r.pattern)}" data-aggregator="${escapeHtml(r.aggregator)}" style="--pattern-accent: ${color}">
        <header class="reqcat-card__head">
          <div class="reqcat-card__title">
            <h3>${escapeHtml(r.displayName)}</h3>
            <code>${escapeHtml(r.apm)}</code>
          </div>
          <span class="reqcat-card__pattern">${escapeHtml(r.pattern)}</span>
        </header>
        <div class="reqcat-card__routing"><code>${escapeHtml(r.routingChain)}</code></div>
        <div class="reqcat-card__meta">
          <span>client: <strong>${r.clientParams.length} params</strong></span>
          <span>server: <strong>${r.serverParams.length} params</strong></span>
          <span class="${r.webhookRequired ? 'is-on' : 'is-off'}">webhook ${r.webhookRequired ? '✓' : '—'}</span>
          <span class="${r.returnUrlRequired ? 'is-on' : 'is-off'}">return urls ${r.returnUrlRequired ? '✓' : '—'}</span>
        </div>
        <div class="reqcat-card__geo">
          <span>${r.currencies.slice(0, 3).join(' · ')}${r.currencies.length > 3 ? ` +${r.currencies.length - 3}` : ''}</span>
          <span>${r.countries.slice(0, 4).join(' ')}${r.countries.length > 4 ? ` +${r.countries.length - 4}` : ''}</span>
        </div>
      </article>
    `;
  }

  wireRequirementsFilters(main) {
    let activePattern = '';
    let activeRouted = null; // 'ppro' | 'direct' | null

    const applyFilters = () => {
      const cards = main.querySelectorAll('[data-reqcat-apm]');
      cards.forEach((card) => {
        const pattern = card.dataset.pattern;
        const aggregator = card.dataset.aggregator;
        let show = true;
        if (activePattern && pattern !== activePattern) show = false;
        if (activeRouted === 'ppro' && aggregator !== 'PPRO') show = false;
        if (activeRouted === 'direct' && aggregator === 'PPRO') show = false;
        card.style.display = show ? '' : 'none';
      });
    };

    main.querySelectorAll('[data-reqcat-pattern]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activePattern = btn.dataset.reqcatPattern;
        main.querySelectorAll('[data-reqcat-pattern]').forEach((b) => b.classList.toggle('is-on', b === btn));
        applyFilters();
      });
    });
    main.querySelectorAll('[data-reqcat-routed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.reqcatRouted;
        activeRouted = activeRouted === mode ? null : mode;
        main.querySelectorAll('[data-reqcat-routed]').forEach((b) => b.classList.toggle('is-on', b.dataset.reqcatRouted === activeRouted));
        applyFilters();
      });
    });
    // Click-to-drill: opening a card switches to the single-APM requirements view
    main.querySelectorAll('[data-reqcat-apm]').forEach((card) => {
      card.addEventListener('click', () => this.switchTo(`requirements:${card.dataset.reqcatApm}`));
    });
  }

  renderAdapterHierarchyInteractive() {
    return `
      <div class="docs-hier" data-docs-hier>
        <div class="docs-hier__bases">
          ${BASE_CLASSES.map((b) => `
            <button class="docs-hier__base${b.id === this.activeBase ? ' is-active' : ''}" data-base="${b.id}" data-pattern="${b.pattern}" type="button">
              ${escapeHtml(b.title)}
            </button>
          `).join('')}
        </div>
        <div class="docs-hier__children" data-hier-children>
          ${this.renderHierChildren(this.activeBase)}
        </div>
      </div>
    `;
  }

  renderHierChildren(baseId) {
    const base = BASE_CLASSES.find((b) => b.id === baseId);
    if (!base) return '';
    const matching = this.catalog.filter((e) => e.pattern === base.pattern);
    if (matching.length === 0) return '<div class="muted">No adapters for this base.</div>';
    return matching
      .map((e) => `<span class="docs-hier__child" title="${escapeHtml(e.chProvider ?? e.id)}">${escapeHtml(e.displayName)}</span>`)
      .join('');
  }

  wireAdapterHierarchy() {
    const host = this.root.querySelector('[data-docs-hier]');
    if (!host) return;
    for (const btn of host.querySelectorAll('.docs-hier__base')) {
      btn.addEventListener('click', () => {
        this.activeBase = btn.dataset.base;
        for (const other of host.querySelectorAll('.docs-hier__base')) {
          other.classList.toggle('is-active', other === btn);
        }
        const childrenHost = host.querySelector('[data-hier-children]');
        childrenHost.innerHTML = this.renderHierChildren(this.activeBase);
      });
    }
  }
}
