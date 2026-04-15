/**
 * Trace console — scenario library.
 *
 * Builds a set of "scripted" event sequences per APM that the trace
 * console plays back into the 6-lane SVG. These are NOT network calls —
 * they are canned events keyed on the canonical v2.2 commerce flow,
 * generated from each APM's declared capabilities.
 *
 * Each event:
 *   {
 *     from: 'browser' | 'merchant' | 'chCreds' | 'chOrders' | 'provider' | 'webhook',
 *     to:   same,
 *     label: string,                    // one-line wire description
 *     kind:  'scenario',
 *     status: 'OK' | 'PENDING' | 'ERR',
 *     delayMs: number,                  // spacing before this event fires
 *     requestBody?: object,             // what engineers see in the inspector
 *     responseBody?: object,
 *     caption: string,                  // plain-English (leadership persona)
 *   }
 *
 * Four scenario types per eligible APM:
 *   - sync_sale_ok         — gateway sale, immediate success
 *   - async_webhook_ok     — pending → webhook → completed
 *   - merchant_capture_ok  — authorize → awaiting_merchant_capture → capture → completed
 *   - declined             — terminal failed with realistic error code
 */

/**
 * Generate the full scenario set for an APM entry from the catalog.
 * @returns {Record<string, { id, title, description, persona: { leadership, dev, engineer }, events: Array }>}
 */
export function buildScenariosForApm(apm, opts = {}) {
  const amount = opts.amount ?? 49.99;
  const currency = opts.currency ?? apm.currencies?.[0] ?? 'USD';
  const country = opts.country ?? apm.countries?.[0] ?? 'US';
  const orderId = `harness-${apm.id}-${Math.random().toString(36).slice(2, 8)}`;
  const scenarios = {};

  scenarios.sync_sale_ok = buildSyncSale(apm, { amount, currency, country, orderId });

  if (apm.capabilities?.requiresWebhook || apm.capabilities?.terminalFromWebhook || apm.pattern === 'qr' || apm.pattern === 'voucher') {
    scenarios.async_webhook_ok = buildAsyncWebhook(apm, { amount, currency, country, orderId });
  }

  if (apm.capabilities?.supportsMerchantInitiated && apm.capabilities?.supportsSeparateCapture) {
    scenarios.merchant_capture_ok = buildMerchantCapture(apm, { amount, currency, country, orderId });
  }

  scenarios.declined = buildDeclined(apm, { amount, currency, country, orderId });

  return scenarios;
}

// ─── Builders ───────────────────────────────────────────────────────

