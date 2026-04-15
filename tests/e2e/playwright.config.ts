/**
 * Playwright configuration for v2.1 E2E tests.
 *
 * Tests target the canonical user flow: merchant frontend → reference server
 * → (mocked) Commerce Hub → real provider SDK (faked via window stub) →
 * canonical event sequence.
 *
 * Prereqs (see tests/e2e/README.md):
 *   1. npm install (workspace root)
 *   2. npm run build (compiles all packages incl. checkout-sdk-browser dist/)
 *   3. cp packages/reference-server/.env.example packages/reference-server/.env
 *      and fill in any sandbox credentials (or leave defaults — tests mock CH)
 *   4. npx playwright install chromium
 *   5. From workspace root: npx playwright test --config=tests/e2e/playwright.config.ts
 *
 * All tests run on Chromium only by default (deterministic + fastest CI signal).
 * Multi-browser matrix is opt-in via `--project` flags.
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // tests share an in-memory event bus on the reference server
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'report'), open: 'never' }],
    ['junit', { outputFile: path.join(__dirname, 'junit.xml') }],
  ],
  use: {
    baseURL: 'http://localhost:3848',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  // Reference server boots automatically; tests get the in-memory event bus
  // and the (stub) /v2/orders forwarder. CH is mocked at the Playwright route
  // layer so no real outbound calls happen.
  webServer: [
    {
      command: 'npm run dev --workspace @commercehub/reference-server',
      cwd: ROOT,
      port: 3848,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: 'development',
        PORT: '3848',
        CH_BASE_URL: 'http://127.0.0.1:0', // never actually called — Playwright route intercepts
        CH_API_KEY: 'e2e-fake-api-key',
        CH_STATIC_ACCESS_TOKEN: 'e2e-fake-token',
        CH_WEBHOOK_SECRET: 'e2e-fake-webhook-secret',
        CORS_ORIGINS: 'http://localhost:3848,http://127.0.0.1:3848',
        INSTANCE_COUNT: '1',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
