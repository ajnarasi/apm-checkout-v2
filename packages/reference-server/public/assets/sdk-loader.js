/**
 * v2.2 harness — Provider SDK sandbox loader.
 *
 * Does the real work of the SDK pane:
 *   1. Fetches the SDK registry entry for the current APM
 *   2. Renders a credentials form
 *   3. On "Load": injects the provider CDN script, polls the window global,
 *      reports success/failure with timing
 *   4. On success: calls the provider-specific renderer to mount a live
 *      button / promo widget / native sheet into the harness DOM
 *
 * This is the ONLY part of the harness that touches real provider SDKs.
 * Everything else is wire-contract simulation.
 */

import { escapeHtml } from './catalog.js';

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 8000;

// ───────────────────────────────────────────────────────────────────
// Persistent in-memory store so sandbox creds survive tab switches.
// ───────────────────────────────────────────────────────────────────

const credStore = new Map(); // apm → { [field]: value }
const loadState = new Map(); // apm → { status, error, durationMs, global, loadedAt }
const loadedScripts = new Map(); // url → Promise<HTMLScriptElement>

// Live callback registry — the Callbacks pane writes merchant handler
// functions here and the renderers read them at button-mount time so
// that clicking the real provider button fires the real callbacks.
const liveCallbacks = new Map(); // apm → { onShippingAddressChange, onShippingMethodChange, ... }

export function registerLiveCallback(apm, key, fn) {
  const existing = liveCallbacks.get(apm) ?? {};
  existing[key] = fn;
  liveCallbacks.set(apm, existing);
}
export function getLiveCallbacks(apm) {
  return liveCallbacks.get(apm) ?? {};
}

export function getCredentials(apm) {
  return credStore.get(apm) ?? {};
}
export function saveCredentials(apm, creds) {
  credStore.set(apm, { ...getCredentials(apm), ...creds });
}
export function getLoadState(apm) {
  return loadState.get(apm) ?? { status: 'idle', error: null, durationMs: null };
}

// ───────────────────────────────────────────────────────────────────
// Low-level script injection with de-duplication.
// ───────────────────────────────────────────────────────────────────

function injectScript(url, { attributes = {} } = {}) {
  if (loadedScripts.has(url)) return loadedScripts.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    for (const [k, v] of Object.entries(attributes)) s.setAttribute(k, v);
    s.onload = () => resolve(s);
    s.onerror = () =>
      reject(new Error(`Failed to load script ${url}. Check the browser's Network/Console tab — likely blocked by CORS, CSP, or an invalid credential.`));
    document.head.appendChild(s);
  });
  loadedScripts.set(url, p);
  return p;
}

function pollForGlobal(name, { timeoutMs = POLL_TIMEOUT_MS } = {}) {
  const start = performance.now();
  const path = name.split('.');
  return new Promise((resolve, reject) => {
    const tick = () => {
      let obj = window;
      for (const k of path) {
        if (obj == null) { obj = undefined; break; }
        obj = obj[k];
      }
      if (obj != null) return resolve(obj);
      if (performance.now() - start > timeoutMs) {
        return reject(new Error(`Timed out polling for window.${name} after ${timeoutMs} ms`));
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  });
}

function expandUrl(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k] ?? ''));
}

// ───────────────────────────────────────────────────────────────────
// Per-strategy renderers. Each one returns a Promise<RenderResult>:
//   { ok: true, details: string }   — widget mounted
//   { ok: false, reason: string }   — missing creds / failed render
//
// Mount points are passed in by the caller (inspector.js):
//   { buttonEl, promoEl, priceTagEl, statusEl }
// ───────────────────────────────────────────────────────────────────

