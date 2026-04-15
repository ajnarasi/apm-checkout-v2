# v2.1 E2E Test Suite

Playwright tests covering the canonical user journeys from the v2.1 architect-approved scope:

| Spec | Critical user journey | ADR-003 transitions covered |
|---|---|---|
| `klarna-gateway-flow.spec.ts` | Pay with Klarna (gateway-initiated, default sale) | `idle → initializing → ready → authorizing → completed` |
| `klarna-gateway-flow.spec.ts` | Klarna decline | `... → authorizing → failed` |
| `klarna-gateway-flow.spec.ts` | Provider CDN load failure | `initializing → script_load_failed` (or `failed`) |
| `klarna-merchant-flow.spec.ts` | Pay with Klarna, merchant captures | `... → authorizing → awaiting_merchant_capture → capturing → completed` |
| `klarna-merchant-flow.spec.ts` | Pay with Klarna, merchant voids | `... → awaiting_merchant_capture → cancelled` |
| `klarna-merchant-flow.spec.ts` | Capture button gating | UI-level invariant |

These two specs validate **every NEW v2.1 state machine transition** plus the architect Pass #2 P0 #5 single-source-of-truth emission rule (PAYMENT_COMPLETED fires exactly once even when sync + webhook race).

## Architecture

```
┌─────────────────────┐  HTTP   ┌────────────────────────┐
│  Playwright browser │ ──────▶ │ Reference Server :3848 │
│  (Chromium)         │  routes │ (real Express boot)    │
│                     │ mocked  │                        │
│  test-checkout.html │ by      │  /v2/sessions          │
│   ↓ imports SDK     │ play-   │  /v2/orders/:apm       │
│                     │ wright  │  /v2/orders/:id/capture│
│  window.Klarna fake │ at      │  /v2/orders/:id/void   │
│  (addInitScript)    │ test    │                        │
│                     │ time    │     ↓ (would call)     │
│                     │         │  Commerce Hub          │
│                     │         │  (NEVER reached —      │
│                     │         │   route mocked)        │
└─────────────────────┘         └────────────────────────┘
```

- **Klarna fake** is injected via `context.addInitScript()` BEFORE the SDK script
  loads, so the real `KlarnaAdapter.loadSDK()` short-circuits via `globalCheck`
  and the real `Klarna.Payments.init/load/authorize` calls run against the fake.
- **Commerce Hub is NEVER called** in tests — Playwright's `page.route()`
  intercepts every `/v2/sessions` and `/v2/orders/*` response with deterministic
  fixtures.
- **Real reference server boots** (Express + middleware + correlation IDs +
  pino redact) via Playwright's `webServer` block. We test the actual server
  code path; only the upstream CH call is mocked.

## Prerequisites (mandatory before running)

The v2.1 workspace is greenfield. None of these have been run yet:

```bash
# 1. From workspace root: install all package deps via npm workspaces
cd /Users/ajnarasi/Documents/Work/Projects/APM/checkout-sdk-v2
npm install

# 2. Build all packages (compiles checkout-sdk-browser to dist/)
npm run build

# 3. Install Playwright + Chromium browser binary
npm install -D @playwright/test
npx playwright install chromium

# 4. Set test env (no real CH credentials needed — routes are mocked)
cp packages/reference-server/.env.example packages/reference-server/.env
# .env defaults are sufficient — Playwright's webServer block injects test values

# 5. Run the suite
npx playwright test --config=tests/e2e/playwright.config.ts
```

Total install time: ~10–15 minutes. Total disk: ~600 MB (node_modules ~400 MB,
Playwright Chromium binary ~150 MB).

## What the tests prove

1. **The corrected architecture works**: browser → reference server → CH (mocked)
   path executes end-to-end exactly as v2.1 designed it.
2. **Real Klarna SDK code runs**: the adapter's `Klarna.Payments.init/load/authorize`
   calls actually fire (against the fake `window.Klarna`), proving the real-SDK
   pattern is testable without CDN access.
3. **State machine transitions are correct**: every NEW ADR-003 transition
   (`awaiting_merchant_capture`, `capturing`, `auth_expired`, `script_load_failed`)
   is exercised in at least one test.
4. **Single-source-of-truth emission holds**: PAYMENT_COMPLETED fires exactly
   once in both gateway and merchant flows.
5. **Merchant-initiated lifecycle is wired correctly**: the new `capture()` and
   `void()` `CheckoutHandle` methods drive the right state transitions and
   reference server routes.

## Quarantine policy

Tests in this suite are CRITICAL — none are quarantined. If any fail in CI,
investigate immediately. Do NOT mark with `test.fixme()` without consulting
the architect-approved scope in `dapper-splashing-wadler.md`.

## CI integration

```yaml
# .github/workflows/e2e.yml
- name: Install dependencies
  run: npm install

- name: Build SDK
  run: npm run build

- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run E2E tests
  run: npx playwright test --config=tests/e2e/playwright.config.ts

- name: Upload Playwright report
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: tests/e2e/report/
    retention-days: 7

- name: Upload JUnit
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: junit
    path: tests/e2e/junit.xml
```

## Adding new specs

When you add a new hero adapter (Apple Pay, PayPal, etc.), add a corresponding
spec file:
- `applepay-native-wallet-flow.spec.ts` — exercise the `ApplePaySession` fake
  + merchant validation handoff route
- `paypal-button-sdk-flow.spec.ts` — exercise the `paypal.Buttons` fake +
  `onApprove` callback wiring

Each new spec must:
1. Inject the corresponding provider fake via `addInitScript`
2. Route-mock `/v2/sessions` and `/v2/orders/*`
3. Cover at least one happy-path AND one decline/void scenario
4. Assert the canonical event sequence per ADR-003
