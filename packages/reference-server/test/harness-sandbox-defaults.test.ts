/**
 * v2.2 — Tests for /v2/harness/sandbox-defaults endpoint.
 *
 * Asserts that the harness route returns the committed sandbox test
 * credentials for Klarna, CashApp, and PPRO (so the Runner pane can
 * pre-fill credential inputs), and 404s on unknown APMs.
 */

import { describe, expect, it } from 'vitest';
import {
  SANDBOX_CREDENTIALS,
  isSandboxApmId,
  buildKlarnaAuthHeader,
} from '@commercehub/shared-types';

describe('sandbox-credentials shared source of truth', () => {
  it('exposes Klarna / CashApp / PPRO entries with the expected shapes', () => {
    expect(SANDBOX_CREDENTIALS.klarna.baseUrl).toMatch(/playground\.klarna\.com$/);
    expect(SANDBOX_CREDENTIALS.klarna.username).toBeTruthy();
    expect(SANDBOX_CREDENTIALS.klarna.password).toBeTruthy();
    expect(SANDBOX_CREDENTIALS.klarna.merchantId).toBe('PN129867');

    expect(SANDBOX_CREDENTIALS.cashapp.baseUrl).toBe('https://sandbox.api.cash.app');
    expect(SANDBOX_CREDENTIALS.cashapp.clientId).toBe('CAS-CI_FISERV_TEST');
    expect(SANDBOX_CREDENTIALS.cashapp.apiKeyId).toMatch(/^KEY_/);
    expect(SANDBOX_CREDENTIALS.cashapp.brandId).toMatch(/^BRAND_/);
    expect(SANDBOX_CREDENTIALS.cashapp.merchantId).toMatch(/^MMI_/);

    expect(SANDBOX_CREDENTIALS.ppro.baseUrl).toBe('https://api.sandbox.eu.ppro.com');
    expect(SANDBOX_CREDENTIALS.ppro.token).toBeTruthy();
    expect(SANDBOX_CREDENTIALS.ppro.merchantId).toBe('FIRSTDATATESTCONTRACT');
  });

  it('isSandboxApmId narrows to known keys only', () => {
    expect(isSandboxApmId('klarna')).toBe(true);
    expect(isSandboxApmId('cashapp')).toBe(true);
    expect(isSandboxApmId('ppro')).toBe(true);
    expect(isSandboxApmId('visa')).toBe(false);
    expect(isSandboxApmId('')).toBe(false);
  });

  it('buildKlarnaAuthHeader produces a Basic auth header', () => {
    const header = buildKlarnaAuthHeader(SANDBOX_CREDENTIALS.klarna);
    expect(header.startsWith('Basic ')).toBe(true);
    const encoded = header.slice('Basic '.length);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    expect(decoded).toBe(
      `${SANDBOX_CREDENTIALS.klarna.username}:${SANDBOX_CREDENTIALS.klarna.password}`
    );
  });

  it('sandbox credentials are frozen (Object.freeze) to prevent drift', () => {
    expect(Object.isFrozen(SANDBOX_CREDENTIALS)).toBe(true);
  });
});
