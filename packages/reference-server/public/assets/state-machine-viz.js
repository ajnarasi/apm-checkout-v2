/**
 * v2.2 harness — Animated state machine visualization.
 *
 * Replaces the messy Mermaid state diagram with a custom SVG that:
 *   1. Lays the 11 canonical states out in a clear left-to-right flow
 *      (entry on the left, terminal states on the right)
 *   2. Autoplay loop: the 18 legal transitions fire in sequence over a
 *      20-second cycle, arrows pulse orange as each one activates, the
 *      current-state node glows
 *   3. Hover: freeze the autoplay and highlight the hovered state's
 *      outbound transitions
 *   4. Click a state to pin it (shows its full transition list + semantic
 *      description in a panel below)
 *   5. prefers-reduced-motion: no autoplay, static first frame only
 */

import { escapeHtml } from './catalog.js';

// Canonical 11 states from ADR-003 + 18 legal transitions
const STATES = [
  { id: 'idle',                        x: 60,  y: 180, label: 'idle',                        terminal: false, description: 'Initial state. SDK created but init() not called yet.' },
  { id: 'initializing',                x: 200, y: 180, label: 'initializing',                terminal: false, description: 'createCheckout() called. Provider SDK CDN loading, session being minted.' },
  { id: 'ready',                       x: 340, y: 180, label: 'ready',                       terminal: false, description: 'Provider widget rendered + mounted. Waiting for user interaction.' },
  { id: 'authorizing',                 x: 480, y: 180, label: 'authorizing',                 terminal: false, description: 'User clicked the provider button. POST /v2/orders/:apm in flight.' },
  { id: 'pending',                     x: 620, y: 110, label: 'pending',                     terminal: false, description: 'Async APM returned PAYER_ACTION_REQUIRED. Waiting on user + webhook.' },
  { id: 'awaiting_merchant_capture',   x: 620, y: 250, label: 'awaiting_merchant_capture',   terminal: false, description: 'Merchant-initiated auth-only returned AUTHORIZED. Waiting for manual capture.' },
  { id: 'capturing',                   x: 780, y: 250, label: 'capturing',                   terminal: false, description: 'POST /v2/orders/:orderId/capture in flight.' },
  { id: 'completed',                   x: 920, y: 110, label: 'completed',                   terminal: true,  description: 'Terminal: CAPTURED. PAYMENT_COMPLETED fired.' },
  { id: 'failed',                      x: 920, y: 180, label: 'failed',                      terminal: true,  description: 'Terminal: DECLINED, network error, or invalid transition.' },
  { id: 'cancelled',                   x: 920, y: 250, label: 'cancelled',                   terminal: true,  description: 'Terminal: user cancelled or void succeeded.' },
  { id: 'auth_expired',                x: 920, y: 320, label: 'auth_expired',                terminal: true,  description: 'Terminal: authorization hold TTL elapsed before capture.' },
];
const TRANSITIONS = [
  { from: 'idle',                      to: 'initializing',               trigger: 'init()' },
  { from: 'initializing',              to: 'ready',                      trigger: 'SDK loaded, session minted' },
  { from: 'initializing',              to: 'failed',                     trigger: 'CDN failure or session error' },
  { from: 'ready',                     to: 'authorizing',                trigger: 'user clicks provider button' },
  { from: 'authorizing',               to: 'completed',                  trigger: 'CH returns CAPTURED (sync sale)' },
  { from: 'authorizing',               to: 'pending',                    trigger: 'CH returns PAYER_ACTION_REQUIRED' },
  { from: 'authorizing',               to: 'awaiting_merchant_capture',  trigger: 'CH returns AUTHORIZED (MIT)' },
  { from: 'authorizing',               to: 'failed',                     trigger: 'CH returns DECLINED' },
  { from: 'authorizing',               to: 'cancelled',                  trigger: 'user cancels at provider' },
  { from: 'pending',                   to: 'completed',                  trigger: 'webhook: payment.succeeded' },
  { from: 'pending',                   to: 'failed',                     trigger: 'webhook: payment.failed' },
  { from: 'pending',                   to: 'cancelled',                  trigger: 'webhook: payment.cancelled' },
  { from: 'awaiting_merchant_capture', to: 'capturing',                  trigger: 'merchant calls /capture' },
  { from: 'awaiting_merchant_capture', to: 'cancelled',                  trigger: 'merchant calls /void' },
  { from: 'awaiting_merchant_capture', to: 'auth_expired',               trigger: 'auth hold TTL elapsed' },
  { from: 'capturing',                 to: 'completed',                  trigger: 'CH returns CAPTURED' },
  { from: 'capturing',                 to: 'failed',                     trigger: 'capture rejected' },
  // Plus one script_load_failed variant, implicit in the initializing → failed edge
];

