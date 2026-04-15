/**
 * v2.2 Test Harness — entry point + orchestration.
 *
 * Boots the harness:
 *   1. Fetches /v2/harness/status, /v2/harness/catalog, /v2/harness/scenarios
 *   2. Populates filter controls and status rail meters
 *   3. Instantiates CatalogView + Inspector
 *   4. Wires all DOM events to the right handlers
 *
 * Keeps as little state as possible at this level — CatalogView owns filter
 * state, Inspector owns run state, this module just glues them together.
 */

import { api } from './api.js';
import { CatalogView } from './catalog.js';
import { Inspector } from './inspector.js';
import { DocsView } from './docs.js';
import { V1View } from './v1.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function boot() {
  // Parallel fetch of everything we need
  const [status, catalog, scenarios, sdkRegistry, health] = await Promise.all([
    api.status().catch((e) => ({ error: String(e?.message ?? e) })),
    api.catalog().catch((e) => ({ error: String(e?.message ?? e) })),
    api.scenarios().catch((e) => ({ error: String(e?.message ?? e) })),
    api.sdkRegistry().catch((e) => ({ error: String(e?.message ?? e) })),
    api.health(),
  ]);

  if (catalog?.error) {
    renderFatal(`Failed to load catalog: ${catalog.error}`);
    return;
  }

  // Fill status rail
  if (status && !status.error) {
    $('[data-stat="total"]').textContent = status.apmTotal;
    $('[data-stat="ppro"]').textContent = status.apmPpro;
    $('[data-stat="direct"]').textContent = status.apmDirect;
    $('[data-stat="scenarios"]').textContent = status.scenarios;
    $('[data-status-mode]').textContent = status.mode.toUpperCase();

    populateSelect('#filter-pattern', status.patterns, 'All patterns');
    populateSelect('#filter-currency', status.currencies, 'Any currency');
    populateSelect('#filter-country', status.countries, 'Any country');
  }
  if (health) {
    const ok = health.status === 'ready' || health.status === 'not_ready';
    $('[data-status-health]').textContent = `/readyz: ${ok ? health.status : 'unknown'}`;
  }

  // Wire inspector first (so selection callback is defined before first render)
  const inspector = new Inspector({
    emptyEl: $('[data-inspector-empty]'),
    bodyEl: $('[data-inspector-body]'),
    scenarios: scenarios?.scenarios ?? [],
    sdkRegistry: sdkRegistry?.entries ?? [],
    allApms: catalog.entries ?? [],
  });

  // Wire catalog
  const catalogView = new CatalogView(
    $('[data-catalog-body]'),
    $('[data-catalog-count]'),
    (id) => {
      catalogView.selectById(id);
      const entry = catalog.entries.find((e) => e.id === id);
      if (entry) inspector.load(entry);
    }
  );
  catalogView.load(catalog.entries);

  // Filter controls
  $('#filter-search').addEventListener('input', (e) => catalogView.setFilter('search', e.target.value));
  $('#filter-pattern').addEventListener('change', (e) => catalogView.setFilter('pattern', e.target.value));
  $('#filter-currency').addEventListener('change', (e) => catalogView.setFilter('currency', e.target.value));
  $('#filter-country').addEventListener('change', (e) => catalogView.setFilter('country', e.target.value));

  // Route chips
  for (const chip of $$('[data-toggle-route]')) {
    chip.addEventListener('click', () => {
      chip.classList.toggle('is-on');
      catalogView.toggleRoute(chip.dataset.toggleRoute);
    });
  }

  // Capability checkbox chips
  for (const input of $$('[data-cap-filter]')) {
    input.addEventListener('change', (e) => {
      catalogView.toggleCap(input.dataset.capFilter, e.target.checked);
    });
  }

  // View tabs
  for (const tab of $$('[data-view]')) {
    tab.addEventListener('click', () => {
      for (const t of $$('[data-view]')) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      }
      catalogView.setView(tab.dataset.view);
    });
  }

  // Clear filters
  $('#btn-clear-filters').addEventListener('click', () => {
    $('#filter-search').value = '';
    $('#filter-pattern').value = '';
    $('#filter-currency').value = '';
    $('#filter-country').value = '';
    for (const chip of $$('[data-toggle-route]')) chip.classList.remove('is-on');
    for (const input of $$('[data-cap-filter]')) input.checked = false;
    catalogView.clearFilters();
  });

  // Reset button
  $('#btn-reset').addEventListener('click', async () => {
    try {
      await api.reset();
    } catch {}
    location.reload();
  });

  // If the catalog has entries, auto-select the first one so the inspector
  // isn't empty on first paint (handy for demos)
  if (catalog.entries.length > 0) {
    const first = catalog.entries[0];
    catalogView.selectById(first.id);
    inspector.load(first);
  }

  // Docs mode — lazily instantiated + populated on first activation
  const docsView = new DocsView({
    rootEl: $('[data-docs-root]'),
    catalogEntries: catalog.entries,
  });

  // V1 Legacy mode — lazy, mounts v1's pages via same-origin static+proxy
  const v1View = new V1View({ rootEl: $('[data-v1-root]') });

  // Mode toggle (Inspector ↔ Docs ↔ V1 Legacy)
  for (const btn of $$('[data-mode]')) {
    btn.addEventListener('click', async () => {
      for (const other of $$('[data-mode]')) {
        other.classList.toggle('is-active', other === btn);
        other.setAttribute('aria-selected', other === btn ? 'true' : 'false');
      }
      // Clear all mode classes before applying the new one
      document.body.classList.remove('docs-mode', 'v1-mode');
      // Wide-trace is only meaningful in Inspector mode
      if (btn.dataset.mode !== 'inspector') {
        document.body.classList.remove('wide-trace');
      }
      if (btn.dataset.mode === 'docs') {
        document.body.classList.add('docs-mode');
        v1View.deactivate();
        await docsView.activate();
      } else if (btn.dataset.mode === 'v1') {
        document.body.classList.add('v1-mode');
        await v1View.activate();
      } else {
        v1View.deactivate();
        // Restore wide-trace if we were on Trace tab before leaving Inspector
        if (inspector.activeTab === 'trace') document.body.classList.add('wide-trace');
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === '/') {
      ev.preventDefault();
      $('#filter-search').focus();
    }
    if (ev.key === 'Escape') {
      $('#filter-search').value = '';
      catalogView.setFilter('search', '');
    }
  });
}

function populateSelect(selector, items, defaultLabel) {
  const el = document.querySelector(selector);
  if (!el) return;
  // Keep the first "any" option, rebuild the rest
  el.innerHTML = `<option value="">${defaultLabel}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    el.appendChild(opt);
  }
}

function renderFatal(message) {
  const root = document.querySelector('[data-catalog-body]');
  if (root) {
    root.innerHTML = `<div class="log__empty">${message}</div>`;
  }
  console.error('[harness]', message);
}

boot().catch((err) => {
  console.error('[harness] boot failed', err);
  renderFatal(`Boot failed: ${err?.message ?? err}`);
});