const RENDERERS = {
  // ─── PayPal / Pay Later / Venmo ───────────────────────────────
  async paypal(apm, creds, mounts) {
    if (!mounts.buttonEl) return { ok: false, reason: 'Missing button mount' };
    const paypal = window.paypal;
    if (!paypal?.Buttons) return { ok: false, reason: 'window.paypal.Buttons missing' };

    const fundingMap = {
      paypal: paypal.FUNDING.PAYPAL,
      paypal_paylater: paypal.FUNDING.PAYLATER,
      venmo: paypal.FUNDING.VENMO,
    };
    const funding = fundingMap[apm] ?? paypal.FUNDING.PAYPAL;

    // Pull any live callback handlers the user configured in the Callbacks pane
    const liveCbs = getLiveCallbacks(apm);

    mounts.buttonEl.innerHTML = '';
    try {
      await paypal
        .Buttons({
          fundingSource: funding,
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
          createOrder: (_data, actions) =>
            actions.order.create({
              purchase_units: [{ amount: { value: '49.99', currency_code: creds.currency || 'USD' } }],
            }),
          onApprove: async (_data, _actions) => {
            window.__harnessEmit?.('button_approved', { apm });
            return true;
          },
          onError: (err) => {
            window.__harnessEmit?.('button_error', { apm, message: String(err?.message ?? err) });
          },
          onCancel: () => {
            window.__harnessEmit?.('button_cancelled', { apm });
          },
          // Real PayPal SDK interactive callbacks — fire when the user picks
          // a shipping address / option inside the PayPal sheet.
          ...(liveCbs.onShippingAddressChange ? {
            onShippingAddressChange: async (data, actions) => {
              window.__harnessEmit?.('onShippingAddressChange', { apm, data });
              const response = liveCbs.onShippingAddressChange(data);
              if (response?.reject) return actions.reject();
              return actions.patch?.() ?? undefined;
            },
          } : {}),
          ...(liveCbs.onShippingMethodChange ? {
            onShippingOptionsChange: async (data, actions) => {
              window.__harnessEmit?.('onShippingOptionsChange', { apm, data });
              const response = liveCbs.onShippingMethodChange(data);
              if (response?.reject) return actions.reject();
              return actions.patch?.() ?? undefined;
            },
          } : {}),
        })
        .render(mounts.buttonEl);
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    }

    // Pay Later promo message
    if (mounts.promoEl && paypal.Messages && apm !== 'venmo') {
      mounts.promoEl.innerHTML = '';
      try {
        paypal
          .Messages({ amount: 49.99, placement: 'product', style: { layout: 'text', color: 'black' } })
          .render(mounts.promoEl);
      } catch (err) {
        mounts.promoEl.innerHTML = `<div class="widget-err">Promo widget failed: ${escapeHtml(String(err?.message ?? err))}</div>`;
      }
    }

    return { ok: true, details: `paypal.Buttons({ fundingSource: ${apm} }).render() succeeded` };
  },

  // ─── Cash App Pay ─────────────────────────────────────────────
  async cashapp(apm, creds, mounts) {
    if (!mounts.buttonEl) return { ok: false, reason: 'Missing button mount' };
    const CashApp = window.CashApp ?? window.payKit;
    if (!CashApp) return { ok: false, reason: 'window.CashApp not found (wrong client-id?)' };
    try {
      const pay = await CashApp.pay({
        clientId: creds.clientId,
        button: { size: 'MEDIUM', shape: 'ROUND', theme: 'DARK' },
      });
      if (!pay?.render) {
        mounts.buttonEl.innerHTML =
          '<div class="widget-err">CashApp.pay() returned no render fn — likely an invalid client-id.</div>';
        return { ok: false, reason: 'CashApp.pay() returned no render fn' };
      }
      mounts.buttonEl.innerHTML = '';
      await pay.render(mounts.buttonEl);
      return { ok: true, details: 'CashApp.pay().render() succeeded' };
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    }
  },

  // ─── Klarna placements ────────────────────────────────────────
  async klarna(_apm, creds, mounts) {
    const Klarna = window.Klarna;
    if (!Klarna) return { ok: false, reason: 'window.Klarna not found' };

    let notes = [];

    // On-site messaging placement
    if (mounts.promoEl && creds.dataKey) {
      mounts.promoEl.innerHTML = `<klarna-placement data-key="${escapeHtml(creds.dataKey)}" data-locale="en-US" data-purchase-amount="4999"></klarna-placement>`;
      try {
        if (Klarna.OnsiteMessaging?.refresh) {
          Klarna.OnsiteMessaging.refresh();
          notes.push(`Klarna.OnsiteMessaging.refresh() on data-key=${creds.dataKey}`);
        }
      } catch (err) {
        notes.push(`OnsiteMessaging failed: ${err?.message}`);
      }
    }

    // Full payment widget — only if client_token provided
    if (mounts.buttonEl && creds.clientToken && Klarna.Payments?.init) {
      try {
        Klarna.Payments.init({ client_token: creds.clientToken });
        mounts.buttonEl.innerHTML = '<div id="klarna-widget-slot" style="min-height:140px;"></div>';
        await new Promise((resolve) => {
          Klarna.Payments.load(
            { container: '#klarna-widget-slot', payment_method_category: 'pay_later' },
            () => resolve()
          );
        });
        notes.push('Klarna.Payments.load(pay_later)');
      } catch (err) {
        mounts.buttonEl.innerHTML = `<div class="widget-err">Klarna.Payments failed: ${escapeHtml(String(err?.message ?? err))}</div>`;
      }
    } else if (mounts.buttonEl) {
      mounts.buttonEl.innerHTML =
        '<div class="widget-info">Provide a Klarna <code>client_token</code> above to render the full payment widget.</div>';
    }

    return {
      ok: true,
      details: notes.length ? notes.join(' · ') : 'Klarna loaded; no widgets rendered (provide dataKey or clientToken)',
    };
  },

  // ─── Affirm promo widget ──────────────────────────────────────
  async affirm(_apm, creds, mounts) {
    const affirm = window.affirm;
    if (!affirm) return { ok: false, reason: 'window.affirm not found' };

    // Affirm init uses a magic preload config; documented pattern
    if (typeof affirm._config !== 'object') {
      try {
        // affirm.js v2 auto-configures from a meta tag, but we can also
        // set a minimal config post-hoc for the promo widget
        window._affirm_config = {
          public_api_key: creds.publicApiKey,
          script: 'https://cdn1-sandbox.affirm.com/js/v2/affirm.js',
          country_code: creds.country || 'USA',
        };
      } catch {}
    }

    if (mounts.promoEl) {
      mounts.promoEl.innerHTML = `<p class="affirm-as-low-as" data-page-type="product" data-amount="4999"></p>`;
    }
    try {
      affirm.ui?.ready?.(() => affirm.ui.refresh());
      affirm.ui?.refresh?.();
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    }
    return { ok: true, details: 'affirm.ui.refresh() called' };
  },

  // ─── Afterpay promo widget ────────────────────────────────────
  async afterpay(_apm, _creds, mounts) {
    const AfterPay = window.AfterPay ?? window.Afterpay;
    if (!AfterPay) return { ok: false, reason: 'window.AfterPay not found' };
    if (mounts.promoEl) {
      mounts.promoEl.innerHTML = `<div class="afterpay-placement" data-amount="49.99" data-currency="USD"></div>`;
    }
    try {
      AfterPay?.placements?.init?.();
    } catch {}
    return { ok: true, details: 'Afterpay placements init attempted' };
  },

  // ─── Apple Pay (device API) ───────────────────────────────────
  async applepay(_apm, creds, mounts) {
    if (typeof window.ApplePaySession === 'undefined') {
      return { ok: false, reason: 'window.ApplePaySession missing (Chrome cannot render Apple Pay — Safari required)' };
    }
    const canMake = window.ApplePaySession.canMakePayments?.();
    if (mounts.buttonEl) {
      mounts.buttonEl.innerHTML = `<button class="applepay-button" type="button" style="-webkit-appearance:-apple-pay-button; -apple-pay-button-type:buy; -apple-pay-button-style:black; width:100%; height:48px;">Buy with Apple Pay</button>`;
      const btn = mounts.buttonEl.querySelector('button');
      btn?.addEventListener('click', () => {
        try {
          const request = {
            countryCode: creds.countryCode || 'US',
            currencyCode: creds.currencyCode || 'USD',
            supportedNetworks: ['visa', 'masterCard', 'amex'],
            merchantCapabilities: ['supports3DS'],
            total: { label: 'Fiserv Harness', amount: '49.99' },
          };
          const session = new window.ApplePaySession(3, request);
          session.onvalidatemerchant = async (ev) => {
            window.__harnessEmit?.('applepay_validate_merchant', { url: ev.validationURL });
            // The harness's /v2/applepay/merchant-validation is stubbed
            try {
              const resp = await fetch('/v2/applepay/merchant-validation', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ validationURL: ev.validationURL, domain: location.hostname }),
              });
              const merchantSession = await resp.json();
              session.completeMerchantValidation(merchantSession);
            } catch (err) {
              session.abort();
            }
          };
          session.begin();
        } catch (err) {
          window.__harnessEmit?.('applepay_error', { message: String(err?.message ?? err) });
        }
      });
    }
    return {
      ok: true,
      details: `ApplePaySession present. canMakePayments=${canMake}. Click the button to attempt a real session.`,
    };
  },

  // ─── Google Pay ───────────────────────────────────────────────
  async googlepay(_apm, creds, mounts) {
    const g = window.google?.payments?.api;
    if (!g) return { ok: false, reason: 'window.google.payments.api missing' };
    try {
      const client = new g.PaymentsClient({ environment: creds.environment || 'TEST' });
      const isReady = await client.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [
          {
            type: 'CARD',
            parameters: {
              allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
              allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'],
            },
            tokenizationSpecification: {
              type: 'PAYMENT_GATEWAY',
              parameters: { gateway: 'commercehub', gatewayMerchantId: creds.gatewayMerchantId || 'sandbox' },
            },
          },
        ],
      });
      if (mounts.buttonEl) {
        mounts.buttonEl.innerHTML = '';
        const btn = client.createButton({
          buttonType: 'pay',
          onClick: () => window.__harnessEmit?.('googlepay_clicked', {}),
        });
        mounts.buttonEl.appendChild(btn);
      }
      return { ok: isReady?.result === true, details: `isReadyToPay = ${JSON.stringify(isReady)}` };
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    }
  },

  async none() {
    return { ok: true, details: 'No renderer configured for this APM.' };
  },
};