export function renderStateMachineViz(hostEl) {
  const W = 1020;
  const H = 420;

  // Build SVG markup
  const stateNode = (s) => `
    <g class="sm-node ${s.terminal ? 'sm-node--terminal' : ''}" data-state="${s.id}" transform="translate(${s.x}, ${s.y})">
      <rect class="sm-node__box" x="-58" y="-22" width="116" height="44" rx="22" ry="22" />
      <text class="sm-node__label" text-anchor="middle" y="5">${escapeHtml(s.label)}</text>
    </g>
  `;

  // Arrow path helpers
  const arrow = (tr, idx) => {
    const from = STATES.find((s) => s.id === tr.from);
    const to = STATES.find((s) => s.id === tr.to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const offX = (dx / dist) * 60;
    const offY = (dy / dist) * 25;
    const x1 = from.x + offX;
    const y1 = from.y + offY;
    const x2 = to.x - offX;
    const y2 = to.y - offY;
    // Curve for vertical offsets so arrows don't overlap
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 + (dy === 0 ? 0 : Math.sign(dy) * -12);
    const path = `M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`;
    return `
      <g class="sm-edge" data-edge-idx="${idx}" data-from="${tr.from}" data-to="${tr.to}">
        <path class="sm-edge__path" d="${path}" fill="none" marker-end="url(#sm-arrow)" />
        <path class="sm-edge__hit" d="${path}" fill="none" stroke="transparent" stroke-width="12">
          <title>${escapeHtml(tr.from + ' → ' + tr.to + ': ' + tr.trigger)}</title>
        </path>
      </g>
    `;
  };

  hostEl.innerHTML = `
    <div class="smviz">
      <div class="smviz__header">
        <div class="kicker">ADR-003 · Animated state machine</div>
        <h3>11 states · 18 legal transitions</h3>
        <p class="muted">Autoplay loops every 20s. Hover a state to highlight its outbound transitions. Click a state to pin it and read its description. Terminal states are orange-tinted; intermediate states are grey.</p>
      </div>
      <div class="smviz__controls">
        <button class="btn btn--outline" data-smviz-play type="button">⏸ Pause</button>
        <button class="btn btn--outline" data-smviz-reset type="button">↺ Reset</button>
        <span class="smviz__step">Step <strong data-smviz-step>1</strong> / ${TRANSITIONS.length}</span>
      </div>
      <div class="smviz__svg-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="smviz__svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g class="sm-edges">
            ${TRANSITIONS.map(arrow).join('')}
          </g>
          <g class="sm-nodes">
            ${STATES.map(stateNode).join('')}
          </g>
        </svg>
      </div>
      <div class="smviz__info" data-smviz-info>
        <div class="kicker">Current transition</div>
        <p class="smviz__info-text" data-smviz-info-text>idle → initializing — triggered by <code>init()</code></p>
      </div>
      <div class="smviz__legend">
        <span class="smviz__legend-chip smviz__legend-chip--intermediate">intermediate state</span>
        <span class="smviz__legend-chip smviz__legend-chip--terminal">terminal state</span>
        <span class="smviz__legend-chip smviz__legend-chip--active">active transition</span>
      </div>
    </div>
  `;

  // Autoplay state
  let currentIdx = 0;
  let playing = true;
  let pinnedState = null;
  let timer = null;

  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function setActiveTransition(idx) {
    hostEl.querySelectorAll('.sm-edge').forEach((e) => e.classList.remove('is-active'));
    hostEl.querySelectorAll('.sm-node').forEach((n) => n.classList.remove('is-active', 'is-active-from'));
    const tr = TRANSITIONS[idx];
    const edge = hostEl.querySelector(`[data-edge-idx="${idx}"]`);
    edge?.classList.add('is-active');
    const fromNode = hostEl.querySelector(`.sm-node[data-state="${tr.from}"]`);
    const toNode = hostEl.querySelector(`.sm-node[data-state="${tr.to}"]`);
    fromNode?.classList.add('is-active-from');
    toNode?.classList.add('is-active');
    const stepEl = hostEl.querySelector('[data-smviz-step]');
    if (stepEl) stepEl.textContent = idx + 1;
    const infoText = hostEl.querySelector('[data-smviz-info-text]');
    if (infoText) infoText.innerHTML = `<strong>${escapeHtml(tr.from)}</strong> → <strong>${escapeHtml(tr.to)}</strong> — triggered by <code>${escapeHtml(tr.trigger)}</code>`;
  }

  function tick() {
    if (!playing || pinnedState) return;
    setActiveTransition(currentIdx);
    currentIdx = (currentIdx + 1) % TRANSITIONS.length;
  }

  function start() {
    stop();
    tick();
    if (!prefersReduced) {
      timer = setInterval(tick, 1200);
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  start();

  // Wire controls
  const playBtn = hostEl.querySelector('[data-smviz-play]');
  playBtn?.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    if (playing) start();
    else stop();
  });
  hostEl.querySelector('[data-smviz-reset]')?.addEventListener('click', () => {
    currentIdx = 0;
    pinnedState = null;
    hostEl.querySelectorAll('.sm-node').forEach((n) => n.classList.remove('is-pinned'));
    playing = true;
    if (playBtn) playBtn.textContent = '⏸ Pause';
    start();
  });

  // Hover a state to freeze + show outbound transitions
  hostEl.querySelectorAll('.sm-node').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      if (pinnedState) return;
      stop();
      const id = node.dataset.state;
      const st = STATES.find((s) => s.id === id);
      hostEl.querySelectorAll('.sm-edge').forEach((e) => e.classList.toggle('is-highlighted', e.dataset.from === id));
      const infoText = hostEl.querySelector('[data-smviz-info-text]');
      if (infoText) infoText.innerHTML = `<strong>${escapeHtml(st.label)}</strong> — ${escapeHtml(st.description)}`;
    });
    node.addEventListener('mouseleave', () => {
      if (pinnedState) return;
      hostEl.querySelectorAll('.sm-edge').forEach((e) => e.classList.remove('is-highlighted'));
      if (playing) start();
    });
    node.addEventListener('click', () => {
      const id = node.dataset.state;
      if (pinnedState === id) {
        pinnedState = null;
        node.classList.remove('is-pinned');
        if (playing) start();
      } else {
        hostEl.querySelectorAll('.sm-node').forEach((n) => n.classList.remove('is-pinned'));
        pinnedState = id;
        node.classList.add('is-pinned');
        stop();
        const st = STATES.find((s) => s.id === id);
        const outbound = TRANSITIONS.filter((t) => t.from === id);
        hostEl.querySelectorAll('.sm-edge').forEach((e) => e.classList.toggle('is-highlighted', e.dataset.from === id));
        const infoText = hostEl.querySelector('[data-smviz-info-text]');
        if (infoText) {
          infoText.innerHTML = `<strong>${escapeHtml(st.label)}</strong> — ${escapeHtml(st.description)}<br><br><em>Outbound transitions:</em><ul>${outbound.map((t) => `<li><strong>${escapeHtml(t.to)}</strong> — ${escapeHtml(t.trigger)}</li>`).join('')}</ul>`;
        }
      }
    });
  });

  return {
    destroy() { stop(); },
  };
}
