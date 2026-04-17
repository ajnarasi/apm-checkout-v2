/**
 * v2.2 Test Harness — Catalog view.
 *
 * Filterable grid / table / capability matrix over the full APM_MAPPING
 * returned by GET /v2/harness/catalog. Updates the DOM in place; delegates
 * selection back to app.js via an onSelect callback.
 */

const PATTERN_LABEL = {
  'redirect':     'Bank redirect',
  'bnpl':         'BNPL',
  'native-wallet':'Native wallet',
  'button-sdk':   'Button SDK',
  'qr':           'QR code',
  'voucher':      'Voucher / cash',
};

export class CatalogView {
  constructor(rootEl, countEl, onSelect) {
    this.root = rootEl;
    this.countEl = countEl;
    this.onSelect = onSelect;
    this.entries = [];
    this.filtered = [];
    this.filters = {
      search: '',
      pattern: '',
      currency: '',
      country: '',
      routes: new Set(),
      caps: new Set(),
    };
    this.view = 'grid'; // grid | table | matrix
    this.selectedId = null;
  }

  load(entries) {
    this.entries = entries;
    this.applyFilters();
  }

  setView(view) {
    this.view = view;
    this.render();
  }

  setFilter(key, value) {
    this.filters[key] = value;
    this.applyFilters();
  }

  toggleRoute(route) {
    if (this.filters.routes.has(route)) this.filters.routes.delete(route);
    else this.filters.routes.add(route);
    this.applyFilters();
  }

  toggleCap(cap, on) {
    if (on) this.filters.caps.add(cap);
    else this.filters.caps.delete(cap);
    this.applyFilters();
  }

  clearFilters() {
    this.filters = {
      search: '',
      pattern: '',
      currency: '',
      country: '',
      routes: new Set(),
      caps: new Set(),
    };
    this.applyFilters();
  }

  hasSelection() {
    return !!this.selectedId;
  }

  applyFilters() {
    const f = this.filters;
    const q = f.search.trim().toLowerCase();
    this.filtered = this.entries.filter((e) => {
      if (q && !(
        e.id.toLowerCase().includes(q) ||
        e.displayName.toLowerCase().includes(q) ||
        e.countries.some((c) => c.toLowerCase() === q) ||
        e.currencies.some((c) => c.toLowerCase() === q)
      )) return false;
      if (f.pattern && e.pattern !== f.pattern) return false;
      if (f.currency && !e.currencies.includes(f.currency)) return false;
      if (f.country && !e.countries.includes(f.country)) return false;
      if (f.routes.size) {
        const isPpro = e.isPproRouted;
        const wants = f.routes.has(isPpro ? 'ppro' : 'direct');
        if (!wants) return false;
      }
      if (f.caps.size) {
        for (const cap of f.caps) {
          if (!e.capabilities[cap]) return false;
        }
      }
      return true;
    });
    this.render();
  }

  selectById(id) {
    this.selectedId = id;
    this.render();
  }

  render() {
    if (this.countEl) this.countEl.textContent = this.filtered.length;
    this.root.innerHTML = '';
    if (this.view === 'grid') return this.renderGrid();
    if (this.view === 'table') return this.renderTable();
    if (this.view === 'matrix') return this.renderMatrix();
  }