function buildSyncSale(apm, ctx) {
  const { amount, currency, country, orderId } = ctx;
  const chProvider = apm.chProvider ?? apm.id.toUpperCase();
  const sourceType = apm.chSourceType ?? 'AlternativePaymentMethod';
  const walletType = apm.chWalletType;
  return {
    id: 'sync_sale_ok',
    title: 'Sync sale · success',
    description: `Gateway-initiated sale against ${apm.displayName} that captures straight through.`,
    events: [
      step('browser', 'merchant', `POST /v2/sessions`, 'OK', 200,
        { apm: apm.id, amount, currency, merchantOrderId: orderId },
        undefined,
        `Shopper's browser asks the merchant backend to start a checkout session.`),
      step('merchant', 'chCreds', `POST /payments-vas/v1/security/credentials`, 'OK', 300,
        { grantType: 'client_credentials', scope: 'checkout' },
        undefined,
        `Merchant backend requests a short-lived CH access token (server-to-server, signed with HMAC).`),
      step('chCreds', 'merchant', `200 { accessToken }`, 'OK', 300,
        undefined,
        { accessToken: 'eyJ...REDACTED', expiresInMs: 900_000 },
        `Commerce Hub returns an access token that the merchant backend will attach as Bearer on the orders call.`),
      step('merchant', 'browser', `200 { sessionId }`, 'OK', 200,
        undefined,
        { sessionId: 'sess_' + randId(), providerClientToken: apm.pattern === 'tokenization' ? 'tok_' + randId() : null },
        `Session handed back to the browser SDK. The access token never leaves the backend.`),
      step('browser', 'merchant', `POST /v2/orders/${apm.id}`, 'OK', 400,
        { sessionId: 'sess_' + randId(), source: { type: sourceType }, scenarioId: 'sync_sale_ok' },
        undefined,
        `Shopper clicks Pay. Browser forwards the order to the merchant backend.`),
      step('merchant', 'chOrders', `POST /checkouts/v1/orders + Bearer`, 'OK', 400,
        {
          requestType: 'PaymentCardSaleTransaction',
          amount: { total: amount, currency },
          paymentMethod: { provider: chProvider },
          paymentSource: { sourceType, ...(walletType && { walletType }) },
          transactionInteraction: { origin: 'ECOM', country },
          paymentInitiator: 'GATEWAY',
        },
        undefined,
        `Backend calls Commerce Hub's checkout orders endpoint. The load-bearing v2.2 field is paymentMethod.provider = ${chProvider}.`),
      step('chOrders', 'provider', `CH fan-out → ${chProvider}`, 'OK', 500,
        undefined,
        undefined,
        `Commerce Hub internally fans out to the ${chProvider} processor rail (${apm.isPproRouted ? 'via PPRO' : 'direct'}).`),
      step('provider', 'chOrders', `200 CAPTURED`, 'OK', 500,
        undefined,
        { transactionState: 'CAPTURED', processorResponseCode: '00' },
        `${apm.displayName} authorizes and captures in one shot (sync APM).`),
      step('chOrders', 'merchant', `200 { transactionState: CAPTURED }`, 'OK', 200,
        undefined,
        { gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { orderId: 'ord_' + randId(), transactionId: 'txn_' + randId() } } },
        `Commerce Hub returns the final CAPTURED state to the merchant backend.`),
      step('merchant', 'browser', `200 { transactionState: CAPTURED }`, 'OK', 200,
        undefined,
        { gatewayResponse: { transactionState: 'CAPTURED' } },
        `Backend relays the terminal response to the browser. SDK emits PAYMENT_COMPLETED.`),
    ],
  };
}

function buildAsyncWebhook(apm, ctx) {
  const { amount, currency, country, orderId } = ctx;
  const chProvider = apm.chProvider ?? apm.id.toUpperCase();
  const sourceType = apm.chSourceType ?? 'AlternativePaymentMethod';
  return {
    id: 'async_webhook_ok',
    title: 'Async · webhook settle',
    description: `Pending APM: initial response is PAYER_ACTION_REQUIRED, terminal state arrives later via webhook.`,
    events: [
      step('browser', 'merchant', `POST /v2/sessions`, 'OK', 200, { apm: apm.id, amount, currency }, undefined,
        `Shopper starts checkout.`),
      step('merchant', 'chCreds', `POST /payments-vas/v1/security/credentials`, 'OK', 300, undefined, undefined,
        `Merchant backend mints a CH access token.`),
      step('chCreds', 'merchant', `200 { accessToken }`, 'OK', 300, undefined, undefined, `Token returned.`),
      step('merchant', 'browser', `200 { sessionId }`, 'OK', 200, undefined, undefined, `Session handed to the SDK.`),
      step('browser', 'merchant', `POST /v2/orders/${apm.id}`, 'OK', 400,
        { source: { type: sourceType }, scenarioId: 'async_webhook_ok' }, undefined,
        `Shopper confirms. Order forwarded to the backend.`),
      step('merchant', 'chOrders', `POST /checkouts/v1/orders + Bearer`, 'OK', 400,
        { paymentMethod: { provider: chProvider }, paymentSource: { sourceType }, paymentInitiator: 'GATEWAY' }, undefined,
        `Backend submits the order to CH.`),
      step('chOrders', 'provider', `CH fan-out → ${chProvider}`, 'OK', 500, undefined, undefined,
        `CH invokes the APM processor.`),
      step('provider', 'chOrders', `200 PAYER_ACTION_REQUIRED`, 'PENDING', 500,
        undefined, { transactionState: 'PENDING', nextAction: { type: 'REDIRECT', url: 'https://provider.example.com/auth/…' } },
        `${apm.displayName} needs the shopper to complete payment out-of-band (redirect, QR scan, voucher).`),
      step('chOrders', 'merchant', `200 { PAYER_ACTION_REQUIRED }`, 'PENDING', 200, undefined, undefined,
        `CH returns the pending state. SDK emits PAYMENT_PENDING and opens an SSE stream waiting for webhooks.`),
      step('merchant', 'browser', `200 { PAYER_ACTION_REQUIRED }`, 'PENDING', 200, undefined, undefined,
        `Shopper is taken to the provider's flow. Browser subscribes to SSE for terminal state.`),
      step('webhook', 'merchant', `POST /v2/webhooks/${apm.id}`, 'OK', 2000,
        { event: 'payment.succeeded', orderId: 'ord_' + randId(), amount: { total: amount, currency } }, undefined,
        `Provider calls back ~2 seconds later via webhook: "payment.succeeded".`),
      step('merchant', 'browser', `SSE event payment.succeeded`, 'OK', 200, undefined, undefined,
        `Backend relays the webhook to the browser over SSE. SDK transitions pending → completed.`),
    ],
  };
}