// ───────────────────────────────────────────────────────────────────
// Public loader entry — inspector.js calls this with a registry entry
// + the current credentials + the mount point refs.
// ───────────────────────────────────────────────────────────────────

export async function loadProviderSdk(entry, creds, mounts) {
  const apm = entry.apm;
  const now = performance.now();
  const currency = creds.currency || 'USD';

  // Apple Pay has no CDN — just probe
  if (entry.strategy === 'applepay') {
    loadState.set(apm, { status: 'loading', error: null, durationMs: null });
    const state = typeof window.ApplePaySession !== 'undefined'
      ? { status: 'loaded', error: null, durationMs: Math.round(performance.now() - now), global: 'ApplePaySession', loadedAt: Date.now() }
      : { status: 'failed', error: 'window.ApplePaySession missing', durationMs: null, global: null, loadedAt: null };
    loadState.set(apm, state);
    const render = await RENDERERS.applepay(apm, creds, mounts);
    return { ...state, render };
  }

  if (!entry.cdnUrl) {
    const state = { status: 'skipped', error: 'No CDN URL configured', durationMs: null };
    loadState.set(apm, state);
    return { ...state, render: { ok: false, reason: 'no CDN' } };
  }

  // Template expansion
  const url = expandUrl(entry.cdnUrl, {
    clientId: creds.clientId ?? '',
    currency,
    merchantId: creds.merchantId ?? '',
    components: 'buttons,messages',
    enableFunding: '',
  });

  loadState.set(apm, { status: 'loading', error: null, durationMs: null });

  try {
    await injectScript(url);
    await pollForGlobal(entry.globalVariable, { timeoutMs: POLL_TIMEOUT_MS });
    const durationMs = Math.round(performance.now() - now);
    const state = {
      status: 'loaded',
      error: null,
      durationMs,
      global: entry.globalVariable,
      loadedAt: Date.now(),
      cdnUrl: url,
    };
    loadState.set(apm, state);

    const renderer = RENDERERS[entry.strategy] ?? RENDERERS.none;
    const render = await renderer(apm, creds, mounts);
    return { ...state, render };
  } catch (err) {
    const state = {
      status: 'failed',
      error: String(err?.message ?? err),
      durationMs: Math.round(performance.now() - now),
      cdnUrl: url,
    };
    loadState.set(apm, state);
    return { ...state, render: { ok: false, reason: state.error } };
  }
}

export function unloadProviderSdk(apm, mounts) {
  loadState.set(apm, { status: 'idle', error: null, durationMs: null });
  if (mounts?.buttonEl) mounts.buttonEl.innerHTML = '';
  if (mounts?.promoEl) mounts.promoEl.innerHTML = '';
  if (mounts?.priceTagEl) mounts.priceTagEl.innerHTML = '';
}