  renderGrid() {
    const grid = document.createElement('div');
    grid.className = 'cgrid';
    if (this.filtered.length === 0) {
      grid.innerHTML = `<div class="log__empty">No APMs match your filters.</div>`;
      this.root.appendChild(grid);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const e of this.filtered) {
      const card = document.createElement('button');
      card.className = 'card' + (this.selectedId === e.id ? ' is-selected' : '');
      card.type = 'button';
      card.setAttribute('data-apm', e.id);
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__name">${escapeHtml(e.displayName)}</div>
            <div class="card__id">${escapeHtml(e.id)}</div>
          </div>
          <span class="card__tag ${e.isPproRouted ? 'card__tag--ppro' : 'card__tag--direct'}">
            ${e.isPproRouted ? 'PPRO' : e.aggregator}
          </span>
        </div>
        <div class="card__meta">
          <span><strong>${PATTERN_LABEL[e.pattern] ?? e.pattern}</strong></span>
          <span>${e.capabilities.region}</span>
        </div>
        <div class="card__meta">
          <div class="card__geo">
            ${e.currencies.slice(0, 4).map((c) => `<span>${c}</span>`).join('')}
            ${e.currencies.length > 4 ? `<span>+${e.currencies.length - 4}</span>` : ''}
          </div>
          <div class="card__geo">
            ${e.countries.slice(0, 4).map((c) => `<span>${c}</span>`).join('')}
            ${e.countries.length > 4 ? `<span>+${e.countries.length - 4}</span>` : ''}
          </div>
        </div>
        <div class="card__wire">
          <div class="card__wire-row">
            <span>sourceType</span><span>${escapeHtml(e.chSourceType)}</span>
          </div>
          ${e.chWalletType ? `
          <div class="card__wire-row">
            <span>walletType</span><span>${escapeHtml(e.chWalletType)}</span>
          </div>` : ''}
          ${e.chProvider ? `
          <div class="card__wire-row">
            <span>provider</span><span class="wire__highlight">${escapeHtml(e.chProvider)}</span>
          </div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => this.onSelect(e.id));
      frag.appendChild(card);
    }
    grid.appendChild(frag);
    this.root.appendChild(grid);
  }

  renderTable() {
    const table = document.createElement('table');
    table.className = 'ctable';
    table.innerHTML = `
      <thead>
        <tr>
          <th>APM</th><th>Id</th><th>Pattern</th><th>Aggregator</th>
          <th>sourceType</th><th>walletType</th><th>provider</th>
          <th>Currencies</th><th>Countries</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const body = table.querySelector('tbody');
    for (const e of this.filtered) {
      const tr = document.createElement('tr');
      if (this.selectedId === e.id) tr.classList.add('is-selected');
      tr.innerHTML = `
        <td><strong>${escapeHtml(e.displayName)}</strong></td>
        <td><code>${escapeHtml(e.id)}</code></td>
        <td>${PATTERN_LABEL[e.pattern] ?? e.pattern}</td>
        <td><code>${escapeHtml(e.aggregator)}</code></td>
        <td><code>${escapeHtml(e.chSourceType)}</code></td>
        <td><code>${escapeHtml(e.chWalletType ?? '—')}</code></td>
        <td><code class="${e.chProvider ? 'wire__highlight' : ''}">${escapeHtml(e.chProvider ?? '—')}</code></td>
        <td><code>${e.currencies.join(', ') || '—'}</code></td>
        <td><code>${e.countries.join(', ') || '—'}</code></td>
      `;
      tr.addEventListener('click', () => this.onSelect(e.id));
      body.appendChild(tr);
    }
    this.root.appendChild(table);
  }

  renderMatrix() {
    const wrap = document.createElement('div');
    wrap.className = 'cmatrix';
    const head = document.createElement('div');
    head.className = 'cmatrix__row cmatrix__row--head';
    head.innerHTML = `
      <div>APM</div>
      <div title="Gateway-initiated sale: auth + capture in one call">Sale</div>
      <div title="Merchant-initiated auth-only, capture later">Auth</div>
      <div title="Separate capture after authorize">Capture</div>
      <div title="Partial capture supported">Partial</div>
      <div title="Void before settlement">Void</div>
      <div title="Refund after capture">Refund</div>
      <div title="Async settlement via webhook">Webhook</div>
      <div title="Promotional message widget (Pay in 4, etc.)">Promo</div>
      <div title="onShippingAddressChange">Ship</div>
      <div title="onShippingMethodChange / onShippingOptionsChange">Method</div>
      <div title="onCouponChange">Coupon</div>
      <div title="onPaymentMethodChange (native wallets only)">PayM</div>
    `;
    wrap.appendChild(head);
    for (const e of this.filtered) {
      const row = document.createElement('div');
      row.className = 'cmatrix__row' + (this.selectedId === e.id ? ' is-selected' : '');
      const c = e.capabilities;
      row.innerHTML = `
        <div class="cmatrix__name">
          ${escapeHtml(e.displayName)}
          <small>${escapeHtml(e.id)}</small>
        </div>
        ${cell(c.supportsGatewayInitiated)}
        ${cell(c.supportsMerchantInitiated)}
        ${cell(c.supportsSeparateCapture)}
        ${cell(c.supportsPartialCapture)}
        ${cell(c.supportsVoid)}
        ${cell(c.supportsRefund)}
        ${cell(c.requiresWebhook)}
        ${cell(c.providesPromoWidget)}
        ${cell(c.onShippingAddressChange)}
        ${cell(c.onShippingMethodChange)}
        ${cell(c.onCouponChange)}
        ${cell(c.onPaymentMethodChange)}
      `;
      row.addEventListener('click', () => this.onSelect(e.id));
      wrap.appendChild(row);
    }
    this.root.appendChild(wrap);
  }
}

function cell(on) {
  return `<div class="cmatrix__cell ${on ? 'is-on' : 'is-off'}">${on ? '●' : '○'}</div>`;
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