function buildMerchantCapture(apm, ctx) {
  const { amount, currency, country, orderId } = ctx;
  const chProvider = apm.chProvider ?? apm.id.toUpperCase();
  const sourceType = apm.chSourceType ?? 'AlternativePaymentMethod';
  return {
    id: 'merchant_capture_ok',
    title: 'Merchant capture · authorize + capture',
    description: `Two-step flow: authorize-only, then the merchant later calls /capture when ready (fraud check, inventory hold, fulfilment).`,
    events: [
      step('browser', 'merchant', `POST /v2/sessions`, 'OK', 200, undefined, undefined, `Shopper starts checkout.`),
      step('merchant', 'chCreds', `POST /payments-vas/v1/security/credentials`, 'OK', 300, undefined, undefined, `Access token minted.`),
      step('chCreds', 'merchant', `200 { accessToken }`, 'OK', 300, undefined, undefined, `Token ready.`),
      step('merchant', 'browser', `200 { sessionId }`, 'OK', 200, undefined, undefined, `Session ready.`),
      step('browser', 'merchant', `POST /v2/orders/${apm.id}`, 'OK', 400,
        { paymentInitiator: 'MERCHANT', captureFlag: false }, undefined,
        `Shopper confirms. Backend asks for an authorize-only (captureFlag=false).`),
      step('merchant', 'chOrders', `POST /checkouts/v1/orders { captureFlag: false }`, 'OK', 400,
        { paymentMethod: { provider: chProvider }, paymentSource: { sourceType }, transactionDetails: { captureFlag: false } }, undefined,
        `Backend sends an auth-only order to CH.`),
      step('chOrders', 'provider', `CH fan-out → ${chProvider} (authorize)`, 'OK', 500, undefined, undefined,
        `CH routes the auth-only call to ${chProvider}.`),
      step('provider', 'chOrders', `200 AUTHORIZED`, 'OK', 400, undefined, { transactionState: 'AUTHORIZED' },
        `${apm.displayName} places a hold on the funds without capturing.`),
      step('chOrders', 'merchant', `200 { AUTHORIZED }`, 'OK', 200, undefined, undefined,
        `Backend receives AUTHORIZED. SDK transitions authorizing → awaiting_merchant_capture.`),
      step('merchant', 'browser', `200 { AUTHORIZED }`, 'OK', 200, undefined, undefined,
        `Browser shows "authorization held — click Capture to settle".`),
      step('browser', 'merchant', `POST /v2/orders/ord_.../capture`, 'OK', 1500, undefined, undefined,
        `Merchant clicks Capture after fraud check / inventory hold passes.`),
      step('merchant', 'chOrders', `POST /checkouts/v1/orders { captureFlag: true, ref }`, 'OK', 400,
        { transactionDetails: { captureFlag: true }, referenceTransactionDetails: { referenceTransactionId: 'txn_' + randId() } }, undefined,
        `Backend calls CH again with the original txnId + captureFlag=true.`),
      step('chOrders', 'provider', `CH fan-out → ${chProvider} (capture)`, 'OK', 500, undefined, undefined,
        `CH forwards the capture to ${chProvider}.`),
      step('provider', 'chOrders', `200 CAPTURED`, 'OK', 400, undefined, { transactionState: 'CAPTURED' },
        `Funds settle. Final state is CAPTURED.`),
      step('chOrders', 'merchant', `200 { CAPTURED }`, 'OK', 200, undefined, undefined,
        `Backend receives the final state.`),
      step('merchant', 'browser', `200 { CAPTURED }`, 'OK', 200, undefined, undefined,
        `SDK transitions capturing → completed. PAYMENT_COMPLETED fires.`),
    ],
  };
}

