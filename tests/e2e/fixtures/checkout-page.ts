/**
 * Page Object Model for the v2.1 test checkout fixture.
 *
 * Encapsulates selectors + flow helpers so individual specs stay readable.
 * Follows the e2e-runner skill's "use data-testid attributes" guidance.
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export type Initiator = 'GATEWAY' | 'MERCHANT';

export class CheckoutPage {
  readonly page: Page;
  readonly payButton: Locator;
  readonly captureButton: Locator;
  readonly voidButton: Locator;
  readonly stateBadge: Locator;
  readonly eventLog: Locator;
  readonly klarnaContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.payButton = page.getByTestId('pay-button');
    this.captureButton = page.getByTestId('capture-button');
    this.voidButton = page.getByTestId('void-button');
    this.stateBadge = page.getByTestId('adapter-state');
    this.eventLog = page.getByTestId('event-log');
    this.klarnaContainer = page.locator('#klarna-container');
  }

  /**
   * Navigate to the test checkout fixture. The path is served from
   * tests/e2e/fixtures/test-checkout.html by Playwright's static file route.
   */
  async goto(initiator: Initiator = 'GATEWAY'): Promise<void> {
    const search = initiator === 'MERCHANT' ? '?initiator=MERCHANT' : '';
    await this.page.goto(`/tests/e2e/fixtures/test-checkout.html${search}`);
    await expect(this.payButton).toBeVisible();
    await expect(this.stateBadge).toHaveText('idle');
  }

  /** Read the current event log as an array of typed event names. */
  async getEvents(): Promise<string[]> {
    const text = (await this.eventLog.textContent()) ?? '';
    const matches = text.match(/\[event\] (\w+)/g) ?? [];
    return matches.map((line) => line.replace('[event] ', ''));
  }

  /** Wait until the event log contains the given canonical event type. */
  async waitForEvent(type: string, timeoutMs = 5_000): Promise<void> {
    await expect
      .poll(async () => (await this.getEvents()).includes(type), {
        timeout: timeoutMs,
        message: `Waiting for event ${type}`,
      })
      .toBe(true);
  }

  /** Wait for the adapter state to reach a specific value. */
  async waitForState(state: string, timeoutMs = 5_000): Promise<void> {
    await expect(this.stateBadge).toHaveText(state, { timeout: timeoutMs });
  }
}
