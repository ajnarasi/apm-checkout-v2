/**
 * E2E #2 — Klarna merchant-initiated flow with explicit capture.
 *
 * Verifies the v2.1 ADR-003 NEW lifecycle:
 *   1. POST /v2/sessions { paymentInitiator: 'MERCHANT' }
 *   2. createCheckout(...) loads SDK with paymentInitiator=MERCHANT
 *   3. authorize() drives the Klarna fake → forwards token to /v2/orders/klarna
 *   4. Reference server returns CH transactionState=AUTHORIZED (not CAPTURED)
 *   5. State machine: authorizing → awaiting_merchant_capture
 *   6. AWAITING_MERCHANT_CAPTURE event fires
 *   7. Test calls capture() → SDK calls /v2/orders/{id}/capture
 *   8. Reference server returns CAPTURED
 *   9. State machine: awaiting_merchant_capture → capturing → completed
 *  10. CAPTURING + PAYMENT_COMPLETED events fire (in order)
 *
 * This is the core post-mortem gap #5 fix in action.
 */

import { test, expect, type Route } from '@playwright/test';
import { CheckoutPage } from './fixtures/checkout-page.js';

const KLARNA_FAKE_INIT_SCRIPT = `
window.Klarna = {
  Payments: {
    init: function () {},
    load: function (_o, cb) { setTimeout(function () { cb({ show_form: true }); }, 0); },
    authorize: function (_o, _d, cb) {
      setTimeout(function () {
        cb({ approved: true, authorization_token: 'klarna-fake-merchant-tok-1' });
      }, 0);
    }
  }
};
`;

function mockSession() {
  return {
    accessToken: 'e2e-bearer-merchant',
    sessionId: 'sess-e2e-merchant-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    providerClientToken: 'klarna-client-token-merchant',
    apm: 'klarna',
    currency: 'USD',
    amountMinor: 4999,
    paymentInitiator: 'MERCHANT' as const,
  };
}

function mockAuthorizeResponse() {
  // Returns AUTHORIZED (not CAPTURED) — signals merchant must capture.
  return {
    gatewayResponse: {
      transactionType: 'AUTH',
      transactionState: 'AUTHORIZED',
      transactionOrigin: 'ECOM',
      transactionProcessingDetails: {
        orderId: 'CH-ORDER-MERCHANT-1',
        transactionId: 'CH-TXN-AUTH-1',
        transactionTimestamp: new Date().toISOString(),
        apiTraceId: 'trace-merchant-1',
        clientRequestId: 'req-merchant-1',
      },
    },
  };
}

function mockCaptureResponse() {
  return {
    gatewayResponse: {
      transactionType: 'CAPTURE',
      transactionState: 'CAPTURED',
      transactionOrigin: 'ECOM',
      transactionProcessingDetails: {
        orderId: 'CH-ORDER-MERCHANT-1',
        transactionId: 'CH-TXN-CAP-1',
        transactionTimestamp: new Date().toISOString(),
        apiTraceId: 'trace-merchant-2',
      },
    },
    processorResponseDetails: {
      approvalStatus: 'APPROVED',
      responseMessage: 'APPROVAL',
    },
  };
}

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(KLARNA_FAKE_INIT_SCRIPT);

  await page.route('**/v2/sessions', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockSession()),
    });
  });

  await page.route('**/v2/orders/klarna', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAuthorizeResponse()),
    });
  });

  await page.route('**/v2/orders/*/capture', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockCaptureResponse()),
    });
  });

  await page.route('**/v2/orders/*/void', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        gatewayResponse: {
          transactionType: 'VOID',
          transactionState: 'CANCELLED',
          transactionProcessingDetails: { orderId: 'CH-ORDER-MERCHANT-1' },
        },
      }),
    });
  });

  await page.route('https://x.klarnacdn.net/**', (route) => route.abort('blockedbyclient'));
});

test.describe('Klarna merchant-initiated flow (ADR-003 awaiting_merchant_capture)', () => {
  test('authorize → awaiting_merchant_capture → capture → PAYMENT_COMPLETED', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto('MERCHANT');

    // Step 1: pay → SDK runs init/render/authorize
    await checkout.payButton.click();

    // Step 2: state machine should reach awaiting_merchant_capture
    await checkout.waitForEvent('AWAITING_MERCHANT_CAPTURE', 7_000);

    // Capture button should be enabled by the test page
    await expect(checkout.captureButton).toBeEnabled();
    await checkout.waitForState('awaiting_merchant_capture');

    // Critical: PAYMENT_COMPLETED MUST NOT have fired yet
    let events = await checkout.getEvents();
    expect(events).not.toContain('PAYMENT_COMPLETED');

    // Step 3: merchant calls capture()
    await checkout.captureButton.click();

    // Step 4: capture flow runs through capturing → completed
    await checkout.waitForEvent('PAYMENT_COMPLETED', 7_000);
    events = await checkout.getEvents();

    // Assert canonical sequence: authorize-side events, then capture-side events
    const authorizeIdx = events.indexOf('AWAITING_MERCHANT_CAPTURE');
    const capturingIdx = events.indexOf('CAPTURING');
    const completedIdx = events.indexOf('PAYMENT_COMPLETED');
    expect(authorizeIdx).toBeGreaterThanOrEqual(0);
    expect(capturingIdx).toBeGreaterThan(authorizeIdx);
    expect(completedIdx).toBeGreaterThan(capturingIdx);

    // Architect P0 #5 single-source-of-truth: PAYMENT_COMPLETED fires exactly once
    expect(events.filter((e) => e === 'PAYMENT_COMPLETED').length).toBe(1);

    await checkout.waitForState('completed');
  });

  test('authorize → awaiting_merchant_capture → void → PAYMENT_CANCELLED', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto('MERCHANT');

    await checkout.payButton.click();
    await checkout.waitForEvent('AWAITING_MERCHANT_CAPTURE', 7_000);
    await checkout.waitForState('awaiting_merchant_capture');

    // Merchant decides to void instead of capture (e.g. fraud check failed)
    await checkout.voidButton.click();
    await checkout.waitForEvent('PAYMENT_CANCELLED', 7_000);

    const events = await checkout.getEvents();
    expect(events).toContain('PAYMENT_CANCELLED');
    expect(events).not.toContain('PAYMENT_COMPLETED');

    await checkout.waitForState('cancelled');
  });

  test('capture before authorize is rejected', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto('MERCHANT');

    // capture button is disabled until AWAITING_MERCHANT_CAPTURE fires
    await expect(checkout.captureButton).toBeDisabled();
  });
});