function buildDeclined(apm, ctx) {
  const { amount, currency, country, orderId } = ctx;
  const chProvider = apm.chProvider ?? apm.id.toUpperCase();
  const sourceType = apm.chSourceType ?? 'AlternativePaymentMethod';
  return {
    id: 'declined',
    title: 'Declined · terminal failure',
    description: `Provider returns DECLINED with a realistic error code. SDK transitions to terminal failed state.`,
    events: [
      step('browser', 'merchant', `POST /v2/sessions`, 'OK', 200, undefined, undefined, `Shopper starts checkout.`),
      step('merchant', 'chCreds', `POST /payments-vas/v1/security/credentials`, 'OK', 300, undefined, undefined, `Access token minted.`),
      step('chCreds', 'merchant', `200 { accessToken }`, 'OK', 300, undefined, undefined, `Token returned.`),
      step('merchant', 'browser', `200 { sessionId }`, 'OK', 200, undefined, undefined, `Session ready.`),
      step('browser', 'merchant', `POST /v2/orders/${apm.id}`, 'OK', 400, undefined, undefined,
        `Shopper clicks Pay.`),
      step('merchant', 'chOrders', `POST /checkouts/v1/orders + Bearer`, 'OK', 400,
        { paymentMethod: { provider: chProvider }, paymentSource: { sourceType } }, undefined,
        `Backend submits the order to CH.`),
      step('chOrders', 'provider', `CH fan-out → ${chProvider}`, 'OK', 500, undefined, undefined,
        `CH forwards to the APM processor.`),
      step('provider', 'chOrders', `200 DECLINED`, 'ERR', 500, undefined,
        { transactionState: 'DECLINED', error: [{ code: 'PAYMENT_DECLINED', message: 'Insufficient funds' }] },
        `${apm.displayName} rejects the transaction.`),
      step('chOrders', 'merchant', `200 { DECLINED }`, 'ERR', 200, undefined, undefined,
        `CH relays the decline.`),
      step('merchant', 'browser', `200 { DECLINED }`, 'ERR', 200, undefined, undefined,
        `SDK emits PAYMENT_FAILED. Final state: failed.`),
    ],
  };
}

// ─── helpers ────────────────────────────────────────────────────────

function step(from, to, label, status, delayMs, requestBody, responseBody, caption) {
  return { from, to, label, kind: 'scenario', status, delayMs, requestBody, responseBody, caption };
}

function randId() {
  return Math.random().toString(36).slice(2, 10);
}
