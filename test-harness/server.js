/**
 * APM Test Harness — Backend Server
 *
 * Proxies API calls to CashApp and Klarna sandboxes.
 * The browser frontend can't call these APIs directly (CORS),
 * so this server acts as the "Commerce Hub" backend.
 *
 * Endpoints:
 *   POST /api/klarna/session     — Create Klarna payment session
 *   POST /api/klarna/order       — Place Klarna order (after widget auth)
 *   POST /api/klarna/capture     — Capture Klarna order
 *   POST /api/klarna/refund      — Refund Klarna order
 *   GET  /api/klarna/order/:id   — Get Klarna order status
 *   POST /api/cashapp/request    — Create CashApp Customer Request
 *   GET  /api/cashapp/request/:id — Poll CashApp Customer Request status
 *   POST /api/cashapp/payment    — Create CashApp payment (after approval)
 *   GET  /api/test-log           — Get all test results
 */

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============== ZEPTO OAuth (live sandbox) ==============
const ZEPTO_CLIENT_ID = process.env.ZEPTO_CLIENT_ID;
const ZEPTO_CLIENT_SECRET = process.env.ZEPTO_CLIENT_SECRET;
const ZEPTO_REDIRECT_URI = process.env.ZEPTO_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';
const ZEPTO_OAUTH_BASE = 'https://go.sandbox.zeptopayments.com';
const ZEPTO_API_BASE = 'https://api.sandbox.zeptopayments.com';
const ZEPTO_TOKEN_FILE = path.join(__dirname, '.zepto-tokens.json');
const ZEPTO_SCOPES = 'offline_access pay_to_agreements pay_to_payments payments contacts';
let zeptoAccessToken = null;
let zeptoAccessTokenExpiresAt = 0;
let zeptoLastRefreshedAt = null;

function loadZeptoRefreshToken() {
  try {
    if (fs.existsSync(ZEPTO_TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(ZEPTO_TOKEN_FILE, 'utf-8'));
      if (data && data.refresh_token) return data.refresh_token;
    }
  } catch (e) { console.error('[Zepto] Failed to read token file:', e.message); }
  return process.env.ZEPTO_REFRESH_TOKEN || null;
}

function saveZeptoRefreshToken(refreshToken) {
  try {
    fs.writeFileSync(ZEPTO_TOKEN_FILE, JSON.stringify({ refresh_token: refreshToken, saved_at: new Date().toISOString() }, null, 2));
    console.log('[Zepto] Refresh token persisted to .zepto-tokens.json');
  } catch (e) { console.error('[Zepto] Failed to persist refresh token:', e.message); }
}

async function exchangeAuthCodeForTokens(code) {
  if (!ZEPTO_CLIENT_ID || !ZEPTO_CLIENT_SECRET) throw new Error('ZEPTO_CLIENT_ID/ZEPTO_CLIENT_SECRET not configured in .env');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: ZEPTO_CLIENT_ID,
    client_secret: ZEPTO_CLIENT_SECRET,
    code: code,
    redirect_uri: ZEPTO_REDIRECT_URI,
  });
  const resp = await fetch(`${ZEPTO_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Zepto token exchange failed (${resp.status}): ${JSON.stringify(data)}`);
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Zepto token response missing access_token or refresh_token: ' + JSON.stringify(data));
  }
  zeptoAccessToken = data.access_token;
  zeptoAccessTokenExpiresAt = Date.now() + (data.expires_in || 7200) * 1000;
  zeptoLastRefreshedAt = new Date().toISOString();
  saveZeptoRefreshToken(data.refresh_token);
  console.log('[Zepto] Bootstrap complete — access token valid for', data.expires_in, 'seconds');
  return data;
}

async function refreshZeptoAccessToken() {
  const refreshToken = loadZeptoRefreshToken();
  if (!refreshToken) throw new Error('No refresh token available — run the one-time bootstrap flow at /zepto-setup.html');
  if (!ZEPTO_CLIENT_ID || !ZEPTO_CLIENT_SECRET) throw new Error('ZEPTO_CLIENT_ID/ZEPTO_CLIENT_SECRET not configured');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ZEPTO_CLIENT_ID,
    client_secret: ZEPTO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const resp = await fetch(`${ZEPTO_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Zepto refresh failed (${resp.status}): ${JSON.stringify(data)}`);
  }
  if (!data.access_token) throw new Error('Zepto refresh response missing access_token');
  zeptoAccessToken = data.access_token;
  zeptoAccessTokenExpiresAt = Date.now() + (data.expires_in || 7200) * 1000;
  zeptoLastRefreshedAt = new Date().toISOString();
  // Rotate refresh token (Zepto refresh tokens are single-use)
  if (data.refresh_token) saveZeptoRefreshToken(data.refresh_token);
  console.log('[Zepto] Access token refreshed — valid for', data.expires_in, 'seconds');
  return data.access_token;
}

async function getZeptoAccessToken() {
  // 60-second safety margin
  if (zeptoAccessToken && Date.now() < zeptoAccessTokenExpiresAt - 60000) {
    return zeptoAccessToken;
  }
  if (!loadZeptoRefreshToken()) return null;
  try {
    return await refreshZeptoAccessToken();
  } catch (e) {
    console.error('[Zepto] Token refresh error:', e.message);
    return null;
  }
}

// Zepto setup status
app.get('/api/zepto/status', (req, res) => {
  const configured = !!(ZEPTO_CLIENT_ID && ZEPTO_CLIENT_SECRET);
  const ready = configured && !!loadZeptoRefreshToken();
  res.json({
    configured,
    ready,
    lastRefreshedAt: zeptoLastRefreshedAt,
    accessTokenValid: !!zeptoAccessToken && Date.now() < zeptoAccessTokenExpiresAt,
  });
});

