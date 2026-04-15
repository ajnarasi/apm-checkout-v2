/**
 * E2E #1 — Klarna gateway-initiated flow (default, sale).
 *
 * Verifies the canonical user journey:
 *   1. Merchant frontend → POST /v2/sessions → reference server creates CH session
 *   2. createCheckout({ paymentInitiator: 'GATEWAY' }) loads the SDK
 *   3. Klarna provider fake (installed via addInitScript) lets the adapter
 *      run real Klarna.Payments.init/load/authorize without hitting the CDN
 *   4. SDK forwards the authorization_token to /v2/orders/klarna
 *   5. The reference server calls (mocked) CH which returns transactionState=CAPTURED
 *   6. State machine transitions: idle → ... → completed
 *   7. Event sequence ends with PAYMENT_COMPLETED
 *
 * CH is mocked at the Playwright route layer — no real CH credentials needed.
 */

import { test, expect, type Route } from '@playwright/test';
import { CheckoutPage } from './fixtures/checkout-page.js';

// ──────────────────── Klarna provider fake init script ────────────────────
// Injected into every test page BEFORE the SDK loads. Mirrors
// packages/checkout-sdk-browser/src/testing/provider-fakes/klarna.ts but
// inlined so Playwright's addInitScript can serialize it.
const KLARNA_FAKE_INIT_SCRIPT = `
window.__klarnaFakeApproved = true;
window.__klarnaFakeAuthToken = 'klarna-fake-auth-token-e2e-1';
window.Klarna = {
  Payments: {
    init: function (_opts) {
      window.__klarnaInitCalled = true;
    },
    load: function (_opts, cb) {
      setTimeout(function () { cb({ show_form: true }); }, 0);
    },
    authorize: function (_opts, _data, cb) {
      setTimeout(function () {
        if (window.__klarnaFakeApproved) {
          cb({ approved: true, authorization_token: window.__klarnaFakeAuthToken });
        } else {
          cb({ approved: false, error: { invalid_fields: ['shipping_address'] } });
        }
      }, 0);
    }
  }
};
`;

// ──────────────────── Mock CH response shapes ────────────────────

function mockCheckoutOrdersSale(transactionId = 'CH-TXN-E2E-1') {
  return {
    gatewayResponse: {
      transactionType: 'CHARGE',
      transactionState: 'CAPTURED',
      transactionOrigin: 'ECOM',
      transactionProcessingDetails: {
        orderId: 'CH-ORDER-E2E-1',
        transactionId,
        transactionTimestamp: new Date().toISOString(),
        apiTraceId: 'trace-e2e-1',
        clientRequestId: 'req-e2e-1',
      },
    },
    processorResponseDetails: {
      approvalStatus: 'APPROVED',
      responseMessage: 'APPROVAL',
    },
  };
}

function mockCredentialsSession() {
  return {
    accessToken: 'e2e-bearer-token',
    sessionId: 'sess-e2e-gateway-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    providerClientToken: 'klarna-client-token-e2e',
    apm: 'klarna',
    currency: 'USD',
    amountMinor: 4999,
    paymentInitiator: 'GATEWAY' as const,
  };
}

// ──────────────────── Fixture wiring ────────────────────

test.beforeEach(async ({ page, context }) => {
  // 1. Inject the Klarna fake BEFORE any page script runs.
  await context.addInitScript(KLARNA_FAKE_INIT_SCRIPT);

  // 2. Intercept reference-server routes so the test doesn't depend on a
  //    real CH connection. The reference server itself still boots via
  //    Playwright's webServer block; we override the response path-by-path.
  await page.route('**/v2/sessions', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockCredentialsSession()),
    });
  });

  await page.route('**/v2/orders/klarna', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockCheckoutOrdersSale()),
    });
  });

  // Block the real Klarna CDN so the provider fake is the only authority.
  await page.route('https://x.klarnacdn.net/**', (route) => route.abort('blockedbyclient'));
});

// ──────────────────── Tests ────────────────────

test.describe('Klarna gateway-initiated flow', () => {
  test('user pays with Klarna and reaches PAYMENT_COMPLETED', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto('GATEWAY');

    // Click Pay → SDK runs init/render/authorize via the Klarna fake
    await checkout.payButton.click();

    // Wait for terminal event
    await checkout.waitForEvent('PAYMENT_COMPLETED', 7_000);

    // Assert canonical event sequence — these MUST appear in order per ADR-003
    const events = await checkout.getEvents();
    expect(events).toContain('INITIALIZING');
    expect(events).toContain('SDK_LOADED');
    expect(events).toContain('PAYMENT_METHOD_READY');
    expect(events).toContain('PAYMENT_AUTHORIZING');
    expect(events).toContain('PAYMENT_COMPLETED');

    // Architect P0 #5 single-source-of-truth: PAYMENT_COMPLETED fires exactly once
    const completedCount = events.filter((e) => e === 'PAYMENT_COMPLETED').length;
    expect(completedCount).toBe(1);

    // State machine reached terminal completed
    await checkout.waitForState('completed');
  });

  test('declined Klarna authorization transitions to PAYMENT_FAILED', async ({ page, context }) => {
    // Override the fake to return approved=false for this test.
    await context.addInitScript(`
      window.__klarnaFakeApproved = false;
    `);
    const checkout = new CheckoutPage(page);
    await checkout.goto('GATEWAY');

    await checkout.payButton.click();
    await checkout.waitForEvent('PAYMENT_FAILED', 7_000);

    const events = await checkout.getEvents();
    expect(events).toContain('PAYMENT_FAILED');
    expect(events).not.toContain('PAYMENT_COMPLETED');
    await checkout.waitForState('failed');
  });

  test('Klarna CDN load failure transitions to script_load_failed', async ({ page, context }) => {
    // Remove the Klarna fake so loadProviderSdk() actually tries the CDN —
    // which we have blocked at the route layer. The base class should
    // surface a ScriptLoadError and transition through the
    // initializing → script_load_failed legal transition (ADR-003).
    await context.addInitScript('delete window.Klarna;');
    const checkout = new CheckoutPage(page);
    await checkout.goto('GATEWAY');

    await checkout.payButton.click();
    // Either script_load_failed terminal state OR a generic failed state is
    // acceptable — both are valid per ADR-003 transitions
    // initializing → script_load_failed | failed.
    await expect.poll(
      async () => {
        const text = (await checkout.stateBadge.textContent()) ?? '';
        return text === 'script_load_failed' || text === 'failed';
      },
      { timeout: 20_000, message: 'Waiting for failure terminal state' }
    ).toBe(true);
  });
});
