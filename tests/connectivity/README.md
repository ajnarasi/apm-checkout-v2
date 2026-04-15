# v2.1 Connectivity Test Runner

Real-network sandbox connectivity tests for the providers the v2.1 SDK
integrates with. **Hits real sandbox endpoints** — never production. Designed
to validate "the wire path works end-to-end" before you spend time debugging
the SDK adapter code.

## What it tests

| # | Test | Endpoint | Validates |
|---|---|---|---|
| 1 | `klarna` | `POST https://api-na.playground.klarna.com/payments/v1/sessions` | Real Klarna sandbox session creation; returns `session_id` + `client_token` for widget bootstrap |
| 2 | `cashapp` | `POST https://sandbox.api.cash.app/network/v1/brands` | Real Cash App Network sandbox; idempotent brand create proves auth + region + signature headers are right |
| 3 | `applepay` | local cert parse + (gated) `POST https://apple-pay-gateway.apple.com/paymentservices/startSession` | Apple Pay merchant cert is valid + (if key + domain present) signs a real merchant validation request |
| 4 | `commercehub` | `POST https://cert.api.firstdata.com/checkouts/v1/orders` | Real CH Orders endpoint; auth + body shape per CH spec v1.26.0302 |
| 5 | `googlepay` | same as #4 with `walletType: GOOGLE_PAY` payload | CH wire path for Google Pay tokenization (rejection of placeholder token still proves connectivity) |

## Quickstart

```bash
# 1. Copy the example env and fill in any missing values
cp tests/connectivity/.env.example tests/connectivity/.env
# Klarna + Cash App come pre-populated from cardfree-sdk source.
# Apple Pay key + Commerce Hub credentials need to be provided manually
# (see "What you need to provide" below).

# 2. Run all 5 tests
bash tests/connectivity/run.sh

# 3. Run a single test
bash tests/connectivity/run.sh klarna
bash tests/connectivity/run.sh cashapp
bash tests/connectivity/run.sh commercehub googlepay
```

## What's pre-populated vs what you need to provide

| Provider | Pre-populated | Source |
|---|---|---|
| Klarna | ✅ username + password | `cardfree-sdk/backend-server/src/main/.../KlarnaPaymentRoutes.kt` (Fiserv-shared playground tenant) |
| Cash App | ✅ client_id + api_key + merchant_id | `cardfree-sdk/backend-server/src/main/.../Application.kt` + `CashAppSandboxClient.kt` (Fiserv-shared sandbox tenant) |
| Apple Pay | ✅ cert (`apple-pay-merchant.cer`) + merchant id | v1 `test-harness/certs/` + memory file |
| Apple Pay | ❌ private key | **YOU MUST PROVIDE** — Apple's onvalidatemerchant call requires TLS client cert + key |
| Apple Pay | ❌ verified domain | **YOU MUST PROVIDE** — Apple Pay only validates against pre-registered domains |
| Commerce Hub | ❌ Api-Key, access token, MID, TID | **YOU MUST PROVIDE** — not derivable from any on-disk source |
| Google Pay | ❌ gateway merchant id | **YOU MUST PROVIDE** — paired with Commerce Hub creds |

## Findings from the 2026-04-14 run

### Finding 1 — Spec PDF path mismatch (worth flagging to Fiserv)

`CommerceHub_Orders_api_endpoint_spec.pdf` v1.26.0302 page 3 declares
`Path: /checkouts/v1/orders`. That path returns **HTTP 404** on
`https://cert.api.firstdata.com`. The path that actually responds with a
real CH gateway envelope on the cert sandbox is `/ch/payments/v1/orders`
(returns 401 with proper `gatewayResponse.transactionProcessingDetails`
when auth is wrong, which proves the path exists). The runner has been
updated to use the working path.

### Finding 2 — Apigee gateway needs two distinct credentials

The Fiserv API Manager (Apigee) sits in front of Commerce Hub and requires
**both**:
- **`Api-Key`** — per-app key generated at developer.fiserv.com → My Apps
- **`Authorization`** — long-lived bearer issued for the merchant tenant

When one 32-char hex value labelled "Client Token / Access Token" was
provided, I tried it in 7 different header position variations
(Bearer/raw, AccessToken/HMAC type, Api-Key only, Authorization only).
Every variation returned:

```json
{
  "gatewayResponse": {
    "transactionProcessingDetails": {
      "apiTraceId": "bead9a494c9b4808b15d687523e819f9"
    }
  },
  "error": [{
    "type": "APIM",
    "message": "ApiKey and/or Authentication supplied are invalid."
  }]
}
```

The `APIM` type confirms the rejection happens at the Apigee API Manager
layer BEFORE the request reaches Commerce Hub — meaning auth is the only
remaining gap. Once a second value is provided, fill in `.env` and re-run:

```bash
bash tests/connectivity/run.sh commercehub googlepay
```

## Last run result (2026-04-14)

```
v2.1 Connectivity Test Runner
tests: klarna cashapp applepay commercehub googlepay

✓ PASS klarna   status=200 time=0.397s session_id=89b9868e… client_token=present
✓ PASS cashapp  status=201 time=0.189s brand created/replayed
⊘ SKIP applepay — cert valid (subject=merchant.app.vercel.hottopic), key skipped per v2.1 scope
⊘ SKIP commercehub — second auth credential pending (see Finding 2 above)
⊘ SKIP googlepay — depends on CH credentials

Summary: 2 PASS   3 SKIP   0 FAIL
```

## Security

- `tests/connectivity/.env` is gitignored (and the workspace `.gitignore` also
  excludes `*.key`, `*.p12`, `*.pem` so private keys can never be committed).
- The runner never prints credential values — only response status, timing,
  and parsed identifiers.
- All endpoints are sandbox/playground — no production money flows.
- Curl uses `--max-time 15-20s` per call so a hung sandbox can't stall CI.

## Next steps

Once `commercehub` passes, the next deliverable is **wiring the v2.1
reference server's `/v2/orders/klarna` route to the real Klarna sandbox**
(replacing the current stub orders handler). The cardfree-sdk Kotlin code
in `KlarnaPaymentRoutes.kt` is the reference port target.

The Cash App and Apple Pay paths follow the same pattern: connectivity test
proves the wire works → port the call site into the v2.1 reference server →
the v2.1 hero adapter consumes it through the canonical state machine.
