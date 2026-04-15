# ADR-004 — Single Commerce Hub Endpoint, CH Owns Provider Fan-Out

**Status**: Accepted
**Date**: 2026-04-14
**Supersedes**: implicit assumptions in v2.0/v2.1 about per-aggregator merchant routes

## Context

During v2.1 validation the user clarified the canonical settlement architecture:

> "The Checkout SDK is the one being wrapped around all these payment method
> SDKs (including PPRO), which means: 1. The server-side call for auth/capture
> will still be the CommerceHub checkout orders endpoint. 2. From there, it
> will be routed to the relevant payment method server-side endpoints. 3. For
> PPRO, it will be the PPRO charges endpoint that will act as the single
> server-side endpoint going from the CommerceHub server endpoint to PPRO for
> all the payment methods enabled via PPRO."

Earlier drafts implicitly assumed the merchant backend might call PPRO's
`/v1/payment-charges` directly (as v1's `test-harness/server.js` does). v1's
direct-PPRO route is a test-harness shortcut, not the production architecture.
The canonical pattern — confirmed by `output/ideal-via-ppro/config.json` —
is that Commerce Hub owns the entire downstream fan-out.

## Decision

**All 55+ APMs settle through one CH endpoint:** `POST /checkouts/v1/orders`.

The merchant backend never imports a per-provider client (no PPRO client, no
direct Klarna client, no direct Adyen client). It only:

1. Resolves the APM mapping via `getApmMapping(apm)` from
   `@commercehub/shared-types/apm-mapping`.
2. Constructs a `CheckoutOrdersRequest` with:
   - `paymentSource.sourceType` = `mapping.chSourceType`
   - `paymentSource.walletType` = `mapping.chWalletType` (when applicable)
   - `paymentMethod.provider` = `mapping.chProvider` (uppercase adapter id for PPRO)
3. POSTs the body to CH via `CheckoutOrdersClient`.

CH internally inspects `paymentMethod.provider` and routes the request to the
correct downstream — PPRO for `IDEAL`/`BANCONTACT`/etc., Klarna for `KLARNA`,
PayPal for `PAYPAL`, and so on. The string `"PPRO"` never appears on the wire.

### `apm-mapping.ts` is the single source of truth

`packages/shared-types/src/apm-mapping.ts` exports `APM_MAPPING` — a typed
table covering all 55 APMs with their `aggregator`, `chSourceType`,
`chWalletType?`, `chProvider?`, supported `currencies`, and `countries`.
Helper functions:

- `getApmMapping(apm)` — single lookup used by the reference server's order routes
- `isPproRouted(apm)` — boolean check for PPRO sub-methods
- `PPRO_APM_IDS` — runtime list of all PPRO sub-methods

This is the only file in the codebase that knows CH wire field shapes. Any CH
contract change is a one-file edit.

## Consequences

**Positive**:
- Merchant backend has zero per-provider HTTP clients
- PPRO sub-method routing is a CH internal concern — adding a new PPRO method
  is a one-row edit in `apm-mapping.ts` + one entry in `ppro-adapter-factory.ts`
- The reference server's `routes/orders.ts` is provider-agnostic — it only
  knows about CH
- v1's direct-PPRO test-harness pattern is explicitly rejected as a production
  pattern

**Negative**:
- Connectivity tests against PPRO sandbox (`tests/connectivity/run.sh ppro_*`)
  validate that PPRO is reachable but do NOT exercise the production settlement
  path — they prove credentials work, nothing more
- We cannot validate end-to-end PPRO settlement until CH credentials are
  available against `cert.api.firstdata.com`

**Neutral**:
- The `CH_ORDERS_PATH` env override exists for the cert sandbox quirk
  (Apigee 404 on `/checkouts/v1/orders`, success on `/ch/payments/v1/orders`).
  Production leaves this unset.

## Verification

1. `grep -rn "api.sandbox.eu.ppro.com" packages/` returns ZERO matches outside
   `tests/connectivity/`
2. `grep -rn "/v1/payment-charges" packages/` returns ZERO matches outside
   `tests/connectivity/`
3. Reference server `POST /v2/orders/ideal` produces a CH request body with
   `paymentMethod.provider === "IDEAL"`
4. Reference server `POST /v2/orders/klarna` produces a CH request body with
   `paymentMethod.provider === "KLARNA"` (NOT routed through PPRO)
5. `tests/connectivity/run.sh commercehub` (when CH creds land) hits the
   canonical `/checkouts/v1/orders` path
