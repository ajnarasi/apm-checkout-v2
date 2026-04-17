/**
 * v2.2 harness — Documentation content module.
 *
 * Drafted by technical-writer agent and stored here as a plain JS module
 * so the Docs pane can render it without an extra fetch. Contents cover:
 *   - Executive (30,000 ft) — CEO / CPO / business stakeholders
 *   - Stakeholder (20,000 ft) — program leads / partner teams
 *   - Engineering (10,000 ft) — senior engineers / architects
 *   - Product manager (ground level) — PMs / QA leads
 *   - QA playbook (ground level) — QA engineers / SDETs
 *   - Implementation guide (12 steps)
 *   - Mermaid diagrams (6 canonical diagrams)
 *
 * HTML in each `body` is trusted (drafted by the agent, stored in source).
 * The Docs pane renders it via innerHTML.
 */

export const AUDIENCE_VIEWS = [
  {
    key: 'executive',
    title: 'Fiserv APM Checkout SDK v2.2 — Executive Overview',
    altitude: '30,000 ft',
    audience: 'CEO, CPO, business stakeholders',
    tldr: 'One SDK, one Commerce Hub endpoint, 70 alternative payment methods across every major global market.',
    body: `<h3>What it is</h3><p>The Fiserv APM Checkout SDK v2.2 is a single browser SDK plus a thin backend reference that lets merchants accept <strong>70 alternative payment methods</strong> across Europe, LATAM, APAC, North America, and Africa. It unifies 16 direct integrations (Klarna, PayPal, Apple Pay, Google Pay, Cash App, Venmo, Afterpay, Zip, Affirm, Sezzle, Alipay+, WeChat Pay, GrabPay, Zepto, TabaPay) with 54 PPRO-routed local methods under one uniform contract.</p><h3>Why it matters commercially</h3><p>APM acceptance is the single largest driver of checkout conversion in non-card-first markets. In Germany, SOFORT and Giropay outperform cards. In Brazil, PIX is the default rail. In the Netherlands, iDEAL exceeds 70% of ecommerce volume. Without local APM coverage, merchants leave 20-40% of addressable GMV on the table. v2.2 removes the historical tax of integrating each method separately.</p><h3>Strategic posture</h3><ul><li><strong>One endpoint, one contract.</strong> Merchants post to Commerce Hub <code>/checkouts/v1/orders</code>. Commerce Hub fans out internally to PPRO, Klarna, PayPal, and the wallet networks. Merchants never call a partner directly.</li><li><strong>CH owns the relationships.</strong> Partner contracts, certifications, and compliance stay inside Fiserv. Merchants inherit every partnership the moment they onboard.</li><li><strong>Ship once, scale forever.</strong> Adding APM number 71 becomes a registry entry, not a new integration project.</li></ul><h3>Business outcomes</h3><ul><li><strong>Time-to-market:</strong> Weeks, not quarters, to enable a new geography.</li><li><strong>Conversion lift:</strong> Local methods convert 15-35% better than cards in their home markets.</li><li><strong>Ops cost reduction:</strong> One reconciliation pipeline, one dispute flow, one settlement report across all 70 methods.</li><li><strong>Partner leverage:</strong> Fiserv negotiates wholesale APM economics that individual merchants cannot access.</li></ul><h3>Current status</h3><p>v2.2.0-poc.0 is a functional proof-of-concept with a self-contained browser harness that exercises all 70 adapters without live credentials. v2.1 will harden the hero adapters (Klarna, PayPal, Apple Pay, Google Pay, Cash App, PIX, iDEAL) for pilot merchants. v3.0 introduces multi-tenant isolation and per-merchant routing policy.</p>`,
  },
  {
    key: 'stakeholder',
    title: 'Program and partner view',
    altitude: '20,000 ft',
    audience: 'program leads, partner teams, account managers',
    tldr: '70 APMs delivered through one contract, six reusable UX patterns, and a single Commerce Hub endpoint.',
    body: `<h3>Coverage</h3><p>v2.2 ships <strong>70 alternative payment methods</strong>: 16 direct integrations that Fiserv operates itself, plus 54 methods routed through the PPRO aggregator. The string <code>PPRO</code> never appears on the merchant wire. From the merchant perspective, SOFORT, Przelewy24, and MB WAY look identical to Klarna or PayPal: a single POST to Commerce Hub with a <code>paymentMethod.provider</code> field.</p><h3>Six UX patterns cover every APM</h3><table><tr><td><strong>Redirect</strong></td><td>Browser leaves the merchant domain, authenticates, returns. SOFORT, iDEAL, Trustly, most PPRO methods.</td></tr><tr><td><strong>BNPL</strong></td><td>Inline form or hosted field produces a single-use token. Klarna, Afterpay, Affirm, Sezzle, Zip.</td></tr><tr><td><strong>Native wallet</strong></td><td>Device-owned payment sheet. Apple Pay, Google Pay.</td></tr><tr><td><strong>Button SDK</strong></td><td>Third-party SDK renders a branded button and orchestrates auth. PayPal, PayPal Pay Later, Venmo, Cash App.</td></tr><tr><td><strong>QR</strong></td><td>Display a scannable code, poll or listen for settlement. WeChat Pay, Alipay, Alipay+, PIX, UPI, PayNow.</td></tr><tr><td><strong>Voucher</strong></td><td>Display a reference and wait for off-system settlement. Boleto, OXXO, Konbini.</td></tr></table><h3>What partners and account teams gain</h3><ul><li><strong>One contract to pitch.</strong> A merchant signs with Fiserv and gets the full 70-method catalog, no separate PPRO or Klarna paperwork.</li><li><strong>One integration to support.</strong> Solution engineers learn one SDK. Onboarding for a new APM is a configuration change.</li><li><strong>One escalation path.</strong> Incidents, chargebacks, and reconciliation tickets route through Commerce Hub support. Merchants never call PPRO.</li><li><strong>Capability matrix is visible.</strong> The capabilities declaration exposes per-adapter support for refunds, partial captures, recurring, chargebacks, and webhook semantics. Account managers can answer a merchant's capability question from a single file.</li></ul><h3>Partner obligations</h3><p>PPRO remains the upstream aggregator for 54 long-tail methods. Direct partners (Klarna, PayPal, Apple, Google, Block) retain their existing contracts with Fiserv. v2.2 does not change partner economics. It changes how the merchant reaches them.</p><h3>Roadmap signal</h3><ul><li><strong>v2.2 (now):</strong> POC harness, 70 adapter stubs, 6 base classes, 11-state machine.</li><li><strong>v2.1 hardening (next):</strong> 7 hero adapters pilot-ready with live Commerce Hub credentials.</li><li><strong>v3.0:</strong> Multi-tenant isolation, per-merchant routing policy, regional data residency.</li></ul>`,
  },
  {
    key: 'engineering',
    title: 'Architecture and engineering reference',
    altitude: '10,000 ft',
    audience: 'senior engineers, architects',
    tldr: 'Monorepo of three typed packages plus a reference Express server, one CH endpoint, 11-state FSM, 6 base adapters, 5 production tripwires.',
    body: `<h3>Package layout</h3><ul><li><code>packages/shared-types</code> — zero-runtime TypeScript types. The APM registry lives in <code>src/apm-mapping.ts</code>, the capability matrix in <code>src/capabilities.ts</code>. Nothing in this package emits JavaScript.</li><li><code>packages/commerce-hub-node</code> — server-side Commerce Hub client. Handles HMAC signing, request envelopes, and CH error normalization.</li><li><code>packages/checkout-sdk-browser</code> — browser SDK. Exposes the 11-state FSM, adapter base classes, and the postMessage bridge back to the merchant page.</li><li><code>packages/reference-server</code> — Express app. Routes live under <code>src/routes/orders.ts</code>. The self-contained browser harness is served from <code>public/</code>.</li></ul><h3>Five architectural decisions</h3><p><strong>1. ADR-004 single Commerce Hub endpoint.</strong> The merchant backend always POSTs to CH <code>/checkouts/v1/orders</code>. Routing to PPRO, Klarna, PayPal, and wallets happens inside Commerce Hub. PPRO sub-methods set <code>paymentMethod.provider = uppercase(adapterId)</code>. The literal string <code>PPRO</code> never appears on the wire. This is enforced in <code>packages/reference-server/src/routes/orders.ts</code>.</p><p><strong>2. ADR-003 eleven-state FSM.</strong> <code>idle → initializing → ready → authorizing → pending → awaiting_merchant_capture → capturing → completed | failed | cancelled | auth_expired | script_load_failed</code>. Exactly 18 legal transitions. Illegal transitions throw at runtime and fail harness tests. The FSM is owned by the browser SDK but mirrored server-side for webhook reconciliation.</p><p><strong>3. Six base adapter classes.</strong> <code>RedirectBase</code>, <code>BnplBase</code>, <code>NativeWalletBase</code>, <code>ButtonSdkBase</code>, <code>QrBase</code>, <code>VoucherBase</code>. All 70 concrete adapters extend one of these. Adding an APM is a registry entry plus optional per-method overrides. No new flow code.</p><p><strong>4. First-writer-wins result cache.</strong> Webhook confirmations and synchronous CH responses race for the authoritative result. <code>OrderResultCache</code> resolves on the first writer and idempotently no-ops subsequent writes. This removes webhook-vs-sync race conditions that plague multi-rail integrations.</p><p><strong>5. HARNESS_MODE short-circuit.</strong> When <code>HARNESS_MODE=true</code>, the reference server intercepts CH calls and returns synthetic responses driven by the <code>X-Harness-Scenario</code> header. The browser harness is fully self-contained: no CH credentials, no partner keys, no network dependency. <strong>HARNESS_MODE is dev-only and must never run in production.</strong></p><h3>Refuse-production tripwires</h3><p>Five layers prevent the POC-mode static auth from leaking into a production deployment:</p><ul><li>Startup check refuses to boot if <code>HARNESS_MODE=true</code> and <code>NODE_ENV=production</code>.</li><li>The synthetic CH client throws if a real CH URL is configured alongside HARNESS_MODE.</li><li>Static auth tokens are flagged with a <code>__poc_only</code> sentinel that the CH client rejects.</li><li>Build artifacts stamp a <code>poc</code> channel marker; the deployment pipeline blocks <code>poc</code>-channel artifacts from production targets.</li><li>Health check endpoint returns HTTP 503 with <code>reason: poc_mode_active</code> when HARNESS_MODE is live.</li></ul><h3>Scalability posture</h3><p>The reference server is stateless. Horizontal scaling is linear. <code>OrderResultCache</code> is in-process for v2.2 and backed by Redis in v3.0. Commerce Hub absorbs the retry, circuit-breaker, and rate-limit logic. The browser SDK batches state transitions to a single postMessage per commit to keep iframe hosts responsive.</p><h3>Observability</h3><p>Every FSM transition emits a structured log line with <code>correlationId</code>, <code>adapterId</code>, <code>fromState</code>, <code>toState</code>. Webhook receipts are logged with a deterministic <code>webhookId</code> for idempotent replay. The harness UI surfaces this stream in the Events tab.</p><h3>Security</h3><p>HMAC on every CH request. CSP is configured on the reference server with nonce-based script-src. All user input at the browser boundary is schema-validated before reaching the SDK core. Webhook endpoints verify signature before touching <code>OrderResultCache</code>.</p><h3>Single-tenant today, multi-tenant in v3</h3><p>v2.2 is single-tenant: one merchant, one configuration, one CH credential set. v3.0 introduces per-merchant routing policy, tenant isolation in the result cache, and regional data residency controls. The package boundaries were designed for this split; no rewrite is required.</p>`,
  },
  {
    key: 'productManager',
    title: 'Product manager and QA lead view',
    altitude: 'Ground level',
    audience: 'PMs, QA leads',
    tldr: 'Six UX patterns, 70 adapters, a feature matrix you can query today, and a hero-adapter hardening track in v2.1.',
    body: `<h3>Use cases by pattern</h3><table><tr><td><strong>Redirect</strong></td><td>EU bank transfers (SOFORT, Giropay, iDEAL), pay-in-installments that require bank auth (Klarna Pay Later), LATAM instant rails (PIX). User leaves the merchant domain, authenticates at the method's host, returns to a success or failure URL. Best for methods that need strong customer authentication or are regulated at the bank level.</td></tr><tr><td><strong>BNPL</strong></td><td>BNPL providers that want the merchant to keep the checkout chrome (Klarna, Afterpay, Affirm, Sezzle). The SDK collects payment-method data, the provider returns a single-use token, the backend charges that token via CH. Best for merchants protective of their brand and conversion funnel.</td></tr><tr><td><strong>Native wallet</strong></td><td>Apple Pay and Google Pay. Device surfaces the payment sheet, returns a cryptogram, backend forwards to CH. Best conversion rates of any pattern when the device is enrolled.</td></tr><tr><td><strong>Button SDK</strong></td><td>PayPal, PayPal Pay Later, Venmo, Cash App. The partner renders their own branded button and runs their own auth UX. The SDK orchestrates the handoff and commits the result. Best for brand-trusted wallets where the partner UX is the conversion lever.</td></tr><tr><td><strong>QR</strong></td><td>WeChat Pay, Alipay, some PIX deployments. Display a code, the user scans with their phone, settlement arrives via webhook. Best for APAC and mobile-first markets.</td></tr><tr><td><strong>Voucher</strong></td><td>Boleto (BR), OXXO (MX), Konbini (JP). Display a reference, the customer pays offline at a bank or convenience store, webhook confirms days later. Order moves to <code>pending</code> until settlement.</td></tr></table><h3>Feature matrix</h3><p>The authoritative source is <code>packages/shared-types/src/capabilities.ts</code>. Per adapter it declares:</p><ul><li><strong>Refunds:</strong> full, partial, none.</li><li><strong>Captures:</strong> auto, merchant-initiated, not supported.</li><li><strong>Recurring:</strong> supported, not supported, token-only.</li><li><strong>Chargeback posture:</strong> bank-disputable, irrevocable, partner-arbitrated.</li><li><strong>Settlement semantics:</strong> sync, async-webhook, delayed-voucher.</li><li><strong>Currency and country lists.</strong></li></ul><h3>What v2.2 delivers today</h3><ul><li>All 70 adapters instantiate, pass registry tests, and run end-to-end in HARNESS_MODE with synthetic CH responses.</li><li>The 10-tab Inspector surfaces every adapter's CH wire payload, capability flags, state-machine trace, live API trace, and real SDK loader.</li><li>Every UX pattern has at least one exemplar adapter fully wired.</li><li>The merchant contract is locked: one CH endpoint, one envelope shape, one FSM.</li></ul><h3>What v2.1 hardening adds</h3><p>Seven hero adapters move from POC to pilot-ready with live Commerce Hub credentials, real partner SDKs, and production-grade error paths: <strong>Klarna, PayPal, Apple Pay, Google Pay, Cash App, PIX, iDEAL</strong>. Each receives a dedicated integration test suite, a rollback plan, and a Fiserv-operated sandbox.</p><h3>Out of scope for v2.2</h3><ul><li>Multi-tenant merchant isolation — targeted for v3.0.</li><li>Per-merchant routing policy overrides — v3.0.</li><li>Offline voucher reconciliation UI — v3.0.</li><li>Recurring billing orchestration across APMs with incompatible rails — out of program.</li></ul>`,
  },
  {
    key: 'qa',
    title: 'QA playbook',
    altitude: 'Ground level',
    audience: 'QA engineers, SDETs',
    tldr: 'Boot the reference server in HARNESS_MODE, drive scenarios with X-Harness-Scenario, verify FSM trace in the Inspector.',
    body: `<h3>How to run the harness</h3><ul><li>From the repo root run <code>npm install</code>, then <code>npm run dev --workspace @commercehub/reference-server</code> with <code>HARNESS_MODE=true</code>.</li><li>The reference server boots on the configured port and the browser harness is served at <code>/harness/</code>.</li><li>Open the harness. The Inspector renders the 70-adapter registry and the 10-tab detail pane.</li><li>Select an adapter. The Inspector shows capability flags, wire payload, FSM diagram, and an Events tab that streams state transitions live.</li></ul><h3>Driving scenarios</h3><p>Every POST to <code>/v2/orders/:apm</code> accepts an <code>X-Harness-Scenario</code> header. The synthetic CH client reads this header and returns a deterministic response. Supported scenarios include <code>sale_ok</code>, <code>sale_decline</code>, <code>sale_timeout</code>, <code>authorize_ok_capture_ok</code>, <code>authorize_ok_partial_capture</code>, <code>authorize_ok_void</code>, <code>authorize_ok_auth_expires</code>, <code>webhook_pending_then_complete</code>, <code>webhook_pending_then_failed</code>, <code>webhook_pending_then_cancelled</code>, <code>refund_ok</code>, <code>shipping_address_change</code>, <code>coupon_applied</code>, <code>single_use_token_retry</code>, <code>merchant_validation</code>, and <code>script_load_failed</code>.</p><h3>Scenarios to cover per pattern</h3><table><tr><td><strong>Redirect</strong></td><td><code>sale_ok</code>, <code>sale_decline</code>, <code>auth_expired</code>, back-button mid-flow, success URL tampering.</td></tr><tr><td><strong>BNPL</strong></td><td><code>sale_ok</code>, <code>sale_decline</code>, token replay rejection, token TTL expiry.</td></tr><tr><td><strong>Native wallet</strong></td><td><code>sale_ok</code>, device-not-enrolled fallback, domain verification failure, <code>script_load_failed</code>.</td></tr><tr><td><strong>Button SDK</strong></td><td><code>script_load_failed</code>, partner popup blocked, partner auth cancel, <code>webhook_pending_then_complete</code>.</td></tr><tr><td><strong>QR</strong></td><td><code>webhook_pending_then_complete</code>, QR expiry before scan, webhook-before-sync race.</td></tr><tr><td><strong>Voucher</strong></td><td><code>authorize_ok_capture_ok</code>, voucher expiry, webhook confirmation days later.</td></tr></table><h3>Given / When / Then examples</h3><p><strong>Async webhook race.</strong> <em>Given</em> an adapter with <code>requiresWebhook: true</code>, <em>when</em> the scenario is <code>webhook_pending_then_complete</code>, <em>then</em> the first writer wins in <code>OrderResultCache</code>, the second writer is a no-op, and the FSM lands in <code>completed</code> exactly once.</p><p><strong>Illegal transition.</strong> <em>Given</em> an adapter in state <code>completed</code>, <em>when</em> a late webhook attempts to move it to <code>failed</code>, <em>then</em> the SDK throws <code>IllegalTransitionError</code> and the Events tab logs the rejection with the original <code>correlationId</code>.</p><p><strong>Merchant capture.</strong> <em>Given</em> an adapter with <code>supportsSeparateCapture: true</code>, <em>when</em> authorization succeeds and <code>paymentInitiator=MERCHANT</code>, <em>then</em> the FSM pauses in <code>awaiting_merchant_capture</code> until the merchant calls <code>/v2/orders/:id/capture</code>.</p><h3>Regression targets</h3><ul><li>All 70 adapters must pass registry instantiation tests.</li><li>FSM must reject every transition not in the 18-entry legal set.</li><li>Refuse-production tripwires must fail the build when <code>HARNESS_MODE=true</code> and <code>NODE_ENV=production</code> are set together.</li><li>Wire payloads must never contain the literal string <code>PPRO</code>.</li><li>Every adapter must emit a complete FSM trace from <code>idle</code> to a terminal state.</li></ul><h3>Known limitations</h3><ul><li>HARNESS_MODE is dev-only. Live CH integration is limited to the seven hero adapters in v2.1.</li><li>The in-process <code>OrderResultCache</code> does not survive a restart. Webhooks arriving after a restart reach a cold cache and are treated as first-writer.</li><li>Multi-tenant isolation is not yet enforced. Do not run v2.2 with more than one merchant configuration.</li><li>Voucher flows are simulated. Real offline settlement reconciliation arrives in v3.0.</li></ul>`,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Expanded 14-step implementation guide. Each step includes realistic
// code samples, wire payloads, and a "Common pitfall" callout.
// Drafted by the technical-writer agent and explicitly covers the
// Credentials API + access token minting + Bearer attachment flow that
// was missing from the earlier 12-step version.
// ─────────────────────────────────────────────────────────────────────
export const IMPLEMENTATION_STEPS = [
  { num: 1,  title: 'Clone and install the reference monorepo', body: `<p>The Fiserv APM Checkout SDK v2.2 ships as a pnpm monorepo with three publishable packages (<code>shared-types</code>, <code>commerce-hub-node</code>, <code>checkout-sdk-browser</code>) plus a <code>reference-server</code> and a browser <code>harness</code>. Clone at the tagged v2.2 release so your local adapters match the ADR-004 wire contract, then install with pnpm so workspace protocol links resolve correctly.</p><pre><code>git clone git@github.com:fiserv/apm-checkout-sdk.git
cd apm-checkout-sdk
git checkout v2.2.0
pnpm install
pnpm -r build</code></pre><p>The <code>pnpm -r build</code> is load-bearing: <code>checkout-sdk-browser</code> imports types from <code>shared-types</code> via <code>workspace:*</code>.</p><p class="pitfall"><strong>Common pitfall:</strong> Running <code>npm install</code> instead of <code>pnpm install</code> silently flattens the workspace graph and publishes the wrong <code>shared-types</code> version to <code>node_modules</code>, which makes the adapter registry emit <em>cannot read properties of undefined (reading 'provider')</em> at boot.</p>` },
  { num: 2,  title: 'Configure HARNESS_MODE and walk through .env.example', body: `<p><code>HARNESS_MODE</code> is the single flag that tells the reference server whether it is running against mock fixtures or live Commerce Hub. Copy <code>.env.example</code> to <code>.env</code> and fill in CH credentials, webhook signing key, CORS allowlist, and per-APM provider sandbox keys.</p><pre><code># .env
HARNESS_MODE=mock            # mock | sandbox | live
CH_BASE_URL=https://cert.api.fiservapps.com
CH_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
CH_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
CH_MERCHANT_ID=100008000000123
WEBHOOK_HMAC_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
HARNESS_CORS_ORIGIN=http://localhost:3849
KLARNA_CLIENT_TOKEN=...
PAYPAL_CLIENT_ID=...
APPLEPAY_MERCHANT_ID=merchant.com.fiserv.harness
GOOGLEPAY_GATEWAY_MERCHANT_ID=...
CASHAPP_CLIENT_ID=...</code></pre><p>When <code>HARNESS_MODE=mock</code>, the reference server serves canned CH responses. Flip to <code>sandbox</code> to call the real CH cert endpoint; <code>live</code> requires passing the five refuse-production tripwires.</p><p class="pitfall"><strong>Common pitfall:</strong> Shipping an image with <code>HARNESS_MODE=mock</code> baked in and a <code>CH_BASE_URL</code> pointing at production: the server will happily return mocked <code>CAPTURED</code> responses in production traffic and settle nothing. The refuse-production tripwire in step 14 exists specifically to block this.</p>` },
  { num: 3,  title: 'Boot the reference server and confirm /readyz', body: `<p>The reference server exposes <code>/livez</code> (liveness) and <code>/readyz</code> (readiness). <code>/readyz</code> returns 200 only after the CH credential mint has succeeded, the adapter registry has loaded all 70 APMs, and the circuit breaker is in <code>closed</code> state.</p><pre><code>pnpm --filter reference-server dev

# in another shell
curl -s http://localhost:3849/readyz | jq
# {
#   "status": "ready",
#   "harnessMode": "mock",
#   "adapters": 70,
#   "chCredentials": "minted",
#   "breaker": "closed"
# }</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Wiring Kubernetes probes to <code>/livez</code> instead of <code>/readyz</code>. The pod will route traffic before the CH credential mint finishes and the first N orders will 401.</p>` },
  { num: 4,  title: 'Open the browser harness and select an APM', body: `<p>The browser harness is the same v2.2 harness you are reading this in. Open <code>http://localhost:3849/harness/</code>, pick any APM from the catalog, and confirm the inspector dock loads.</p><pre><code># In the browser DevTools:
window.__SDK_VERSION__   // "2.2.0"
window.__HARNESS_MODE__  // "mock"</code></pre><p>Picking an APM does <em>not</em> yet create a session — it lazy-loads the adapter chunk and renders the inspector panes. The session call happens in step 5.</p><p class="pitfall"><strong>Common pitfall:</strong> Hardcoding the harness against a fixed port in committed source. Use <code>VITE_HARNESS_API_BASE</code> so CI can point the harness at a deployed reference server.</p>` },
  { num: 5,  title: 'Call POST /v2/sessions from the merchant backend (with Credentials API)', body: `<p>The browser <strong>never</strong> talks to Commerce Hub directly. The merchant backend owns the CH API key + secret, mints an access token via the CH Credentials API, and returns a short-lived session envelope to the browser. This is the ADR-002 trust boundary: only the reference server sees HMAC material.</p><p>Below is the merchant backend handler. Note the full CH Credentials header block: <code>Api-Key</code>, a fresh UUID <code>Client-Request-Id</code>, epoch-ms <code>Timestamp</code> within ±5 minutes of CH clock, <code>Auth-Token-Type: HMAC</code>, and the computed <code>Authorization</code> HMAC over <code>apiKey + clientRequestId + timestamp + payload</code>.</p><pre><code>// packages/reference-server/src/routes/sessions.ts
import { randomUUID, createHmac } from 'node:crypto';

export async function createSession(req, res) {
  const { apm, amount, currency, merchantOrderId } = req.body;

  const clientRequestId = randomUUID();
  const timestamp = Date.now().toString();     // epoch MILLISECONDS, not seconds
  const payload = JSON.stringify({ grantType: 'client_credentials' });

  const rawSignature =
    process.env.CH_API_KEY + clientRequestId + timestamp + payload;
  const authorization = createHmac('sha256', process.env.CH_API_SECRET)
    .update(rawSignature)
    .digest('base64');

  const credRes = await fetch(
    process.env.CH_BASE_URL + '/payments-vas/v1/security/credentials',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': process.env.CH_API_KEY,
        'Client-Request-Id': clientRequestId,
        'Timestamp': timestamp,
        'Auth-Token-Type': 'HMAC',
        'Authorization': authorization,
      },
      body: payload,
    }
  );

  const { accessToken, expiresIn } = await credRes.json();
  const sessionId = randomUUID();

  // Cache server-side. Browser only sees the envelope.
  return res.json({
    sessionId,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    apm, amount, currency, merchantOrderId,
  });
}</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Using <code>Date.now() / 1000</code> (epoch seconds) for <code>Timestamp</code>. The Credentials API expects <strong>epoch milliseconds</strong> and will 401 with <em>timestamp outside allowed skew</em> even though the clock is fine.</p>` },
  { num: 6,  title: 'Browser receives the session and boots the SDK', body: `<p>With the session envelope in hand, the browser calls <code>createCheckout</code>. The SDK stores the access token in memory (never localStorage), resolves the adapter for the chosen APM, and lazy-loads the provider's script.</p><pre><code>import { createCheckout } from '@fiserv/checkout-sdk-browser';

const res = await fetch('/v2/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apm: 'klarna',
    amount: { total: '49.99', currency: 'USD' },
    merchantOrderId: 'ord_01HV5',
  }),
});
const session = await res.json();

const checkout = await createCheckout({
  apm: 'klarna',
  mount: '#apm-mount',
  credentials: {
    accessToken: session.accessToken,
    sessionId: session.sessionId,
  },
  merchantBackend: { baseUrl: '/v2' },
  onStateChange: (s) =&gt; console.log('[sdk]', s),
});

await checkout.render();</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Treating <code>accessToken</code> as long-lived and caching it in <code>localStorage</code>. CH access tokens have a short TTL; the SDK assumes the merchant backend re-mints on session boot and will throw <code>E_TOKEN_EXPIRED</code> if it sees an <code>expiresAt</code> in the past.</p>` },
  { num: 7,  title: 'User clicks the provider button and the SDK forwards the token', body: `<p>When the user completes the provider-side flow, the adapter's tokenization callback fires with a provider-specific token. The SDK normalizes this into a <code>{ sourceType, rawToken }</code> envelope and POSTs it to the merchant backend at <code>/v2/orders/:apm</code>. The browser never calls CH; the merchant backend is the only thing that knows how to translate an adapter token into a CH Orders body.</p><pre><code>provider.onApprove(async (providerToken) =&gt; {
  this.transitionTo('tokenizing');
  const orderRes = await fetch(\`/v2/orders/\${this.apm}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: this.sessionId,
      rawToken: providerToken,
      amount: this.amount,
      merchantOrderId: this.merchantOrderId,
    }),
  });
  this.applyChOutcome(await orderRes.json());
});</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Exposing the CH <code>accessToken</code> on the provider-token POST so a clever client can bypass the merchant backend. The SDK deliberately does not send the access token on <code>/v2/orders/:apm</code> — the reference server looks it up server-side by <code>sessionId</code>.</p>` },
  { num: 8,  title: 'Merchant backend calls CH Orders with Bearer token (ADR-004)', body: `<p>This is the load-bearing ADR-004 wire contract: <strong>one</strong> CH endpoint (<code>/checkouts/v1/orders</code>) fans out to all 70 APMs via <code>paymentMethod.provider</code>. The <code>Authorization: Bearer {accessToken}</code> header comes from the cached session.</p><pre><code>const mapping = registry.get(req.params.apm);  // e.g. klarna → KLARNA

const body = {
  amount: { total: req.body.amount.total, currency: req.body.amount.currency },
  merchantOrderId: req.body.merchantOrderId,
  paymentSource: {
    sourceType: mapping.sourceType,                    // "PaymentToken"
    walletType: mapping.walletType ?? undefined,       // "APPLE_PAY"
    encryptedData: req.body.rawToken,
  },
  paymentMethod: {
    provider: mapping.chProvider.toUpperCase(),        // "KLARNA"
  },
  transactionDetails: {
    captureFlag: mapping.synchronous,                  // true = sale, false = auth-only
  },
  checkoutInteractions: {
    paymentInitiator: 'CUSTOMER',
    returnUrl: process.env.HARNESS_PUBLIC_URL + '/return',
    cancelUrl: process.env.HARNESS_PUBLIC_URL + '/cancel',
  },
};

const chRes = await fetch(process.env.CH_BASE_URL + '/checkouts/v1/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${session.accessToken}\`,   // REUSES token from step 5
    'Client-Request-Id': randomUUID(),
    'Api-Key': process.env.CH_API_KEY,
  },
  body: JSON.stringify(body),
});</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Lowercasing <code>paymentMethod.provider</code>. CH validates the provider string against an exact-match enum — <code>klarna</code>, <code>Klarna</code>, and <code>KLARNA</code> with trailing whitespace all fail with <em>invalid provider</em>.</p>` },
  { num: 9,  title: 'Synchronous sale path — CH returns 200 CAPTURED', body: `<p>For hero APMs that settle inline (Apple Pay, Google Pay), CH returns 200 with <code>transactionStatus: "CAPTURED"</code>. The reference server normalizes the outcome and the SDK transitions <code>tokenizing → authorizing → completed</code>. No webhook required.</p><pre><code>{
  "gatewayResponse": { "transactionState": "AUTHORIZED", "transactionType": "SALE" },
  "transactionStatus": "CAPTURED",
  "approvalCode": "OK1234",
  "transactionProcessingDetails": {
    "orderId": "CHG01JABCDEF",
    "transactionTimestamp": "2026-04-14T14:22:11Z"
  }
}</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Treating HTTP 200 as success without checking <code>transactionStatus</code>. CH can return 200 with <code>DECLINED</code> or <code>PAYER_ACTION_REQUIRED</code>; the outcome field, not the status code, is the source of truth.</p>` },
  { num: 10, title: 'Async pending path — PAYER_ACTION_REQUIRED and SSE', body: `<p>Redirect-pattern APMs (Klarna, iDEAL, PIX, most LATAM rails) return <code>transactionStatus: "PAYER_ACTION_REQUIRED"</code> with a <code>checkoutInteractions.actions.url</code>. The SDK transitions to <code>pending</code>, opens the redirect (or renders a QR for PIX), and subscribes to SSE. When the CH webhook arrives, the reference server verifies HMAC and fans the event over SSE, driving the SDK from <code>pending → completed</code>.</p><pre><code>// CH response
{
  "transactionStatus": "PAYER_ACTION_REQUIRED",
  "transactionProcessingDetails": { "orderId": "CHG01JXYZ" },
  "checkoutInteractions": {
    "actions": [
      { "type": "REDIRECT", "url": "https://pay.klarna.com/s/..." }
    ]
  }
}

// Browser SDK
const sse = new EventSource(\`/v2/events/\${sessionId}\`);
sse.addEventListener('message', (e) =&gt; {
  const next = JSON.parse(e.data);
  checkout.apply(next);   // 'completed' or 'failed'
});</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Closing the SSE connection when the tab is backgrounded. Mobile Safari aggressively suspends EventSource; the SDK reconnects on <code>visibilitychange</code>, but only if the merchant page keeps the checkout instance mounted.</p>` },
  { num: 11, title: 'Merchant-initiated capture — AUTHORIZED then /capture', body: `<p>For auth-then-capture flows, the merchant passes <code>transactionDetails.captureFlag=false</code> on the initial order. CH returns <code>AUTHORIZED</code>, the SDK transitions to <code>awaiting_merchant_capture</code>. When fulfillment is ready, the merchant backend calls <code>/v2/orders/:orderId/capture</code>, which re-hits <code>/checkouts/v1/orders</code> with a reference to the original transaction — reusing the same access token from step 5.</p><pre><code>// Capture body on the second call (same Bearer token)
{
  "amount": { "total": "49.99", "currency": "USD" },
  "transactionDetails": { "captureFlag": true },
  "referenceTransactionDetails": {
    "referenceTransactionId": "CHG01JAUTH0",
    "referenceTransactionType": "CHARGES"
  },
  "paymentMethod": { "provider": "PAYPAL" }
}</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Omitting <code>referenceTransactionType: "CHARGES"</code>. CH defaults to a refund-style reference and the capture 400s with <em>invalid reference transaction type</em>.</p>` },
  { num: 12, title: 'Error handling — 401, 425, circuit breaker, token refresh', body: `<p>The reference server centralizes error recovery. Rules: <strong>401</strong> from CH triggers a token re-mint + one retry; <strong>425 Too Early</strong> triggers exponential backoff (200/400/800ms, max 3 tries); <strong>breaker open</strong> fails fast with <code>E_BREAKER_OPEN</code>; <strong>token expired</strong> triggers a proactive re-mint.</p><pre><code>async function callCh(url, init, attempt = 0) {
  if (breaker.isOpen()) throw new SdkError('E_BREAKER_OPEN');
  if (session.expiresAt &lt; Date.now() + 30_000) await remintToken();

  const res = await fetch(url, withBearer(init, session.accessToken));

  if (res.status === 401 && attempt === 0) {
    await remintToken();
    return callCh(url, init, 1);
  }
  if (res.status === 425 && attempt &lt; 3) {
    await sleep(200 * 2 ** attempt);
    return callCh(url, init, attempt + 1);
  }
  if (!res.ok) breaker.recordFailure();
  else breaker.recordSuccess();
  return res;
}</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Retrying 401 in a loop without capping attempts. If the API secret is actually wrong, a retry loop will burn through rate limits and trip CH fraud controls in minutes.</p>` },
  { num: 13, title: 'Refund flow — /v2/orders/:orderId/refund', body: `<p>Refunds use the same <code>/checkouts/v1/orders</code> endpoint with a <code>referenceTransactionDetails</code> block pointing at the captured order. The reference server exposes this as <code>POST /v2/orders/:orderId/refund</code>.</p><pre><code>// Merchant → reference server
POST /v2/orders/CHG01JCAPTD/refund
{ "amount": { "total": "10.00", "currency": "USD" }, "reason": "customer_request" }

// Reference server → CH
{
  "amount": { "total": "10.00", "currency": "USD" },
  "transactionDetails": { "captureFlag": true },
  "referenceTransactionDetails": {
    "referenceTransactionId": "CHG01JCAPTD",
    "referenceTransactionType": "CHARGES"
  },
  "paymentMethod": { "provider": "KLARNA" }
}</code></pre><p class="pitfall"><strong>Common pitfall:</strong> Sending a refund for an APM that does not support merchant-initiated reversals (most LATAM rails). CH will return <code>NOT_SUPPORTED</code>; the adapter mapping's <code>supportsRefund</code> flag exists so the merchant backend can reject client-side before hitting CH.</p>` },
  { num: 14, title: 'Production readiness checklist', body: `<p>Before promoting a build to production, walk the checklist. Each item maps to a failure mode the team has actually hit.</p><ul><li><strong>HMAC signing live:</strong> <code>CH_API_SECRET</code> set from a secret manager, not a committed <code>.env</code>.</li><li><strong>HARNESS_MODE unset or <code>live</code>:</strong> refuse-production tripwire fails the boot if <code>mock</code> leaks into a prod image.</li><li><strong>CORS lockdown:</strong> <code>HARNESS_CORS_ORIGIN</code> is the exact merchant domain; no wildcard.</li><li><strong>Rate limits tuned:</strong> per-session <code>/v2/orders</code> limit; per-IP limit on <code>/v2/sessions</code>.</li><li><strong>Webhook HMAC verification enabled:</strong> verifier rejects unsigned payloads, does not just log a warning.</li><li><strong>Access token TTL respected:</strong> reference server re-mints at <code>expiresAt - 30s</code>; no long-lived tokens cached on disk.</li><li><strong>prefers-reduced-motion:</strong> harness + merchant UI honor the media query.</li><li><strong>Refuse-production tripwires armed:</strong> all 5 tripwires throw on boot.</li><li><strong>Structured logs with correlationId:</strong> every log line carries <code>sessionId</code>, <code>orderId</code>, <code>clientRequestId</code>; no raw PII.</li><li><strong>Metrics scraping:</strong> <code>/metrics</code> exposed, Prometheus scraping state-transition counters.</li></ul><p class="pitfall"><strong>Common pitfall:</strong> Treating the checklist as a one-time gate. The tripwires should be re-verified on every release — a single env-var rename in a Helm chart has been enough to silently drop <code>HARNESS_MODE</code> back to its default.</p>` },
];

export const MERMAID_DIAGRAMS = {
  sequenceSync: {
    title: 'Synchronous sale flow (with Credentials API)',
    description:
      'Browser → Merchant Backend (/v2/sessions) → CH Credentials API → CH Orders API with Bearer token → APM Provider → terminal state. /v2/* endpoints are merchant-own routes, not Commerce Hub routes.',
    source: `sequenceDiagram
    autonumber
    participant Browser as Browser SDK<br/>(merchant frontend)
    participant Merchant as Merchant Backend<br/>(reference-server / merchant)
    participant Creds as CH Credentials API<br/>/payments-vas/v1/security/credentials
    participant Orders as CH Orders API<br/>/checkouts/v1/orders
    participant Provider as APM Provider<br/>(PPRO / Klarna / PayPal...)

    Note over Browser,Merchant: /v2/sessions and /v2/orders/:apm are<br/>MERCHANT-OWN REST routes. The browser<br/>talks to the merchant backend — it NEVER<br/>calls Commerce Hub directly.
    Browser->>Merchant: POST /v2/sessions<br/>{ apm, amount, merchantOrderId }<br/>(merchant-own endpoint)
    Note over Merchant,Creds: Access token lives ONLY<br/>server-side. Never enters browser.
    Merchant->>Creds: POST /payments-vas/v1/security/credentials<br/>Headers: Api-Key, Client-Request-Id,<br/>Timestamp, Auth-Token-Type: HMAC,<br/>Authorization: HMAC-SHA256<br/>(this is the CH call)
    Creds-->>Merchant: 200 { accessToken, expiresAt }
    Merchant-->>Browser: 200 { sessionId, providerClientToken }<br/>(accessToken stays server-side)
    Note over Browser: SDK loads provider CDN,<br/>user clicks button,<br/>provider returns a single-use token
    Browser->>Merchant: POST /v2/orders/:apm<br/>{ sessionId, providerToken, amount }<br/>(merchant-own endpoint)
    Merchant->>Orders: POST /checkouts/v1/orders<br/>Authorization: Bearer {accessToken}<br/>paymentMethod.provider = UPPERCASE(apm)<br/>transactionDetails.captureFlag = true<br/>(this is the CH call)
    Orders->>Provider: CH internal fan-out<br/>(PPRO /v1/payment-charges, etc.)
    Provider-->>Orders: authorized
    Orders-->>Merchant: 200 { transactionState: CAPTURED,<br/>transactionId, orderId }
    Merchant-->>Browser: 200 orderResult
    Note over Browser: FSM authorizing → completed<br/>PAYMENT_COMPLETED fired`,
  },
  sequenceAsyncWebhook: {
    title: 'Asynchronous webhook flow (with Credentials API)',
    description:
      'iDEAL via PPRO. Browser → merchant (/v2/sessions, merchant-own route) → CH Credentials API → CH Orders → redirect URL → user auth at bank → webhook → SSE relay → SDK terminal. The string PPRO never appears on the wire.',
    source: `sequenceDiagram
    autonumber
    participant Browser as Browser SDK<br/>(merchant frontend)
    participant Merchant as Merchant Backend<br/>(reference-server / merchant)
    participant Creds as CH Credentials API<br/>/payments-vas/v1/security/credentials
    participant Orders as CH Orders API<br/>/checkouts/v1/orders
    participant Provider as APM Provider<br/>(iDEAL via PPRO)
    participant Cache as OrderResultCache<br/>(first-writer-wins)

    Note over Browser,Merchant: /v2/sessions, /v2/orders/:apm, /v2/webhooks/:provider,<br/>and /v2/events/:sessionId are MERCHANT-OWN routes.<br/>The browser never calls Commerce Hub directly.
    Browser->>Merchant: POST /v2/sessions (merchant-own)
    Merchant->>Creds: POST /payments-vas/v1/security/credentials<br/>HMAC signed (CH call)
    Creds-->>Merchant: 200 { accessToken, expiresAt }
    Merchant-->>Browser: { sessionId }
    Browser->>Merchant: POST /v2/orders/ideal (merchant-own)
    Merchant->>Orders: POST /checkouts/v1/orders<br/>Authorization: Bearer {accessToken}<br/>paymentMethod.provider = "IDEAL"<br/>(CH call)
    Orders->>Provider: internal fan-out<br/>CH → PPRO /v1/payment-charges
    Orders-->>Merchant: 200 PAYER_ACTION_REQUIRED<br/>{ checkoutInteractions.actions.url }
    Merchant-->>Browser: { redirectUrl }
    Note over Browser: FSM → pending<br/>REDIRECT_REQUIRED fired<br/>SSE /v2/events/:sessionId opened (merchant-own)
    Provider-->>Provider: user authorizes<br/>at bank
    Provider->>Orders: settlement
    Orders->>Merchant: POST /v2/webhooks/:provider (merchant-own)<br/>HMAC signature verified
    Merchant->>Cache: write(orderId, completed)
    Cache-->>Merchant: first-writer-wins ack<br/>(ignores duplicate webhook)
    Merchant-->>Browser: SSE event: payment.succeeded
    Note over Browser: FSM pending → completed<br/>PAYMENT_COMPLETED fired`,
  },
  sequenceMerchantCapture: {
    title: 'Merchant-initiated capture flow (with Credentials API)',
    description:
      'AUTHORIZE-only → awaiting_merchant_capture → explicit merchant-driven capture call (reuses the same access token) → completed. Every /v2/* call is browser-to-merchant; CH is only called server-side.',
    source: `sequenceDiagram
    autonumber
    participant Browser as Browser SDK<br/>(merchant frontend)
    participant Merchant as Merchant Backend<br/>(reference-server / merchant)
    participant Creds as CH Credentials API<br/>/payments-vas/v1/security/credentials
    participant Orders as CH Orders API<br/>/checkouts/v1/orders

    Note over Browser,Merchant: /v2/sessions, /v2/orders/:apm, and<br/>/v2/orders/:orderId/capture are ALL<br/>merchant-own REST routes.
    Browser->>Merchant: POST /v2/sessions (merchant-own)<br/>{ paymentInitiator: MERCHANT }
    Merchant->>Creds: POST /payments-vas/v1/security/credentials<br/>HMAC signed (CH call)
    Creds-->>Merchant: 200 { accessToken, expiresAt }
    Merchant-->>Browser: { sessionId }
    Note over Merchant: Merchant caches accessToken<br/>until expiresAt for the<br/>follow-up capture call
    Browser->>Merchant: POST /v2/orders/:apm (merchant-own)<br/>(user tokenized at provider)
    Merchant->>Orders: POST /checkouts/v1/orders<br/>Authorization: Bearer {accessToken}<br/>transactionDetails.captureFlag = false<br/>(CH call — auth-only)
    Orders-->>Merchant: 200 AUTHORIZED<br/>{ transactionId, orderId }
    Merchant-->>Browser: AWAITING_MERCHANT_CAPTURE
    Note over Browser: FSM → awaiting_merchant_capture<br/>AWAITING_MERCHANT_CAPTURE fired
    Note over Merchant: Operator runs fraud check,<br/>inventory hold, risk scoring,<br/>then triggers capture
    Browser->>Merchant: POST /v2/orders/:orderId/capture (merchant-own)
    Merchant->>Orders: POST /checkouts/v1/orders<br/>Authorization: Bearer {accessToken} (reused)<br/>transactionDetails.captureFlag = true<br/>referenceTransactionDetails.referenceTransactionId<br/>(second CH call)
    Orders-->>Merchant: 200 CAPTURED
    Merchant-->>Browser: PAYMENT_COMPLETED
    Note over Browser: FSM capturing → completed`,
  },
  stateMachine: {
    title: 'State machine (ADR-003)',
    description: '11 states × 18 legal transitions',
    source: `stateDiagram-v2
    [*] --> idle
    idle --> initializing
    initializing --> ready
    initializing --> failed
    initializing --> script_load_failed
    ready --> authorizing
    authorizing --> completed
    authorizing --> pending
    authorizing --> awaiting_merchant_capture
    authorizing --> failed
    authorizing --> cancelled
    pending --> awaiting_merchant_capture
    pending --> completed
    pending --> failed
    pending --> cancelled
    awaiting_merchant_capture --> capturing
    awaiting_merchant_capture --> cancelled
    awaiting_merchant_capture --> auth_expired
    capturing --> completed
    capturing --> failed
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
    auth_expired --> [*]
    script_load_failed --> [*]`,
  },
  classHierarchy: {
    title: 'Class hierarchy',
    description: 'BaseAdapter → 6 base classes → 70 concrete adapters',
    source: `classDiagram
    class BaseAdapter {
      +string id
      +string chSourceType
      +string chProvider
      +init()
      +authorize()
      +capture()
      +void()
      +destroy()
    }
    class RedirectBase {
      +buildRedirectUrl()
      +handleReturn()
    }
    class BnplBase {
      +loadProviderSdk()
      +tokenize()
    }
    class NativeWalletBase {
      +requestPaymentSheet()
      +onPaymentAuthorized()
    }
    class ButtonSdkBase {
      +loadProviderSdk()
      +mountButton()
      +onApprove()
    }
    class QrBase {
      +renderQr()
      +pollOrAwaitWebhook()
    }
    class VoucherBase {
      +renderVoucher()
      +awaitOfflineSettlement()
    }
    BaseAdapter <|-- RedirectBase
    BaseAdapter <|-- BnplBase
    BaseAdapter <|-- NativeWalletBase
    BaseAdapter <|-- ButtonSdkBase
    BaseAdapter <|-- QrBase
    BaseAdapter <|-- VoucherBase
    RedirectBase <|-- iDEAL
    RedirectBase <|-- SOFORT
    BnplBase <|-- Klarna
    BnplBase <|-- Afterpay
    NativeWalletBase <|-- ApplePay
    NativeWalletBase <|-- GooglePay
    ButtonSdkBase <|-- PayPal
    ButtonSdkBase <|-- CashApp
    QrBase <|-- WeChatPay
    QrBase <|-- Alipay
    VoucherBase <|-- Boleto
    VoucherBase <|-- OXXO`,
  },
  adapterHierarchy: {
    title: 'Adapter hierarchy (70 APMs)',
    description: 'Registry → 6 base classes → concrete adapters',
    source: `flowchart LR
    R[APM Registry<br/>70 methods]
    R --> Re[RedirectBase]
    R --> Tk[BnplBase]
    R --> Nw[NativeWalletBase]
    R --> Bu[ButtonSdkBase]
    R --> Qr[QrBase]
    R --> Vo[VoucherBase]
    Re --> iDEAL
    Re --> SOFORT
    Re --> Giropay
    Re --> Bancontact
    Re --> PPRO54[+54 PPRO methods]
    Tk --> Klarna
    Tk --> Afterpay
    Tk --> Affirm
    Tk --> Sezzle
    Tk --> Zip
    Nw --> ApplePay
    Nw --> GooglePay
    Bu --> PayPal
    Bu --> PayLater
    Bu --> Venmo
    Bu --> CashApp
    Qr --> WeChatPay
    Qr --> Alipay
    Qr --> PIX
    Qr --> UPI
    Vo --> Boleto
    Vo --> OXXO
    Vo --> Konbini`,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Per-hero cookbooks (7 entries). Each cookbook has a full realistic
// wire request/response pair, 6-8 integration steps, 5 error paths,
// sandbox credential instructions, and common pitfalls.
// Drafted by the technical-writer agent. Rendered in Docs under the
// "APM Cookbooks" nav group by docs.js.
// ─────────────────────────────────────────────────────────────────────
export const HERO_COOKBOOKS = [
  {
    apm: 'klarna',
    displayName: 'Klarna Pay Later',
    pattern: 'redirect-async',
    chProvider: 'KLARNA',
    tldr: 'BNPL widget, Klarna-hosted approval, async webhook settles the order.',
    overview: `Klarna is the dominant Buy Now Pay Later provider across Europe and increasingly in North America. Merchants offer it at checkout to raise average order value and reach shoppers who will not use a card. The v2.2 Klarna adapter loads the Klarna Payments widget, collects a client token from the merchant backend, and on approval hands a <code>authorization_token</code> to the backend, which sends it to Commerce Hub as a KLARNA order. Final settlement is asynchronous and driven by a Klarna webhook that CH forwards to the merchant backend.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken from /payments-vas/v1/security/credentials>',
      amount: { total: '129.00', currency: 'USD' },
      merchantOrderId: 'ord_klarna_01HV5',
      paymentSource: { sourceType: 'PaymentToken', encryptedData: 'klarna_auth_token_ey...' },
      paymentMethod: { provider: 'KLARNA' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER', returnUrl: 'https://shop.example.com/return', cancelUrl: 'https://shop.example.com/cancel' },
      billingAddress: { firstName: 'Jane', lastName: 'Doe', address: { country: 'US', postalCode: '94107' } },
    },
    wireResponse: {
      transactionStatus: 'PAYER_ACTION_REQUIRED',
      transactionProcessingDetails: { orderId: 'CHG01KLARNA1' },
      checkoutInteractions: { actions: [{ type: 'REDIRECT', url: 'https://pay.klarna.com/s/abc123' }] },
    },
    steps: [
      { num: 1, title: 'Register the adapter', body: `<p>The Klarna adapter is pre-registered in <code>checkout-sdk-browser</code> under the id <code>klarna</code>. Confirm it is loaded before booting the SDK.</p><pre><code>import { registry } from '@fiserv/checkout-sdk-browser';
console.assert(registry.has('klarna'));</code></pre>` },
      { num: 2, title: 'Mint a client token', body: `<p>Call Klarna's <code>/payments/v1/sessions</code> server-side to mint a client token, and return it inside the <code>/v2/sessions</code> response so the adapter can boot the widget.</p>` },
      { num: 3, title: 'Load the Klarna JS SDK', body: `<p>The adapter lazy-loads <code>x.klarnacdn.net/kp/lib/v1/api.js</code> on first render. Ensure your CSP allows the origin.</p><pre><code>script-src 'self' https://x.klarnacdn.net;</code></pre>` },
      { num: 4, title: 'Render the widget', body: `<p>Call <code>render()</code> on the SDK; the adapter mounts the Klarna widget into the selector you passed as <code>mount</code>.</p>` },
      { num: 5, title: 'Collect the authorization token', body: `<p>When the user consents, Klarna fires <code>authorize</code> with an <code>authorization_token</code>. The adapter forwards it to <code>/v2/orders/klarna</code>.</p>` },
      { num: 6, title: 'Send the CH order', body: `<p>Merchant backend calls <code>/checkouts/v1/orders</code> with <code>paymentMethod.provider="KLARNA"</code> and the authorization token in <code>paymentSource.encryptedData</code>.</p>` },
      { num: 7, title: 'Handle PAYER_ACTION_REQUIRED', body: `<p>CH returns a redirect URL. The adapter opens it and subscribes to SSE for the final outcome.</p>` },
      { num: 8, title: 'Settle via webhook', body: `<p>Klarna sends a CAPTURED webhook to CH, CH signs and forwards it, the SSE channel emits <code>state=completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_KLARNA_SESSION_EXPIRED', cause: 'Client token older than 48h', recovery: 'Remint /payments/v1/sessions and reboot the adapter' },
      { code: 'E_KLARNA_REJECTED', cause: 'Klarna risk engine declined the shopper', recovery: 'Offer alternative APM; do not retry the same token' },
      { code: 'E_BILLING_COUNTRY_UNSUPPORTED', cause: 'purchase_country not enabled on the Klarna merchant', recovery: 'Enable in Klarna Merchant Portal, not a code fix' },
      { code: 'E_CH_PROVIDER_ENUM', cause: 'Lowercase klarna sent to CH', recovery: 'Uppercase in the adapter mapping' },
      { code: 'E_WEBHOOK_HMAC', cause: 'Webhook HMAC signature did not verify', recovery: 'Rotate WEBHOOK_HMAC_KEY, confirm clock skew under 5min' },
    ],
    sandboxCredentials: 'Request a Klarna Playground merchant at https://portal.playground.klarna.com. Set KLARNA_USERNAME, KLARNA_PASSWORD, KLARNA_REGION in the reference server .env.',
    commonPitfalls: `<ul><li>Klarna Playground tokens are region-locked; a US token will silently fail against EU endpoints.</li><li>The client token TTL is short (about 48h); never cache it beyond the browser session.</li><li>OnsiteMessaging requires a separate <code>data-key</code> that is not the same as the payments client token.</li><li>Klarna expects billing country at session mint time, not order time; mismatches 400 at <code>/v1/sessions</code>.</li><li>Shipping to a PO Box will get silently downgraded to a Pay Now flow on some Klarna markets.</li></ul>`,
  },
  {
    apm: 'paypal',
    displayName: 'PayPal Checkout',
    pattern: 'popup-sync-or-auth',
    chProvider: 'PAYPAL',
    tldr: 'PayPal Buttons, optional auth-then-capture, shipping callbacks supported.',
    overview: `PayPal is the broadest-reach digital wallet for merchants selling into North America and Europe. The v2.2 adapter loads the PayPal JS SDK with your client-id and currency, mounts the Smart Buttons, and on approval forwards the PayPal order id to the merchant backend. Both synchronous capture (sale) and authorize-then-capture map to the same <code>/checkouts/v1/orders</code> contract with different <code>captureFlag</code> values.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '74.50', currency: 'USD' },
      merchantOrderId: 'ord_paypal_01HV5',
      paymentSource: { sourceType: 'DecryptedWallet', walletType: 'PAYPAL', encryptedData: 'paypal_order_id_4KA01234' },
      paymentMethod: { provider: 'PAYPAL' },
      transactionDetails: { captureFlag: false },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER' },
    },
    wireResponse: {
      transactionStatus: 'AUTHORIZED',
      approvalCode: 'PAYPAL_OK',
      transactionProcessingDetails: { orderId: 'CHG01PP0001' },
    },
    steps: [
      { num: 1, title: 'Load PayPal SDK', body: `<p>Adapter loads <code>https://www.paypal.com/sdk/js?client-id=...&currency=USD</code>.</p>` },
      { num: 2, title: 'Mount buttons', body: `<p><code>render()</code> calls <code>paypal.Buttons({ createOrder, onApprove, onShippingChange }).render(selector)</code>.</p>` },
      { num: 3, title: 'createOrder callback', body: `<p>Adapter posts to <code>/v2/orders/paypal/intent</code> which calls PayPal Orders API v2 to create the order and returns the <code>id</code>.</p>` },
      { num: 4, title: 'Shipping callback', body: `<p>If the merchant wired <code>onShippingChange</code>, the adapter proxies to <code>/v2/orders/paypal/shipping</code> to recalc tax.</p>` },
      { num: 5, title: 'onApprove', body: `<p>Adapter forwards the <code>orderID</code> to the merchant backend; backend sends CH Orders with <code>captureFlag=false</code>.</p>` },
      { num: 6, title: 'CH returns AUTHORIZED', body: `<p>SDK transitions to <code>awaiting_merchant_capture</code>.</p>` },
      { num: 7, title: 'Capture on fulfillment', body: `<p>Merchant backend calls <code>/v2/orders/:orderId/capture</code>, CH returns CAPTURED, SDK transitions to <code>completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_PAYPAL_INSTRUMENT_DECLINED', cause: 'PayPal declined the funding source', recovery: 'SDK surfaces restart; shopper picks a new instrument' },
      { code: 'E_PAYPAL_POPUP_BLOCKED', cause: 'Browser blocked the PayPal popup', recovery: 'Render inside a user gesture; do not auto-trigger' },
      { code: 'E_CURRENCY_MISMATCH', cause: 'SDK loaded with currency=USD but order is EUR', recovery: 'Reload SDK with correct currency' },
      { code: 'E_CH_AUTH_EXPIRED', cause: 'Captured after 29-day authorization window', recovery: 'Create a new order; PayPal auths expire' },
      { code: 'E_REFUND_WINDOW', cause: 'Refund attempted after 180 days', recovery: 'Not recoverable via CH; handle via PayPal dispute flow' },
    ],
    sandboxCredentials: 'Sign up at https://developer.paypal.com, create a sandbox app, copy client-id and secret. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET in the reference server .env.',
    commonPitfalls: `<ul><li>PayPal SDK currency is set at script load; changing currency mid-session requires a full reload.</li><li>Shipping callbacks must return synchronously within 5 seconds or the buttons error out.</li><li>The <code>orderID</code> from PayPal is not the same as the CH <code>orderId</code>; do not confuse in logs.</li><li>Sandbox Venmo buttons only render in the US locale with a US buyer.</li><li>Auth-only flows expire after 29 days; beyond that CH rejects the capture call.</li></ul>`,
  },
  {
    apm: 'applepay',
    displayName: 'Apple Pay',
    pattern: 'native-sync',
    chProvider: 'APPLEPAY',
    tldr: 'Safari-only native sheet, domain-verified, settles inline via CH.',
    overview: `Apple Pay provides a native-sheet payment experience on Safari on iOS, iPadOS, and macOS. The v2.2 adapter uses the Apple Pay JS API to request a merchant session, prompts the shopper for Touch ID or Face ID, and hands the opaque <code>PaymentToken</code> to the merchant backend. CH decrypts it on the merchant's behalf using the merchant-id pairing, and the order settles inline with <code>CAPTURED</code>.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '19.99', currency: 'USD' },
      merchantOrderId: 'ord_ap_01HV5',
      paymentSource: { sourceType: 'DecryptedWallet', walletType: 'APPLE_PAY', encryptedData: '<base64 PKPaymentToken.paymentData>' },
      paymentMethod: { provider: 'APPLEPAY' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER' },
    },
    wireResponse: {
      transactionStatus: 'CAPTURED',
      approvalCode: 'AP000123',
      transactionProcessingDetails: { orderId: 'CHG01AP00001' },
    },
    steps: [
      { num: 1, title: 'Verify domain', body: `<p>Host <code>.well-known/apple-developer-merchantid-domain-association</code> at each merchant domain and verify in the Apple Developer Portal.</p>` },
      { num: 2, title: 'Pair merchant id with CH', body: `<p>In Fiserv CH, associate your <code>merchant.com.example</code> identifier with the CH merchant profile. CH will decrypt on your behalf.</p>` },
      { num: 3, title: 'Feature detect', body: `<p>Adapter gates rendering on <code>window.ApplePaySession && ApplePaySession.canMakePayments()</code>.</p>` },
      { num: 4, title: 'Create PaymentRequest', body: `<p>Adapter builds a <code>PKPaymentRequest</code> with supported networks, country, currency, line items.</p><pre><code>new ApplePaySession(6, request);</code></pre>` },
      { num: 5, title: 'onvalidatemerchant', body: `<p>Adapter posts to <code>/v2/orders/applepay/session</code>; reference server calls Apple and returns the merchant session.</p>` },
      { num: 6, title: 'onpaymentauthorized', body: `<p>Adapter forwards the <code>PKPaymentToken.paymentData</code>; backend sends CH Orders with <code>walletType: "APPLE_PAY"</code>.</p>` },
      { num: 7, title: 'CH returns CAPTURED', body: `<p>Adapter calls <code>session.completePayment(SUCCESS)</code> and transitions to <code>completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_AP_UNSUPPORTED', cause: 'Browser is not Safari or device has no cards', recovery: 'Hide the Apple Pay button; fall back to a different hero' },
      { code: 'E_AP_DOMAIN_UNVERIFIED', cause: 'Domain file missing from .well-known', recovery: 'Deploy the association file; Apple re-verifies on next request' },
      { code: 'E_AP_MERCHANT_SESSION', cause: 'Apple session request failed', recovery: 'Confirm merchant id pairing and CH domain verification' },
      { code: 'E_AP_CARD_DECLINED', cause: 'Issuer declined the underlying card', recovery: 'completePayment(FAILURE); prompt shopper to pick a different card' },
      { code: 'E_CH_DECRYPT', cause: 'CH could not decrypt the paymentData', recovery: 'Check merchant id pairing in CH; often a staging/prod mix-up' },
    ],
    sandboxCredentials: 'Apple Pay has no separate sandbox; use a real Apple Developer account, register a merchant identifier, pair it with Fiserv Commerce Hub cert environment, and test with a real card on a real device.',
    commonPitfalls: `<ul><li>Apple Pay only renders in Safari for the native sheet; Chrome on macOS does not support it.</li><li>The domain association file must be served from every exact domain, including www vs apex.</li><li>Supported networks must match what the CH merchant profile allows.</li><li>Line item totals must match the PaymentRequest total to the cent; rounding bugs produce an immediate session invalidation.</li><li>Apple Pay on the web on iOS requires the user to complete the sheet within 60 seconds.</li></ul>`,
  },
  {
    apm: 'googlepay',
    displayName: 'Google Pay',
    pattern: 'native-sync',
    chProvider: 'GOOGLEPAY',
    tldr: 'Google Pay sheet, TEST environment for sandbox, gatewayMerchantId required.',
    overview: `Google Pay gives merchants access to tokenized card credentials stored in the user's Google account, across Chrome on desktop and Android. The v2.2 adapter loads <code>pay.js</code>, builds a <code>PaymentDataRequest</code> with <code>environment: TEST</code> in sandbox, and on approval forwards the opaque token to the merchant backend. CH unwraps the token and settles inline.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '42.00', currency: 'USD' },
      merchantOrderId: 'ord_gp_01HV5',
      paymentSource: { sourceType: 'DecryptedWallet', walletType: 'GOOGLE_PAY', encryptedData: '<google pay token JSON>' },
      paymentMethod: { provider: 'GOOGLEPAY' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER' },
    },
    wireResponse: {
      transactionStatus: 'CAPTURED',
      approvalCode: 'GP00099',
      transactionProcessingDetails: { orderId: 'CHG01GP00001' },
    },
    steps: [
      { num: 1, title: 'Load pay.js', body: `<p>Adapter lazy-loads <code>https://pay.google.com/gp/p/js/pay.js</code>.</p>` },
      { num: 2, title: 'isReadyToPay', body: `<p>Adapter calls <code>google.payments.api.PaymentsClient.isReadyToPay</code> before rendering. In sandbox, pass <code>environment: 'TEST'</code>.</p>` },
      { num: 3, title: 'Configure gateway', body: `<p>Tokenization spec: <code>type: 'PAYMENT_GATEWAY'</code>, <code>gateway: 'fiserv'</code>, <code>gatewayMerchantId</code> = your Fiserv merchant id.</p>` },
      { num: 4, title: 'Render button', body: `<p>Adapter calls <code>createButton</code> and mounts it.</p>` },
      { num: 5, title: 'loadPaymentData', body: `<p>On click, adapter calls <code>loadPaymentData</code>, shopper picks a card, returns the token.</p>` },
      { num: 6, title: 'Forward to backend', body: `<p>Adapter POSTs the token to <code>/v2/orders/googlepay</code>.</p>` },
      { num: 7, title: 'CH returns CAPTURED', body: `<p>SDK transitions to <code>completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_GP_NOT_READY', cause: 'isReadyToPay returned false', recovery: 'Hide the button; fall back to a different hero' },
      { code: 'E_GP_BUYER_CANCELED', cause: 'User dismissed the sheet', recovery: 'Transition back to idle; allow retry' },
      { code: 'E_GP_INVALID_GATEWAY', cause: 'gatewayMerchantId not registered with Fiserv', recovery: 'Register in CH merchant profile' },
      { code: 'E_GP_UNSUPPORTED_NETWORK', cause: 'Shopper card network not in allowedCardNetworks', recovery: 'Expand allowedCardNetworks' },
      { code: 'E_CH_DECRYPT', cause: 'CH failed to unwrap the Google token', recovery: 'Confirm TEST vs PRODUCTION environment matches CH side' },
    ],
    sandboxCredentials: "Enable <code>environment: 'TEST'</code> in the Google Pay config. No account needed for TEST; cards are simulated.",
    commonPitfalls: `<ul><li>Forgetting to flip <code>environment</code> from TEST to PRODUCTION is the #1 Google Pay incident.</li><li><code>gatewayMerchantId</code> is the Fiserv merchant id, not your Google merchant id.</li><li>Google Pay on iOS Safari renders but the sheet is a web fallback, not native.</li><li><code>allowedCardNetworks</code> is case sensitive: <code>VISA</code> works, <code>Visa</code> does not.</li><li>Sandbox TEST tokens always decrypt as test data.</li></ul>`,
  },
  {
    apm: 'cashapp',
    displayName: 'Cash App Pay',
    pattern: 'mobile-deep-link-sync',
    chProvider: 'CASHAPP',
    tldr: 'Cash App Pay kit, sandbox CDN at sandbox.kit.cash.app, deep-links to the Cash App.',
    overview: `Cash App Pay lets shoppers pay with their Cash App balance. The v2.2 adapter loads the Cash App Pay Kit script and renders a button that deep-links into the mobile app on phones or shows a QR on desktop. On approval, the adapter receives a grant id which the merchant backend sends to CH as a CASHAPP order.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '23.00', currency: 'USD' },
      merchantOrderId: 'ord_ca_01HV5',
      paymentSource: { sourceType: 'PaymentToken', encryptedData: 'grnt_01HVCASHAPPGRANT' },
      paymentMethod: { provider: 'CASHAPP' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER' },
    },
    wireResponse: {
      transactionStatus: 'CAPTURED',
      approvalCode: 'CA0045',
      transactionProcessingDetails: { orderId: 'CHG01CA00001' },
    },
    steps: [
      { num: 1, title: 'Load Pay Kit', body: `<p>Adapter lazy-loads <code>https://sandbox.kit.cash.app/v1/pay.js</code> in sandbox.</p>` },
      { num: 2, title: 'Init with client id', body: `<p>Adapter calls <code>Square.payments(clientId).cashAppPay(request)</code>.</p>` },
      { num: 3, title: 'Attach button', body: `<p><code>cashAppPay.attach(selector, { shape: 'semiround' })</code>.</p>` },
      { num: 4, title: 'tokenize event', body: `<p>Adapter listens for <code>ontokenization</code>; on success, forwards the <code>tokenResult.token</code>.</p>` },
      { num: 5, title: 'Send CH order', body: `<p>Merchant backend sends CH Orders with <code>provider=CASHAPP</code> and the grant id.</p>` },
      { num: 6, title: 'CAPTURED', body: `<p>Sync settlement, SDK transitions to <code>completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_CA_NO_APP', cause: 'Deep link failed, no Cash App installed', recovery: 'Fall back to QR on desktop' },
      { code: 'E_CA_DECLINED', cause: 'Insufficient Cash App balance', recovery: 'Shopper selects a different APM' },
      { code: 'E_CA_GRANT_EXPIRED', cause: 'Grant id older than 15 minutes', recovery: 'Restart tokenization' },
      { code: 'E_CA_SANDBOX_LIVE_MIX', cause: 'Sandbox client id used against live CDN', recovery: 'Ensure CASHAPP_ENV matches HARNESS_MODE' },
      { code: 'E_CH_DECRYPT', cause: 'CH rejected the grant id', recovery: 'Confirm client id matches the CH merchant profile' },
    ],
    sandboxCredentials: 'Sign up at https://developer.squareup.com, create a Sandbox application, copy Sandbox Application ID and Access Token.',
    commonPitfalls: `<ul><li>Loading <code>kit.cash.app</code> in sandbox by mistake produces a silent <em>invalid client id</em>.</li><li>Cash App Pay grant ids expire in 15 minutes.</li><li>Desktop QR requires the shopper to be logged into the Cash App on their phone.</li><li>Deep link URIs must be registered with Cash App in production; localhost works in sandbox only.</li></ul>`,
  },
  {
    apm: 'ideal',
    displayName: 'iDEAL (via PPRO)',
    pattern: 'redirect-async',
    chProvider: 'IDEAL',
    tldr: 'Dutch bank redirect, PPRO-routed server-side, wire always says IDEAL.',
    overview: `iDEAL is the dominant bank-redirect payment method in the Netherlands, used by over 70% of Dutch online shoppers. In v2.2, iDEAL is routed through PPRO on the Commerce Hub side, but <strong>the string "PPRO" never appears on the wire</strong>. The merchant backend sends <code>paymentMethod.provider = "IDEAL"</code> and CH internally fans out to PPRO's <code>/v1/payment-charges</code>.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '29.95', currency: 'EUR' },
      merchantOrderId: 'ord_ideal_01HV5',
      paymentSource: { sourceType: 'PaymentToken', encryptedData: 'bank=INGBNL2A' },
      paymentMethod: { provider: 'IDEAL' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER', returnUrl: 'https://shop.example.nl/return', cancelUrl: 'https://shop.example.nl/cancel' },
    },
    wireResponse: {
      transactionStatus: 'PAYER_ACTION_REQUIRED',
      transactionProcessingDetails: { orderId: 'CHG01IDEAL1' },
      checkoutInteractions: { actions: [{ type: 'REDIRECT', url: 'https://secure.ppro.com/ideal/redirect/abc' }] },
    },
    steps: [
      { num: 1, title: 'Render bank picker', body: `<p>Adapter renders a select with the 10 common Dutch iDEAL issuers keyed by their BIC.</p>` },
      { num: 2, title: 'Collect BIC', body: `<p>On submit, the adapter packages <code>bank=&lt;BIC&gt;</code> into <code>encryptedData</code>.</p>` },
      { num: 3, title: 'Send CH order', body: `<p>Backend sends <code>/checkouts/v1/orders</code> with <code>provider=IDEAL</code>. CH routes to PPRO internally.</p>` },
      { num: 4, title: 'Receive redirect', body: `<p>CH returns PAYER_ACTION_REQUIRED with a redirect URL.</p>` },
      { num: 5, title: 'Redirect shopper', body: `<p>Adapter navigates the top window (iDEAL does not support iframe).</p>` },
      { num: 6, title: 'Return URL', body: `<p>Shopper lands on <code>returnUrl</code>, adapter reopens and subscribes to SSE.</p>` },
      { num: 7, title: 'Webhook settles', body: `<p>CH posts a signed webhook from PPRO; SDK transitions to <code>completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_IDEAL_BANK_UNAVAILABLE', cause: 'Selected bank temporarily offline', recovery: 'Surface error; let shopper pick another bank' },
      { code: 'E_IDEAL_TIMEOUT', cause: 'Shopper did not complete within 30 minutes', recovery: 'CH sends a failed webhook; transition to failed' },
      { code: 'E_PPRO_ROUTE_MISSING', cause: 'CH merchant profile does not have PPRO enabled', recovery: 'Enable in Fiserv merchant portal' },
      { code: 'E_CURRENCY_NOT_EUR', cause: 'iDEAL only supports EUR', recovery: 'Reject client-side' },
      { code: 'E_WEBHOOK_HMAC', cause: 'Webhook signature invalid', recovery: 'Rotate WEBHOOK_HMAC_KEY' },
    ],
    sandboxCredentials: 'iDEAL sandbox is provisioned through your Fiserv merchant profile; PPRO sandbox is handled server-side. Confirm with your Fiserv implementation manager that the IDEAL rail is enabled on your cert MID.',
    commonPitfalls: `<ul><li>Putting <code>PPRO</code> anywhere in the wire payload; the adapter must only ever emit <code>IDEAL</code>.</li><li>iDEAL only supports EUR and only for Dutch shoppers.</li><li>iDEAL does not work inside an iframe; always redirect the top window.</li><li>The bank picker BICs drift over time; refresh at least quarterly.</li><li>Webhook settlement can lag by several minutes; never timeout pending state faster than 10 minutes.</li></ul>`,
  },
  {
    apm: 'pix',
    displayName: 'PIX (Brazil)',
    pattern: 'qr-async',
    chProvider: 'PIX',
    tldr: 'QR code flow, shopper pays from their bank app, webhook settles.',
    overview: `PIX is the Brazilian Central Bank's instant payment rail and now accounts for more than half of Brazilian ecommerce. The v2.2 adapter renders a QR code and a copy-pasteable text payload. The shopper scans from their bank app, the bank authorizes in seconds, and the Brazilian Central Bank posts a settlement event. The SDK lives in <code>pending</code> until the webhook arrives.`,
    wireRequest: {
      '// header': 'Authorization: Bearer <accessToken>',
      amount: { total: '150.00', currency: 'BRL' },
      merchantOrderId: 'ord_pix_01HV5',
      paymentSource: { sourceType: 'PIX' },
      paymentMethod: { provider: 'PIX' },
      transactionDetails: { captureFlag: true },
      checkoutInteractions: { paymentInitiator: 'CUSTOMER' },
    },
    wireResponse: {
      transactionStatus: 'PAYER_ACTION_REQUIRED',
      transactionProcessingDetails: { orderId: 'CHG01PIX0001' },
      checkoutInteractions: { actions: [{ type: 'QR_CODE', qrText: '00020126580014br.gov.bcb.pix...6304ABCD', expiresAt: '2026-04-14T15:00:00Z' }] },
    },
    steps: [
      { num: 1, title: 'Request PIX order', body: `<p>Backend calls CH Orders with <code>provider=PIX</code> and no payer token.</p>` },
      { num: 2, title: 'CH returns QR payload', body: `<p>Response includes <code>qrText</code> and <code>expiresAt</code>.</p>` },
      { num: 3, title: 'Render QR', body: `<p>Adapter renders the QR image and a copy button for the text payload.</p>` },
      { num: 4, title: 'Subscribe SSE', body: `<p>Adapter opens <code>/v2/events/:sessionId</code>.</p>` },
      { num: 5, title: 'Shopper scans', body: `<p>Shopper opens their Brazilian bank app, scans, confirms.</p>` },
      { num: 6, title: 'Webhook arrives', body: `<p>CH forwards PIX settlement webhook; reference server verifies HMAC and emits SSE.</p>` },
      { num: 7, title: 'SDK transitions', body: `<p><code>pending → completed</code>.</p>` },
    ],
    errorPaths: [
      { code: 'E_PIX_QR_EXPIRED', cause: 'Shopper did not scan before expiresAt', recovery: 'Generate a new order; PIX QRs are not reusable' },
      { code: 'E_PIX_CURRENCY', cause: 'Non-BRL currency submitted', recovery: 'Reject client-side; PIX only supports BRL' },
      { code: 'E_PIX_CPF_INVALID', cause: 'Merchant profile missing CPF/CNPJ', recovery: 'Update CH merchant profile' },
      { code: 'E_PIX_WEBHOOK_LATE', cause: 'Webhook delayed beyond SDK timeout', recovery: 'Extend pending timeout to 15 minutes for PIX' },
      { code: 'E_CH_BRAZIL_COMPLIANCE', cause: 'Missing payer document id when required', recovery: 'Collect CPF in merchant UI before placing order' },
    ],
    sandboxCredentials: 'PIX sandbox is enabled per merchant on the Fiserv Brazil environment. Contact your Fiserv Brazil implementation manager.',
    commonPitfalls: `<ul><li>PIX QRs are single-use and expire in 15-30 minutes; do not cache them.</li><li>The <code>qrText</code> is an EMV-standard string, not a URL; render via a QR generator.</li><li>PIX refunds must be initiated within 90 days.</li><li>Webhook arrival varies from seconds to minutes; do not time out aggressively.</li><li>Some merchant profiles require CPF or CNPJ on the order.</li></ul>`,
  },
];

// ─────────────────────────────────────────────────────────────────────
// "Why this architecture" — 6 problem/solution cards explaining the
// rationale behind the 11 states, 18 transitions, 6 base classes,
// single CH endpoint, HARNESS_MODE tripwires, and three-package split.
// ─────────────────────────────────────────────────────────────────────
export const WHY_ARCHITECTURE = [
  {
    id: 'why-states',
    title: 'Why 11 discrete states, not 3',
    problem: `v1 modeled the SDK lifecycle as <code>idle</code>, <code>running</code>, <code>done</code>. That was cheap to implement but expensive to operate. Pending flows, merchant-initiated capture, and webhook-driven completion all collapsed into <code>running</code>, so support engineers could not tell a stuck Klarna redirect from a healthy capture-pending PayPal from a successfully-settled iDEAL waiting on a lagging webhook. Metrics dashboards were useless because every non-terminal state rolled up to the same counter.`,
    solution: `v2.2 ADR-003 defines 11 explicit states that map one-to-one to the real phases of an APM order: <code>idle</code>, <code>initializing</code>, <code>ready</code>, <code>authorizing</code>, <code>pending</code>, <code>awaiting_merchant_capture</code>, <code>capturing</code>, <code>completed</code>, <code>failed</code>, <code>cancelled</code>, <code>auth_expired</code>. Each state emits its own metric and its own log line with <code>correlationId</code>. Support can now answer <em>where is this order stuck</em> in seconds.`,
    evidence: [
      'ADR-003: 11 states, 18 legal transitions',
      'packages/checkout-sdk-browser/src/core/adapter-state-machine.ts defines each state',
      'Per-state Prometheus counter checkout_sdk_state_total{state=...}',
    ],
  },
  {
    id: 'why-transitions',
    title: 'Why exactly 18 legal transitions, enforced at runtime',
    problem: `With 11 states there are 121 possible transitions. v1 had no guardrails, so adapters could jump from <code>idle</code> directly to <code>completed</code> if their tokenization callback was sloppy, and error handling would sometimes skip <code>failed</code> entirely and reset to <code>idle</code>, hiding incidents from the dashboard. Bugs were reproducible in QA and invisible in production.`,
    solution: `v2.2 pins the legal graph at 18 transitions and enforces it inside the state machine at runtime. An illegal transition throws <code>E_ILLEGAL_TRANSITION</code> with the source and target state, the machine stays on the source state, and the error is logged. Adapters cannot cheat, and drift between the diagram and the code is impossible because the diagram is generated from the transition table.`,
    evidence: [
      '18 transitions encoded in packages/checkout-sdk-browser/src/core/adapter-state-machine.ts',
      'Runtime guard throws E_ILLEGAL_TRANSITION',
      'ADR-003 Mermaid diagram is generated from the same table',
    ],
  },
  {
    id: 'why-bases',
    title: 'Why 6 base adapter classes, not 70 ad-hoc files',
    problem: `v1 shipped 55 APMs as 55 hand-written files, each re-implementing its own fetch wrappers, its own logging, its own state transitions, and its own error taxonomy. Adding the 56th APM meant copy-pasting the file that looked most similar and diffing for 30 minutes. Bug fixes had to be replicated across N adapters, and several adapters silently drifted out of the state machine contract.`,
    solution: `v2.2 factors the shared behavior into 6 base classes keyed by pattern: <code>RedirectBase</code>, <code>BnplBase</code>, <code>NativeWalletBase</code>, <code>ButtonSdkBase</code>, <code>QrBase</code>, <code>VoucherBase</code>. A new APM is a 40-line subclass declaring its provider script URL, its tokenization callback, and its CH mapping; everything else is inherited. Bug fixes land once in the base and reach all 70 APMs.`,
    evidence: [
      'packages/checkout-sdk-browser/src/adapters/base/*.ts — 6 base classes',
      'Concrete adapters under 60 lines each',
      'ADR-005: adapter surface contract',
    ],
  },
  {
    id: 'why-one-endpoint',
    title: 'Why a single Commerce Hub endpoint (ADR-004)',
    problem: `Naïvely you would expect N APMs to call N Commerce Hub endpoints. v1 had branching logic that picked between <code>/checkouts/v1/orders</code>, a legacy <code>/payments/v1/charge</code>, and a third-party router for PPRO rails. The branch lived in the adapter layer, so adding a rail meant touching the adapter, the router, and the test harness. Wire contract drift was constant.`,
    solution: `ADR-004 commits to <strong>one</strong> CH endpoint — <code>POST /checkouts/v1/orders</code> — and fans out via <code>paymentMethod.provider</code>. Every APM, including PPRO-routed rails like iDEAL, sends the same request shape to the same URL. The reference server is the only place that knows how to translate an adapter mapping into the provider string, and it reads the mapping from a single registry. The next APM is a registry entry rather than a new code branch.`,
    evidence: [
      'ADR-004: single-endpoint fan-out contract',
      'packages/reference-server/src/routes/orders.ts reads mapping.chProvider directly',
      'Zero conditional on provider name outside the registry',
    ],
  },
  {
    id: 'why-harness-mode',
    title: 'Why HARNESS_MODE and 5 refuse-production tripwires',
    problem: `A test harness that can run against mocks is easy to build, but a harness that is safe to keep in the production image is not. Without an explicit mode, mock responses can leak into production traffic (every order silently <code>CAPTURED</code>, nothing actually charged), fake merchant ids can hit real rails, and debug loggers can dump PII to stdout.`,
    solution: `v2.2 introduces <code>HARNESS_MODE</code> as the single source of truth and arms 5 refuse-production tripwires at boot: (1) <code>HARNESS_MODE</code> must not be <code>true</code> in production, (2) <code>CH_BASE_URL</code> must match the expected host allowlist, (3) no mock adapter may be present, (4) merchant ids must not start with the reserved test prefix, (5) the debug logger must be disabled. Any tripwire failure throws during startup.`,
    evidence: [
      'packages/reference-server/src/env.ts — 5 refuse-production checks',
      'ADR-007: HARNESS_MODE contract and failure semantics',
      'Integration test refuses to boot with HARNESS_MODE=true + NODE_ENV=production',
    ],
  },
  {
    id: 'why-packages',
    title: 'Why three packages (package boundary = security boundary)',
    problem: `v1 was a single package that shipped browser code, Node code, and shared types together. That meant server-only secrets could be accidentally imported by a browser entry point, and the bundler would sometimes inline an HMAC signing helper into the client bundle. Security review had to re-audit every build because <em>could this file end up in the browser</em> depended on the import graph, not on any explicit contract.`,
    solution: `v2.2 splits the SDK into three publishable packages: <code>@commercehub/shared-types</code> (pure types, zero runtime), <code>@commercehub/node</code> (Node-only, imports <code>node:crypto</code>, never importable from a browser entry), and <code>@commercehub/checkout-sdk-browser</code> (browser-only). The reference server depends on the Node package; the harness depends on the browser package. The package boundary is now a security boundary: it is physically impossible to import the HMAC signer into browser code.`,
    evidence: [
      'Three packages under packages/: shared-types, commerce-hub-node, checkout-sdk-browser',
      'ADR-001: package split as trust boundary',
      'reference-server is the only consumer of commerce-hub-node',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// Leadership deck — the one-slide "70 from 6" summary, the 6-pattern
// catalog with its 6 base adapters, and the Q&A for "why normalize?".
// Rendered in the Docs nav under a dedicated "Leadership deck" group.
// ─────────────────────────────────────────────────────────────────────

export const LEADERSHIP_SLIDE = {
  id: 'leadership-slide',
  eyebrow: 'Fiserv APM Checkout SDK v2.2 — Leadership',
  title: '70 payment methods. 6 patterns. 6 adapters.',
  subtitle:
    'One integration, one Commerce Hub endpoint, one capability matrix — across every major global market.',
  stats: [
    { value: '70', label: 'APMs live in the catalog today' },
    { value: '6',  label: 'base adapter classes cover all 70' },
    { value: '1',  label: 'Commerce Hub endpoint (sessions + orders)' },
    { value: '<40', label: 'lines of code to add a new APM' },
  ],
  bullets: [
    'New APM onboarding drops from engineering quarters to configuration days.',
    'One fix propagates to every APM that shares the pattern — not 70 separate patches.',
    'Testing is tractable: exercise the 6 patterns to a high bar, then verify each APM is wired to the right one.',
    'Team throughput decouples from APM count — merchant requests become prioritization calls, not capacity calls.',
  ],
  callout:
    '"The pattern is the product. A new APM isn\'t a code project — it\'s a registry entry that picks a pattern and fills in the Commerce Hub wire fields."',
};

export const PATTERN_CATALOG = [
  {
    id: 'redirect',
    patternKey: 'redirect',
    name: 'Redirect',
    baseClass: 'RedirectBase',
    count: 'used by 45+ APMs',
    summary:
      'Browser leaves the merchant domain, authenticates at the provider (bank, BNPL, wallet), and returns to a success or cancel URL. The merchant never sees payment credentials.',
    flow: [
      'Adapter POSTs to /v2/sessions → gets a provider redirect URL from Commerce Hub.',
      'SDK navigates the browser to that URL.',
      'User authenticates on the provider\'s hosted page.',
      'Provider redirects back to the merchant\'s returnUrl with a status token.',
      'Merchant backend polls or receives a webhook with the final result.',
    ],
    examples: [
      'SOFORT, iDEAL, Giropay, Bancontact, Przelewy24, Trustly, MB WAY',
      'Most PPRO-routed EU + APAC methods',
      'TabaPay (US ACH)',
    ],
    whenToUse:
      'Regulated rails that require strong customer authentication, bank-level auth flows, or whenever the provider owns the auth UX.',
  },
  {
    id: 'bnpl',
    patternKey: 'bnpl',
    name: 'BNPL',
    baseClass: 'BnplBase',
    count: 'used by 5 APMs',
    summary:
      'Buy Now Pay Later JS SDK embeds inline in the merchant checkout, collects payment data, and returns a single-use token that the backend submits to Commerce Hub. Merchant keeps the checkout chrome.',
    flow: [
      'Adapter loads the provider SDK from its CDN.',
      'SDK renders either an inline widget (Klarna Payments) or receives a token on demand (Affirm, Afterpay, Sezzle, Zip).',
      'Provider returns an authorization_token or checkoutToken on user consent.',
      'SDK POSTs the token to /v2/orders/:apm; backend forwards it to Commerce Hub.',
      'Commerce Hub finalizes the purchase and reports the terminal state.',
    ],
    examples: ['Klarna', 'Affirm', 'Afterpay', 'Sezzle', 'Zip'],
    whenToUse:
      'BNPL providers where the merchant wants to keep the checkout chrome and brand continuity — the provider tokenizes the payment-method data without taking over the full flow.',
  },
  {
    id: 'native-wallet',
    patternKey: 'native-wallet',
    name: 'Native wallet',
    baseClass: 'NativeWalletBase',
    count: 'used by Apple Pay + Google Pay',
    summary:
      'The device OS surfaces a native payment sheet, returns an encrypted cryptogram, and the backend forwards it to Commerce Hub. No credentials ever touch the merchant page.',
    flow: [
      'Adapter preflights device capability (ApplePaySession.canMakePayments / isReadyToPay).',
      'User taps the native button — device surfaces the payment sheet.',
      'Device returns an encrypted token (paymentData for Apple Pay, tokenizationData for Google Pay).',
      'SDK POSTs the cryptogram to /v2/orders/:apm.',
      'Commerce Hub decrypts and settles in a single server round-trip.',
    ],
    examples: ['Apple Pay (Safari, iOS, macOS)', 'Google Pay (Chrome, Android)'],
    whenToUse:
      'Device-enrolled payment. Delivers the highest conversion rate of any pattern when the user is on a supported device with a saved card.',
  },
  {
    id: 'button-sdk',
    patternKey: 'button-sdk',
    name: 'Button SDK',
    baseClass: 'ButtonSdkBase',
    count: 'used by 4 APMs',
    summary:
      'A branded third-party button injects into the merchant page, runs the provider\'s own auth UX, and returns an approval id (orderID, nonce, grant_id) for the backend to capture.',
    flow: [
      'Adapter loads the provider SDK (paypal.com/sdk/js, kit.cash.app, etc).',
      'SDK renders the provider\'s branded button into a merchant-supplied mount node.',
      'User clicks, provider opens a popup or in-page sheet, user authenticates.',
      'Provider fires onApprove with an approval id.',
      'SDK POSTs the approval id to /v2/orders/:apm; backend captures it via Commerce Hub.',
    ],
    examples: ['PayPal', 'PayPal Pay Later', 'Venmo', 'Cash App Pay'],
    whenToUse:
      'Brand-trusted wallets where the partner\'s own button + auth flow is the conversion lever. Merchant gives up visual control in exchange for partner-driven conversion.',
  },
  {
    id: 'qr',
    patternKey: 'qr',
    name: 'QR',
    baseClass: 'QrBase',
    count: 'used by 8 APMs',
    summary:
      'Backend requests a session, Commerce Hub returns a QR payload, SDK renders the code, and the SDK polls (or listens via webhook) for settlement after the user scans.',
    flow: [
      'Adapter POSTs to /v2/sessions → Commerce Hub returns a QR payload / deeplink.',
      'SDK renders the QR code in a merchant-supplied mount element.',
      'User opens the provider app on their phone and scans.',
      'Provider posts a settlement webhook to the merchant backend.',
      'First-writer-wins cache resolves the order in the FSM and closes the SDK state.',
    ],
    examples: ['Alipay+', 'WeChat Pay', 'PIX (QR-mode)', 'UPI', 'PayNow', 'PromptPay', 'TWINT'],
    whenToUse:
      'APAC + mobile-first markets where the primary rail is a wallet on the user\'s phone and the checkout device is a separate screen.',
  },
  {
    id: 'voucher',
    patternKey: 'voucher',
    name: 'Voucher',
    baseClass: 'VoucherBase',
    count: 'used by 6 APMs',
    summary:
      'Backend issues a voucher reference, SDK displays it, the customer pays offline at a bank or convenience store. Settlement arrives days later via webhook; the order sits in `pending` until then.',
    flow: [
      'Adapter POSTs to /v2/sessions → Commerce Hub returns a voucher barcode + reference number.',
      'SDK renders the voucher UI (printable / downloadable / shareable).',
      'FSM enters `pending` and stays there.',
      'Customer pays offline within the voucher\'s expiry window.',
      'Provider webhook confirms settlement; first-writer-wins cache closes the FSM to `completed`.',
    ],
    examples: ['Boleto (BR)', 'OXXO (MX)', 'Konbini (JP)', 'Baloto (CO)', 'PagoFácil (AR)', 'Multibanco (PT)'],
    whenToUse:
      'Cash-dominant emerging markets where offline settlement is the norm. Accepts a multi-day settlement tail in exchange for reaching unbanked customers.',
  },
];

export const NORMALIZATION_FAQ = [
  {
    id: 'cost-curve',
    question: 'Why normalize instead of writing bespoke SDK code per payment method?',
    short:
      'Because bespoke-per-APM is a cost curve you cannot win on, and normalization is a cost curve you can.',
    answer: `<p>A bespoke-per-APM SDK looks cheap for the first 3 methods and ruinous by method 20. Every new APM adds a full engineering project: design, build, test, security review, maintenance, incident ownership, and a permanent tax every time a dependency changes.</p>
<p>With the normalized design, the base adapter classes absorb 85% of the code that would otherwise be duplicated — state machine, retries, webhook reconciliation, CSP posture, logging, error taxonomy, and the wire contract to Commerce Hub. A new APM ships as a ~40-line subclass declaring its provider script URL, its token callback, and its Commerce Hub field mapping. Everything else is inherited.</p>
<p>The ratio in v2.2 is <strong>70 APMs from 6 patterns</strong>. That ratio is the whole argument.</p>`,
  },
  {
    id: 'maintenance',
    question: 'What happens when a bug is found?',
    short: 'Fix once in the base class, ship to every APM that shares the pattern.',
    answer: `<p>In a bespoke codebase, a bug in the redirect flow is a bug in 45 codebases. Each one has to be diagnosed, patched, tested, and deployed separately — often by different engineers who built them at different times. A CVE in a shared provider library means coordinating 70 pull requests.</p>
<p>In the normalized codebase, the redirect flow lives in one file: <code>RedirectBase</code>. A fix lands once, the regression suite covers every APM that uses the pattern, and every redirect APM inherits the fix on the next deploy. Security patches become tractable.</p>`,
  },
  {
    id: 'testing',
    question: 'How does testing scale?',
    short: 'Test the pattern deeply, verify each APM is wired to the right one.',
    answer: `<p>With 70 bespoke integrations, every APM needs its own full test suite: happy path, decline, timeout, webhook race, retry, partial capture, refund. 70 × 10 = 700 tests, most of which are near-duplicates that drift apart over time.</p>
<p>With 6 normalized patterns, we test each pattern deeply (all the happy paths, all the failure modes) and then verify the 70 APMs are declared with the right pattern and correct wire fields. The harness you\'re looking at right now is that verification — it runs every adapter through its pattern\'s scripted scenario in minutes, not days.</p>`,
  },
  {
    id: 'new-apm',
    question: 'What does adding a new APM actually take?',
    short: '1 registry entry + 1 pattern assignment + wire fields = ship.',
    answer: `<p>Three steps:</p>
<ol>
  <li>Add the APM id, display name, currencies, and countries to <code>APM_MAPPING</code> in <code>shared-types</code>.</li>
  <li>Assign the pattern: one of <code>redirect</code>, <code>bnpl</code>, <code>native-wallet</code>, <code>button-sdk</code>, <code>qr</code>, or <code>voucher</code>.</li>
  <li>Declare the Commerce Hub wire fields: <code>paymentSource.sourceType</code>, optional <code>walletType</code>, and <code>paymentMethod.provider</code>.</li>
</ol>
<p>That\'s it. No new state machine. No new HTTP client. No new webhook handler. No new CSP directive. The base class owns all of that.</p>`,
  },
  {
    id: 'fit-risk',
    question: 'What if an APM doesn\'t fit any of the 6 patterns?',
    short:
      'That\'s exactly what the capability matrix protects against. And in two years we\'ve needed to add two new patterns. Two.',
    answer: `<p>The pattern library is a live system, not a frozen spec. The capability matrix on each adapter declares what it actually supports (refunds, partial capture, interactive callbacks, recurring, webhooks). If an APM\'s real capabilities diverge from its assigned pattern, the harness refuses to run ineligible scenarios against it.</p>
<p>When a genuinely new pattern appears — say, decentralized wallet flows that can\'t be modeled as any of the six — we add a seventh base class. In two years of evolution we\'ve hit that bar exactly twice. The patterns converge.</p>`,
  },
  {
    id: 'vendor-lock',
    question: 'Doesn\'t normalizing lock us into Commerce Hub?',
    short:
      'The adapter → Commerce Hub boundary is already the narrowest waist in the system. Normalization makes that waist explicit, not wider.',
    answer: `<p>Every APM already goes through Commerce Hub — that\'s the architectural given. Normalization doesn\'t add a dependency on Commerce Hub; it takes 70 slightly-different bespoke couplings to Commerce Hub and replaces them with one explicit, tested contract. If Commerce Hub\'s interface changes, we update the base class, not 70 adapters.</p>
<p>If we ever needed to route to a non-Commerce-Hub backend, the 6 base classes are the only files we\'d have to fork — not 70 adapters.</p>`,
  },
  {
    id: 'team-throughput',
    question: 'What does this mean for team capacity?',
    short:
      'Merchant requests stop being a capacity question and become a prioritization question.',
    answer: `<p>Today, when a merchant asks for MB WAY in Portugal or SPEI in Mexico, the answer is "let me check what engineering can fit this quarter." Each ask competes for finite engineering time.</p>
<p>With the normalized SDK, the same ask is answered in config days. The capacity bottleneck moves from engineering to product — we decide which APMs are worth supporting based on merchant demand and partner economics, not based on integration cost. That\'s a fundamentally different conversation with sales and with merchants.</p>`,
  },
];