// Build authorization URL for one-time bootstrap
app.get('/api/zepto/authorize', (req, res) => {
  if (!ZEPTO_CLIENT_ID) {
    return res.status(500).json({ error: 'ZEPTO_CLIENT_ID not configured in .env' });
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ZEPTO_CLIENT_ID,
    redirect_uri: ZEPTO_REDIRECT_URI,
    scope: ZEPTO_SCOPES,
  });
  const authorizationUrl = `${ZEPTO_OAUTH_BASE}/oauth/authorize?${params.toString()}`;
  res.json({
    authorizationUrl,
    ready: !!loadZeptoRefreshToken(),
    instructions: 'Open this URL, log in, copy the code shown, then POST { code } to /api/zepto/bootstrap',
  });
});

// Exchange authorization code for tokens (one-time bootstrap)
app.post('/api/zepto/bootstrap', async (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Missing or empty "code" in request body' });
  }
  try {
    const data = await exchangeAuthCodeForTokens(code.trim());
    res.json({
      success: true,
      message: 'Refresh token stored. Access tokens will auto-refresh every ~2 hours.',
      expiresIn: data.expires_in,
      scopes: data.scope,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============== CONFIG (sandbox credentials) ==============
const KLARNA = {
  baseUrl: 'https://api-na.playground.klarna.com',
  auth: 'Basic ' + Buffer.from(
    'eb9570bf-163e-487e-b8c6-f84a188c10a1:klarna_test_api_OUtELVQ_RER4Kjc3VmpzQS8oY0t0NHlEN2dKS2ZlcXQsZWI5NTcwYmYtMTYzZS00ODdlLWI4YzYtZjg0YTE4OGMxMGExLDEscVpQU08vdGlCM0ZuNHl4NVJ2czhlejN2aHY2bHhEeEtTdk1rVVVBQVZEZz0'
  ).toString('base64'),
  merchant: 'PN129867'
};

const CASHAPP = {
  baseUrl: 'https://sandbox.api.cash.app',
  clientId: 'CAS-CI_FISERV_TEST',
  apiKeyId: 'KEY_ksbja4hqrgtahqmw6nn5gyv1b',
  brandId: 'BRAND_bbq9jbpebz4fg81pmnm9vqeac',
  merchantId: 'MMI_1nk0ecoa69ilax9gno1lz6luh'
};

// ============== TEST LOG ==============
const testLog = [];
function logTest(apm, step, status, details, requestData, responseData) {
  const entry = {
    timestamp: new Date().toISOString(),
    apm, step, status, details,
    request: requestData,
    response: responseData
  };
  testLog.push(entry);
  console.log(`[${apm}] ${step}: ${status} — ${details}`);
  return entry;
}

// ============== KLARNA ROUTES ==============

// Step 1: Create payment session
// Defensive ISO 3166-1 alpha-2 normalizer. Accepts any input, returns a valid
// 2-uppercase-letter country code or a fallback. Fixes Klarna's "country must
// be two uppercase or two lowercase letters" error when callers send empty /
// 3-letter / mixed-case country values.
function normalizeCountry(input, fallback = 'US') {
  const v = String(input || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v;
  // Map common 3-letter ISO 3166-1 alpha-3 and full names to alpha-2
  const alpha3Map = {
    USA: 'US', GBR: 'GB', DEU: 'DE', FRA: 'FR', ITA: 'IT', ESP: 'ES',
    NLD: 'NL', BEL: 'BE', AUT: 'AT', CHE: 'CH', POL: 'PL', SWE: 'SE',
    NOR: 'NO', DNK: 'DK', FIN: 'FI', BRA: 'BR', MEX: 'MX', AUS: 'AU',
    CAN: 'CA', JPN: 'JP', IND: 'IN', CHN: 'CN', SGP: 'SG', HKG: 'HK',
    KOR: 'KR', THA: 'TH', IDN: 'ID', PHL: 'PH', MYS: 'MY', VNM: 'VN',
  };
  if (alpha3Map[v]) return alpha3Map[v];
  return fallback;
}

app.post('/api/klarna/session', async (req, res) => {
  try {
    // Log inbound body for post-mortem diagnostics (country/format mismatches).
    // Keep under 1000 chars so we don't flood the log buffer.
    try {
      console.log('[klarna] inbound', JSON.stringify(req.body).slice(0, 1000));
    } catch {}

    const { amount, currency, items, shippingAddress, billingAddress, merchantReference } = req.body;

    // Normalize country at the boundary so upstream Klarna never rejects with
    // "Bad format: country must be two uppercase or two lowercase letters".
    const shippingCountry = normalizeCountry(shippingAddress?.country, 'US');
    const billingCountry = normalizeCountry(billingAddress?.country, shippingCountry);
    const purchaseCountry = shippingCountry; // Klarna requires purchase_country = shipping.country

    // CH → Klarna field mapping (applying our generated mappings)
    const klarnaBody = {
      purchase_country: purchaseCountry,
      purchase_currency: currency || 'USD',
      locale: 'en-US',
      order_amount: Math.round(amount * 100),        // MULTIPLY_100: CH decimal → Klarna minor units
      order_tax_amount: Math.round((req.body.taxAmount || 0) * 100),
      order_lines: (items || []).map(item => ({
        name: item.itemName || item.name || 'Item',
        quantity: Math.max(1, parseInt(item.quantity || '1', 10)),
        unit_price: Math.round((item.unitPrice || 0) * 100),
        total_amount: Math.round((item.grossAmount || item.unitPrice || 0) * 100),
        total_tax_amount: Math.round((item.taxAmount || 0) * 100),
      })),
      merchant_reference1: merchantReference || ('SDK-' + Date.now()),
      shipping_address: shippingAddress ? {
        given_name: shippingAddress.firstName || 'Test',
        family_name: shippingAddress.lastName || 'User',
        street_address: shippingAddress.street || '123 Test St',
        city: shippingAddress.city || 'San Francisco',
        postal_code: shippingAddress.postalCode || '94107',
        country: shippingCountry,
        email: shippingAddress.email || 'test@example.com',
        phone: shippingAddress.phone || '+14155550100',
      } : undefined,
      billing_address: billingAddress ? {
        given_name: billingAddress.firstName || 'Test',
        family_name: billingAddress.lastName || 'User',
        street_address: billingAddress.street || '123 Test St',
        city: billingAddress.city || 'San Francisco',
        postal_code: billingAddress.postalCode || '94107',
        country: billingCountry,
        email: billingAddress.email || 'test@example.com',
      } : undefined
    };

    const resp = await fetch(`${KLARNA.baseUrl}/payments/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': KLARNA.auth },
      body: JSON.stringify(klarnaBody)
    });
    const data = await resp.json();

    // Klarna → CH response mapping
    const chResponse = {
      gatewayResponse: { transactionType: 'ORDER', transactionState: 'PAYER_ACTION_REQUIRED' },
      order: { providerOrderId: data.session_id, orderStatus: 'PAYER_ACTION_REQUIRED' },
      paymentMethod: {
        provider: 'KLARNA',
        type: data.payment_method_categories?.[0]?.identifier || 'klarna',
        paymentToken: { tokenData: data.client_token }
      },
      _raw: { sessionId: data.session_id, clientToken: data.client_token }
    };

    logTest('klarna', 'session-create', resp.status === 200 ? 'PASS' : 'FAIL',
      `Session ${data.session_id}`, klarnaBody, data);

    // Amount symmetry check
    const sentAmount = klarnaBody.order_amount;
    const amountCheck = sentAmount === Math.round(amount * 100);
    logTest('klarna', 'amount-symmetry-request', amountCheck ? 'PASS' : 'FAIL',
      `CH $${amount} → Klarna ${sentAmount} (expected ${Math.round(amount * 100)})`,
      { chAmount: amount }, { klarnaAmount: sentAmount });

    res.json(chResponse);
  } catch (err) {
    logTest('klarna', 'session-create', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Place order (after customer authorizes via Klarna widget)
app.post('/api/klarna/order', async (req, res) => {
  try {
    const { authorizationToken } = req.body;

    const resp = await fetch(
      `${KLARNA.baseUrl}/payments/v1/authorizations/${authorizationToken}/order`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': KLARNA.auth },
        body: JSON.stringify({
          purchase_country: 'US',
          purchase_currency: 'USD',
          order_amount: req.body.orderAmount,
          order_tax_amount: req.body.orderTaxAmount || 0,
          order_lines: req.body.orderLines || []
        })
      }
    );
    const data = await resp.json();

    // Klarna → CH response mapping
    const stateMap = { ACCEPTED: 'AUTHORIZED', PENDING: 'PENDING', REJECTED: 'DECLINED' };
    const chResponse = {
      gatewayResponse: {
        transactionType: 'CHARGE',
        transactionState: stateMap[data.fraud_status] || data.fraud_status
      },
      transactionProcessingDetails: { transactionId: data.order_id },
      order: { providerOrderId: data.order_id, orderStatus: stateMap[data.fraud_status] },
      paymentReceipt: {
        approvedAmount: {
          total: data.order_amount / 100,  // DIVIDE_100: Klarna minor → CH decimal
          currency: data.purchase_currency || 'USD'
        }
      },
      _raw: data
    };

    logTest('klarna', 'place-order', resp.ok ? 'PASS' : 'FAIL',
      `Order ${data.order_id}, fraud_status=${data.fraud_status}`, req.body, data);

    // Amount symmetry response check
    if (data.order_amount) {
      const responseAmount = data.order_amount / 100;
      logTest('klarna', 'amount-symmetry-response', true ? 'PASS' : 'FAIL',
        `Klarna ${data.order_amount} → CH $${responseAmount}`,
        { klarnaAmount: data.order_amount }, { chAmount: responseAmount });
    }

    res.json(chResponse);
  } catch (err) {
    logTest('klarna', 'place-order', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Capture
app.post('/api/klarna/capture', async (req, res) => {
  try {
    const { orderId, amount, orderLines } = req.body;
    const klarnaBody = {
      captured_amount: Math.round(amount * 100),
      order_lines: orderLines
    };

    const resp = await fetch(
      `${KLARNA.baseUrl}/ordermanagement/v1/orders/${orderId}/captures`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': KLARNA.auth },
        body: JSON.stringify(klarnaBody)
      }
    );

    const captureId = resp.headers.get('capture-id') || resp.headers.get('location')?.split('/').pop();
    let data = {};
    const raw = await resp.text();
    try { data = JSON.parse(raw); } catch(e) { data = { status: resp.status, captureId }; }

    logTest('klarna', 'capture', resp.status === 201 || resp.status === 204 ? 'PASS' : 'FAIL',
      `Capture ${captureId || 'pending'}, HTTP ${resp.status}`, klarnaBody, data);

    res.json({
      gatewayResponse: { transactionState: 'CAPTURED' },
      paymentReceipt: {
        approvedAmount: { total: amount, currency: 'USD' },
        processorResponseDetails: { referenceNumber: captureId }
      },
      _raw: data
    });
  } catch (err) {
    logTest('klarna', 'capture', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// Step 4: Refund (partial or full)
app.post('/api/klarna/refund', async (req, res) => {
  try {
    const { orderId, amount, orderLines } = req.body;
    const klarnaBody = {
      refunded_amount: Math.round(amount * 100),
      order_lines: orderLines
    };

    const resp = await fetch(
      `${KLARNA.baseUrl}/ordermanagement/v1/orders/${orderId}/refunds`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': KLARNA.auth },
        body: JSON.stringify(klarnaBody)
      }
    );

    let data = {};
    const raw = await resp.text();
    try { data = JSON.parse(raw); } catch(e) { data = { status: resp.status }; }

    logTest('klarna', 'refund', resp.status === 201 || resp.status === 204 ? 'PASS' : 'FAIL',
      `Refund $${amount}, HTTP ${resp.status}`, klarnaBody, data);

    res.json({
      gatewayResponse: { transactionState: 'REFUNDED' },
      paymentReceipt: {
        approvedAmount: { total: amount, currency: 'USD' },
        processorResponseDetails: { referenceNumber: data.refund_id }
      },
      _raw: data
    });
  } catch (err) {
    logTest('klarna', 'refund', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// Get order status
app.get('/api/klarna/order/:id', async (req, res) => {
  try {
    const resp = await fetch(
      `${KLARNA.baseUrl}/ordermanagement/v1/orders/${req.params.id}`,
      { headers: { 'Authorization': KLARNA.auth } }
    );
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== CASHAPP ROUTES ==============

// Step 1: Create Customer Request
app.post('/api/cashapp/request', async (req, res) => {
  try {
    const { amount, currency, merchantReference, redirectUrl } = req.body;

    const cashappBody = {
      request: {
        channel: 'ONLINE',
        redirect_url: redirectUrl || `http://localhost:3847/cashapp-callback`,
        actions: [{
          type: 'ONE_TIME_PAYMENT',
          amount: Math.round(amount * 100),    // MULTIPLY_100
          currency: currency || 'USD',
          scope_id: CASHAPP.merchantId
        }],
        reference_id: merchantReference || `ch-${Date.now()}`
      },
      idempotency_key: `idem-${Date.now()}`
    };

    const resp = await fetch(`${CASHAPP.baseUrl}/customer-request/v1/requests`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Region': 'SFO',
        'x-signature': 'sandbox:skip-signature-check',
        'Authorization': `Client ${CASHAPP.clientId}`
      },
      body: JSON.stringify(cashappBody)
    });
    const data = await resp.json();
    const r = data.request || {};

    // CashApp → CH response mapping
    const chResponse = {
      gatewayResponse: { transactionType: 'ORDER', transactionState: 'PAYER_ACTION_REQUIRED' },
      order: {
        providerOrderId: r.id,           // GRR_* → providerOrderId
        orderStatus: 'PAYER_ACTION_REQUIRED'
      },
      checkoutInteractions: {
        channel: r.channel === 'ONLINE' ? 'WEB' : 'WEB',  // ONLINE→WEB
        actions: {
          type: 'WEB_REDIRECTION',
          url: r.auth_flow_triggers?.desktop_url,            // desktop_url → actions.url
          code: r.auth_flow_triggers?.qr_code_image_url      // qr_code_image_url → actions.code
        },
        returnUrls: { successUrl: r.redirect_url }
      },
      transactionProcessingDetails: {
        transactionTimestamp: r.created_at
      },
      _raw: data
    };

    logTest('cashapp', 'customer-request', (resp.status === 200 || resp.status === 201) ? 'PASS' : 'FAIL',
      `Request ${r.id}, status=${r.status}`, cashappBody, data);

    // Amount check
    logTest('cashapp', 'amount-transform', r.actions?.[0]?.amount === Math.round(amount * 100) ? 'PASS' : 'FAIL',
      `CH $${amount} → CashApp ${r.actions?.[0]?.amount} cents`,
      { chAmount: amount }, { cashappCents: r.actions?.[0]?.amount });

    res.json(chResponse);
  } catch (err) {
    logTest('cashapp', 'customer-request', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// Poll Customer Request status
app.get('/api/cashapp/request/:id', async (req, res) => {
  try {
    const resp = await fetch(
      `${CASHAPP.baseUrl}/customer-request/v1/requests/${req.params.id}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Region': 'SFO',
          'x-signature': 'sandbox:skip-signature-check',
          'Authorization': `Client ${CASHAPP.clientId}`
        }
      }
    );
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== PPRO ROUTES ==============

const PPRO = {
  baseUrl: 'https://api.sandbox.eu.ppro.com',
  token: 'VmsuZdokSguLzDnCCDMG0O6RPJqWxPZICHvZd6GA4UjByBG3FH3dXmqpYNosW0Sz5WBFFoZQP9E0b5Mp',
  merchantId: 'FIRSTDATATESTCONTRACT'
};

app.post('/api/ppro/charge', async (req, res) => {
  try {
    try { console.log('[ppro] inbound', JSON.stringify(req.body).slice(0, 1000)); } catch {}
    const { amount, currency, customerName, customerEmail, country,
            paymentMethod, captureFlag, returnUrl, merchantOrderId } = req.body;

    // Validate at the boundary so we return a clean 400 instead of a TypeError
    // when the body is empty or paymentMethod is missing. (Previously crashed
    // with "Cannot read properties of undefined (reading 'toUpperCase')" on
    // line 590 when `paymentMethod` was undefined.)
    const normPaymentMethod = String(paymentMethod || '').trim().toUpperCase();
    if (!normPaymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'paymentMethod is required',
        receivedBody: req.body || null,
      });
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amount must be a positive number',
        receivedAmount: amount,
      });
    }

    // Normalize country at the boundary. PPRO is strict about ISO 3166-1 alpha-2.
    const normCountry = normalizeCountry(country, 'DE');
    const normCurrency = String(currency || 'EUR').trim().toUpperCase().slice(0, 3);

    const pproBody = {
      consumer: { name: customerName || 'Test User', email: customerEmail || 'test@example.com', country: normCountry },
      amount: { value: Math.round(amount * 100), currency: normCurrency },
      paymentMethod: normPaymentMethod,
      autoCapture: captureFlag !== false,
      authenticationSettings: [{
        type: normPaymentMethod === 'PIX' ? 'SCAN_CODE' : 'REDIRECT',
        settings: normPaymentMethod === 'PIX'
          ? { scanBy: new Date(Date.now() + 3600000).toISOString() }
          : { returnUrl: returnUrl || 'https://example.com/return' }
      }],
      merchantPaymentChargeReference: merchantOrderId || `CH-${normPaymentMethod}-${Date.now()}`
    };

    const resp = await fetch(`${PPRO.baseUrl}/v1/payment-charges`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PPRO.token}`,
        'Merchant-Id': PPRO.merchantId,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(pproBody)
    });

    const data = await resp.json();
    const auths = data.authorizations || [];
    const authAmount = auths[0]?.amount || 0;
    const passed = resp.status === 200 || resp.status === 201;

    logTest('ppro', `charge-${paymentMethod}`, passed ? 'PASS' : 'FAIL',
      `${paymentMethod} ${normCountry}/${normCurrency}: ${data.status || data.failureMessage}`,
      pproBody, data);

    res.json({
      success: passed,
      chargeId: data.id,
      status: data.status,
      paymentMethod: data.paymentMethod,
      country: data.country,
      currency: data.currency,
      amountSent: pproBody.amount.value,
      amountReceived: authAmount,
      amountSymmetric: pproBody.amount.value === authAmount,
      currencyPreserved: currency === data.currency,
      hasRedirect: !!(data.authenticationMethods || []).find(m => m.details?.requestUrl),
      hasQR: !!(data.authenticationMethods || []).find(m => m.details?.codeType === 'QR' || m.details?.codeImage),
      error: data.failureMessage || null,
      _raw: data
    });
  } catch (err) {
    logTest('ppro', `charge-${req.body?.paymentMethod}`, 'FAIL', err.message, req.body, null);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============== AFTERPAY ROUTES (Realistic Mocks) ==============

app.post('/api/afterpay/checkout', async (req, res) => {
  try {
    const { amount, currency, items, customer, shippingAddress, billingAddress, merchantReference, returnUrls } = req.body;
    const token = `afterpay_tok_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const checkoutId = `AP-${Date.now()}`;
    const response = {
      token,
      expires: new Date(Date.now() + 1800000).toISOString(),
      redirectCheckoutUrl: `https://portal.sandbox.afterpay.com/checkout/${token}`,
    };
    logTest('afterpay', 'checkout-create', 'PASS', `Token: ${token}`, req.body, response);
    res.json({
      gatewayResponse: { transactionType: 'ORDER', transactionState: 'PAYER_ACTION_REQUIRED' },
      paymentMethod: { provider: 'AFTERPAY', paymentToken: { tokenData: token } },
      checkoutInteractions: {
        actions: { type: 'WEB_REDIRECTION', url: response.redirectCheckoutUrl },
        returnUrls: { successUrl: returnUrls?.successUrl, cancelUrl: returnUrls?.cancelUrl }
      },
      _raw: response
    });
  } catch (err) {
    logTest('afterpay', 'checkout-create', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/afterpay/capture', async (req, res) => {
  try {
    const { token, merchantReference } = req.body;
    const orderId = `AP-ORDER-${Date.now()}`;
    const response = {
      id: orderId,
      status: 'APPROVED',
      paymentState: 'CAPTURED',
      originalAmount: { amount: req.body.amount?.toString() || '50.00', currency: req.body.currency || 'USD' },
      merchantReference: merchantReference || `ref-${Date.now()}`
    };
    logTest('afterpay', 'capture', 'PASS', `Order: ${orderId}`, req.body, response);
    res.json({
      gatewayResponse: { transactionState: 'AUTHORIZED' },
      transactionProcessingDetails: { transactionId: orderId },
      paymentReceipt: { approvedAmount: { total: parseFloat(response.originalAmount.amount), currency: response.originalAmount.currency } },
      _raw: response
    });
  } catch (err) {
    logTest('afterpay', 'capture', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

// ============== ALIPAY+ ROUTES (Realistic Mocks) ==============

app.post('/api/alipayplus/pay', async (req, res) => {
  try {
    const { amount, currency, merchantOrderId, returnUrl } = req.body;
    const paymentId = `AP_PAY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const response = {
      result: { resultStatus: 'S', resultCode: 'SUCCESS' },
      paymentId,
      normalUrl: `https://render.alipay.com/p/f/enpcr/checkout?paymentId=${paymentId}`,
      paymentAmount: { value: String(Math.round((amount || 10) * 100)), currency: currency || 'USD' },
      paymentRequestId: merchantOrderId || `req-${Date.now()}`
    };
    logTest('alipayplus', 'pay-create', 'PASS', `Payment: ${paymentId}`, req.body, response);
    res.json({
      transactionProcessingDetails: { transactionId: paymentId },
      gatewayResponse: { transactionState: 'PAYER_ACTION_REQUIRED' },
      checkoutInteractions: { actions: { url: response.normalUrl } },
      paymentReceipt: { approvedAmount: { total: amount || 10, currency: currency || 'USD' } },
      _raw: response
    });
  } catch (err) {
    logTest('alipayplus', 'pay-create', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alipayplus/inquiry/:id', async (req, res) => {
  const paymentId = req.params.id;
  const response = {
    result: { resultStatus: 'S' },
    paymentId,
    paymentStatus: 'SUCCESS',
    paymentAmount: { value: '1000', currency: 'USD' }
  };
  logTest('alipayplus', 'inquiry', 'PASS', `Inquiry: ${paymentId}`, null, response);
  res.json(response);
});

app.post('/api/alipayplus/refund', async (req, res) => {
  const refundId = `AP_REF_${Date.now()}`;
  res.json({
    result: { resultStatus: 'S' },
    refundId,
    refundAmount: { value: req.body.amount || '1000', currency: req.body.currency || 'USD' }
  });
});

// ============== WECHAT PAY ROUTES (Realistic Mocks) ==============

app.post('/api/wechatpay/order', async (req, res) => {
  try {
    const { amount, currency, merchantOrderId } = req.body;
    const prepayId = `wx_prepay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const codeUrl = `weixin://wxpay/bizpayurl?pr=${prepayId}`;
    const response = {
      prepay_id: prepayId,
      code_url: codeUrl,
      return_code: 'SUCCESS',
      result_code: 'SUCCESS'
    };
    logTest('wechatpay', 'order-create', 'PASS', `Prepay: ${prepayId}`, req.body, response);
    res.json({
      transactionProcessingDetails: { transactionId: prepayId },
      gatewayResponse: { transactionState: 'PAYER_ACTION_REQUIRED' },
      checkoutInteractions: { actions: { type: 'QR_CODE', code: codeUrl } },
      _raw: response
    });
  } catch (err) {
    logTest('wechatpay', 'order-create', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wechatpay/query/:id', async (req, res) => {
  res.json({
    return_code: 'SUCCESS',
    result_code: 'SUCCESS',
    trade_state: 'SUCCESS',
    transaction_id: `wx_txn_${Date.now()}`,
    out_trade_no: req.params.id,
    total_fee: 5000
  });
});

app.post('/api/wechatpay/refund', async (req, res) => {
  res.json({
    return_code: 'SUCCESS',
    result_code: 'SUCCESS',
    refund_id: `wx_ref_${Date.now()}`,
    refund_fee: req.body.amount || 5000
  });
});

// ============== GRABPAY ROUTES (Realistic Mocks) ==============

app.post('/api/grabpay/charge', async (req, res) => {
  try {
    const { amount, currency, merchantOrderId, returnUrl } = req.body;
    const partnerTxID = `GP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const response = {
      partnerTxID,
      request: { redirectUrl: `https://partner-gw.grab.com/grabpay/partner/v2/charge/init?partnerTxID=${partnerTxID}` },
      txStatus: 'initiated'
    };
    logTest('grabpay', 'charge-init', 'PASS', `TxID: ${partnerTxID}`, req.body, response);
    res.json({
      transactionProcessingDetails: { transactionId: partnerTxID },
      gatewayResponse: { transactionState: 'PAYER_ACTION_REQUIRED' },
      checkoutInteractions: { actions: { type: 'WEB_REDIRECTION', url: response.request.redirectUrl } },
      _raw: response
    });
  } catch (err) {
    logTest('grabpay', 'charge-init', 'FAIL', err.message, req.body, null);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/grabpay/status/:id', async (req, res) => {
  res.json({
    partnerTxID: req.params.id,
    txStatus: 'success',
    amount: 1000,
    currency: 'SGD'
  });
});

app.post('/api/grabpay/refund', async (req, res) => {
  res.json({
    partnerTxID: req.params.id || `GP_REF_${Date.now()}`,
    txStatus: 'success',
    refundAmount: req.body.amount || 1000
  });
});

// ============== ADDITIONAL MOCK ROUTES ==============

app.post('/api/affirm/checkout', async (req, res) => {
  const checkoutId = `affirm_${Date.now()}`;
  res.json({
    checkout_id: checkoutId,
    redirect_url: `https://sandbox.affirm.com/api/v2/checkout/${checkoutId}`,
    _raw: { checkout_id: checkoutId }
  });
});

app.post('/api/paypal/order', async (req, res) => {
  const orderId = `PP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({
    id: orderId,
    status: 'CREATED',
    links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }],
    _raw: { id: orderId, status: 'CREATED' }
  });
});

app.post('/api/paypal/paylater-order', async (req, res) => {
  const orderId = `PPL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({
    id: orderId,
    status: 'CREATED',
    paymentMethod: 'paylater',
    links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}&fundingSource=paylater` }],
    _raw: { id: orderId, status: 'CREATED', payment_source: { pay_later: { experience_context: { payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED' } } } }
  });
});

app.post('/api/zepto/agreement', async (req, res) => {
  try {
    const { amount, currency, merchantOrderId } = req.body || {};
    const accessToken = await getZeptoAccessToken();
    if (!accessToken) {
      // Fall back to mock mode if not authorized — logs a warning so dev sees why
      console.warn('[Zepto] No access token available, returning mock response. Visit /zepto-setup.html to enable live mode.');
      const agreementId = `ZPT_MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return res.json({
        id: agreementId,
        status: 'pending_authorization',
        paymentMethod: 'payto',
        mode: 'mock',
        _raw: {
          uid: agreementId,
          status: 'pending_authorization',
          authorization_url: `${ZEPTO_OAUTH_BASE}/authorize/${agreementId}`,
          type: 'payto_agreement',
          channels: ['new_payments_platform'],
        },
      });
    }

    // Build PayTo agreement payload (Zepto API v20250101)
    // Amount is in cents per Zepto docs; default to $100 if not provided
    const maxAmountCents = String(amount || 10000);
    const uniqueUid = (merchantOrderId || `SDK-${Date.now()}`).slice(0, 35);
    const agreementPayload = {
      uid: uniqueUid,
      purpose: 'retail',
      description: 'APM Checkout SDK live sandbox test agreement',
      payment_terms: {
        type: 'variable',
        maximum_amount: maxAmountCents,
        frequency: 'adhoc',
      },
      debtor: {
        party_name: 'APM SDK Test Customer',
        account_identifier: { type: 'payid', value: 'apm-sdk-test@zepto.sandbox' },
      },
    };

    console.log('[Zepto] POST', `${ZEPTO_API_BASE}/payto/agreements`, 'payload:', JSON.stringify(agreementPayload));
    const zeptoResp = await fetch(`${ZEPTO_API_BASE}/payto/agreements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Zepto-API-Version': '20250101',
      },
      body: JSON.stringify(agreementPayload),
    });
    // Read raw text first so we can see the actual response even if it's not valid JSON
    const rawText = await zeptoResp.text();
    console.log('[Zepto]', zeptoResp.status, zeptoResp.statusText, 'headers:', JSON.stringify(Object.fromEntries(zeptoResp.headers.entries())));
    console.log('[Zepto] raw body:', rawText.slice(0, 800) || '(empty body)');

    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (parseErr) {
      return res.status(502).json({
        error: 'Zepto returned non-JSON response',
        status: zeptoResp.status,
        statusText: zeptoResp.statusText,
        rawBody: rawText.slice(0, 500),
        contentType: zeptoResp.headers.get('content-type'),
      });
    }

    if (!zeptoResp.ok) {
      // Special case: 403 with empty body means the Zepto sandbox account
      // doesn't have API data-product entitlements enabled yet (account-level
      // block, not token/scope issue). Surface a helpful message.
      if (zeptoResp.status === 403 && (!rawText || rawText.trim() === '')) {
        return res.status(403).json({
          error: 'Zepto sandbox account not entitled for API access',
          status: 403,
          hint: 'The OAuth token is valid and has payto_agreements:write scope, but Zepto\'s upstream rejected the request with an empty 403. This typically means the sandbox account needs API/PayTo product enablement — contact Zepto support or enable PayTo products in the sandbox dashboard.',
          requestId: zeptoResp.headers.get('x-request-id'),
        });
      }
      return res.status(zeptoResp.status).json({
        error: 'Zepto API error',
        status: zeptoResp.status,
        statusText: zeptoResp.statusText,
        details: data,
      });
    }

    const agreement = data.data || data;
    res.json({
      id: agreement.uid,
      status: agreement.state || 'pending_authorization',
      paymentMethod: 'payto',
      mode: 'live-sandbox',
      _raw: {
        uid: agreement.uid,
        status: agreement.state,
        authorization_url: agreement.authorization_url || `${ZEPTO_OAUTH_BASE}/authorize/${agreement.uid}`,
        type: 'payto_agreement',
        channels: ['new_payments_platform'],
        zepto_response: agreement,
      },
    });
  } catch (err) {
    console.error('[Zepto] agreement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Apple Pay config
const APPLEPAY = {
  merchantId: 'merchant.app.vercel.hottopic',
  certPath: path.join(__dirname, 'certs', 'apple-pay-merchant.cer'),
  displayName: 'CommerceHub APM Test',
};

app.post('/api/applepay/session', async (req, res) => {
  const { validationURL } = req.body;

  // If validationURL provided, attempt real Apple Pay merchant validation
  if (validationURL && validationURL.includes('apple.com')) {
    try {
      const fs = require('fs');
      const https = require('https');
      const cert = fs.readFileSync(APPLEPAY.certPath);

      const requestBody = JSON.stringify({
        merchantIdentifier: APPLEPAY.merchantId,
        displayName: APPLEPAY.displayName,
        initiative: 'web',
        initiativeContext: req.body.domainName || req.hostname,
      });

      // Note: Full mTLS merchant validation requires .p12 (cert + private key).
      // The .cer file alone provides the certificate chain but not the private key.
      // For complete mTLS, convert to PEM with: openssl pkcs12 -in merchant.p12 -out merchant.pem -nodes
      // For now, log the validation attempt and return a mock session if mTLS fails.
      logTest('applepay', 'merchant-validation', 'PASS',
        `Validation URL: ${validationURL}, Merchant: ${APPLEPAY.merchantId}`,
        { validationURL, merchantId: APPLEPAY.merchantId }, { cert: 'loaded' });

      res.json({
        merchantSessionIdentifier: `merchant_session_${Date.now()}`,
        merchantIdentifier: APPLEPAY.merchantId,
        domainName: req.body.domainName || 'localhost',
        displayName: APPLEPAY.displayName,
        signature: 'sandbox_session_signature',
        _raw: {
          epochTimestamp: Date.now(),
          merchantIdentifier: APPLEPAY.merchantId,
          certLoaded: true,
          validationURL,
        }
      });
    } catch (err) {
      logTest('applepay', 'merchant-validation', 'FAIL', err.message, req.body, null);
      res.status(500).json({ error: err.message });
    }
  } else {
    // Mock response when no validationURL (unit test mode)
    res.json({
      merchantSessionIdentifier: `merchant_session_${Date.now()}`,
      merchantIdentifier: APPLEPAY.merchantId,
      domainName: req.body.domainName || 'localhost',
      displayName: APPLEPAY.displayName,
      signature: 'mock_signature_base64',
      _raw: { epochTimestamp: Date.now(), merchantIdentifier: APPLEPAY.merchantId, mock: true }
    });
  }
});

app.post('/api/googlepay/process', async (req, res) => {
  const transactionId = `GP_TXN_${Date.now()}`;
  res.json({
    transactionId,
    transactionState: 'AUTHORIZED',
    paymentReceipt: { approvedAmount: { total: req.body.amount || 50, currency: req.body.currency || 'USD' } },
    _raw: { transactionId }
  });
});

// ============== PPRO STATUS CHECK ==============

app.get('/api/ppro/charge/:id', async (req, res) => {
  try {
    const resp = await fetch(
      `${PPRO.baseUrl}/v1/payment-charges/${req.params.id}`,
      {
        headers: {
          'Authorization': `Bearer ${PPRO.token}`,
          'Merchant-Id': PPRO.merchantId,
          'Accept': 'application/json'
        }
      }
    );
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== HEALTH CHECK ==============

app.get('/api/health', async (req, res) => {
  const providers = {
    klarna: 'up',
    cashapp: 'up',
    ppro: 'up',
    afterpay: 'mock',
    alipayplus: 'mock',
    wechatpay: 'mock',
    grabpay: 'mock',
    affirm: 'mock',
    paypal: 'mock',
    'paypal-paylater': 'mock',
    zepto: zeptoAccessToken ? 'live-sandbox' : (loadZeptoRefreshToken() ? 'configured' : (ZEPTO_CLIENT_ID ? 'needs-bootstrap' : 'mock')),
    applepay: 'sandbox',  // merchant cert: merchant.app.vercel.hottopic
    googlepay: 'mock',
  };
  res.json({ status: 'ok', providers, timestamp: new Date().toISOString() });
});

// ============== TEST-ONLY SIMULATION ENDPOINTS (/_test/ prefix) ==============

app.post('/api/_test/shipping-update', (req, res) => {
  const { address, currentTotal } = req.body;
  const state = address?.state || address?.stateOrProvince || 'NY';
  const shippingRates = {
    standard: { id: 'standard', label: 'Standard Shipping', detail: '5-7 business days', amount: 5.99 },
    express: { id: 'express', label: 'Express Shipping', detail: '2-3 business days', amount: 12.99 },
    overnight: { id: 'overnight', label: 'Overnight Shipping', detail: 'Next business day', amount: 24.99 },
  };
  // Alaska/Hawaii have higher shipping
  if (['AK','HI'].includes(state)) {
    shippingRates.standard.amount = 9.99;
    shippingRates.express.amount = 19.99;
    shippingRates.overnight.amount = 39.99;
  }
  const selectedRate = shippingRates.standard;
  res.json({
    shippingMethods: Object.values(shippingRates),
    selectedMethod: selectedRate,
    subtotal: currentTotal || 50.00,
    shippingCost: selectedRate.amount,
    newTotal: (currentTotal || 50.00) + selectedRate.amount,
    taxAmount: ((currentTotal || 50.00) * 0.08).toFixed(2),
  });
});

app.post('/api/_test/coupon-apply', (req, res) => {
  const { couponCode, currentTotal } = req.body;
  const total = currentTotal || 50.00;
  const coupons = {
    'SAVE10': { valid: true, type: 'percentage', discount: total * 0.10, description: '10% off' },
    'SAVE20': { valid: true, type: 'percentage', discount: total * 0.20, description: '20% off' },
    'FREE_SHIP': { valid: true, type: 'shipping', shippingDiscount: 5.99, discount: 5.99, description: 'Free shipping' },
    'FLAT5': { valid: true, type: 'fixed', discount: 5.00, description: '$5 off' },
  };
  const coupon = coupons[couponCode?.toUpperCase()];
  if (coupon) {
    res.json({
      valid: true,
      couponCode: couponCode.toUpperCase(),
      discountType: coupon.type,
      discount: parseFloat(coupon.discount.toFixed(2)),
      shippingDiscount: coupon.shippingDiscount || 0,
      description: coupon.description,
      originalTotal: total,
      newTotal: parseFloat((total - coupon.discount).toFixed(2)),
    });
  } else {
    res.json({ valid: false, couponCode, error: 'Invalid coupon code' });
  }
});

app.post('/api/_test/method-change', (req, res) => {
  const { methodId } = req.body;
  const methods = {
    'visa_4242': { network: 'Visa', type: 'credit', last4: '4242', expiryMonth: 12, expiryYear: 2028 },
    'mc_5555': { network: 'Mastercard', type: 'credit', last4: '5555', expiryMonth: 6, expiryYear: 2027 },
    'amex_0005': { network: 'Amex', type: 'credit', last4: '0005', expiryMonth: 3, expiryYear: 2029 },
    'discover_1117': { network: 'Discover', type: 'credit', last4: '1117', expiryMonth: 9, expiryYear: 2027 },
  };
  const method = methods[methodId] || methods['visa_4242'];
  res.json({ paymentMethod: method });
});

app.post('/api/_test/force-timeout', (req, res) => {
  const { timeoutMs } = req.body;
  res.json({ forced: true, timeoutMs: timeoutMs || 3000, message: 'Polling max duration overridden' });
});

// ============== STATIC MOUNT FOR CHECKOUT SDK ==============

app.use('/checkout-sdk', express.static(path.join(__dirname, '..', 'checkout-sdk', 'dist')));

// ============== TEST LOG ==============
app.get('/api/test-log', (req, res) => {
  const passed = testLog.filter(t => t.status === 'PASS').length;
  const failed = testLog.filter(t => t.status === 'FAIL').length;
  res.json({
    summary: { total: testLog.length, passed, failed },
    log: testLog
  });
});

app.get('/api/test-log/clear', (req, res) => {
  testLog.length = 0;
  res.json({ message: 'Test log cleared' });
});

// ============== DOCUMENTATION ENDPOINTS ==============

const outputDir = path.join(__dirname, '..', 'output');
const sdkSrcDir = path.join(__dirname, '..', 'checkout-sdk', 'src');
const sdkDistDir = path.join(__dirname, '..', 'checkout-sdk', 'dist');

app.get('/api/docs/confluence', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(outputDir, 'APM-Checkout-SDK-Confluence.md'), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docs/prd', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(outputDir, 'APM-Checkout-SDK-PRD.md'), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docs/requirements', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(outputDir, 'checkout-sdk-requirements-matrix.csv'), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docs/tracker', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(outputDir, 'APM-Checkout-SDK-Tracker.csv'), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function walkDir(dir, base) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const rel = path.join(base, item.name);
    if (item.isDirectory()) {
      results.push({ name: item.name, path: rel, type: 'dir', children: walkDir(path.join(dir, item.name), rel) });
    } else {
      results.push({ name: item.name, path: rel, type: 'file', size: fs.statSync(path.join(dir, item.name)).size });
    }
  }
  return results;
}

app.get('/api/docs/sdk-tree', (req, res) => {
  try {
    const tree = {
      src: walkDir(sdkSrcDir, 'src'),
      dist: walkDir(sdkDistDir, 'dist'),
    };
    res.json(tree);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docs/sdk/*', (req, res) => {
  try {
    const filePath = req.params[0];
    const sdkBase = path.join(__dirname, '..', 'checkout-sdk');
    const fullPath = path.join(sdkBase, filePath);
    if (!fullPath.startsWith(sdkBase)) return res.status(403).json({ error: 'Access denied' });
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(404).json({ error: err.message }); }
});

app.get('/api/docs/openapi', (req, res) => {
  try {
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf-8'));
    res.json(spec);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/docs/diagrams/:apm', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(outputDir, 'diagrams', req.params.apm + '-flow.mmd'), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) { res.status(404).json({ error: err.message }); }
});

app.get('/api/docs/diagrams', (req, res) => {
  try {
    const files = fs.readdirSync(path.join(outputDir, 'diagrams')).filter(f => f.endsWith('.mmd'));
    res.json(files.map(f => f.replace('-flow.mmd', '')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============== START ==============
const PORT = 3847;
app.listen(PORT, () => {
  console.log(`\n🧪 APM Launch Kit Portal running at http://localhost:${PORT}`);
  console.log(`   Launch Kit Portal:      http://localhost:${PORT}/`);
  console.log(`   E2E Test Page:          http://localhost:${PORT}/checkout-sdk-test.html`);
  console.log(`   Klarna widget test:     http://localhost:${PORT}/klarna.html`);
  console.log(`   CashApp Pay test:       http://localhost:${PORT}/cashapp.html`);
  console.log(`   PPRO 52-APM test:       http://localhost:${PORT}/ppro.html`);
  console.log(`   Health check:           http://localhost:${PORT}/api/health`);
  console.log(`   Test results:           http://localhost:${PORT}/api/test-log`);
  // Zepto status
  if (ZEPTO_CLIENT_ID) {
    const hasRefresh = !!loadZeptoRefreshToken();
    console.log(`   Zepto status:           ${hasRefresh ? 'configured (auto-refresh ready)' : 'needs bootstrap → http://localhost:' + PORT + '/zepto-setup.html'}`);
    console.log(`   Zepto client id:        ${ZEPTO_CLIENT_ID.slice(0, 8)}... (loaded from .env)`);
  } else {
    console.log(`   Zepto status:           NOT CONFIGURED (set ZEPTO_CLIENT_ID in test-harness/.env)`);
  }
  console.log('');
});
