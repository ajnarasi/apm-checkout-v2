/**
 * v2.2 — Single CH endpoint, CH owns fan-out (ADR-004).
 *
 * This test file is the load-bearing assertion that PPRO sub-methods
 * correctly translate to a CH request body with `paymentMethod.provider`
 * set to the uppercase adapter id. Without this, CH cannot route to the
 * right downstream and every PPRO method silently fails.
 *
 * The string "PPRO" must NEVER appear as a value on the wire — only the
 * sub-method name (e.g. "IDEAL", "BANCONTACT", "WERO").
 */

import { describe, expect, it } from 'vitest';
import {
  APM_MAPPING,
  ALL_APM_IDS,
  PPRO_APM_IDS,
  APM_STATS,
  getApmMapping,
  isPproRouted,
} from '@commercehub/shared-types';

describe('v2.2 apm-mapping — single source of truth', () => {
  it('exposes at least 70 total APMs (16 direct + 54 PPRO)', () => {
    expect(ALL_APM_IDS.length).toBeGreaterThanOrEqual(70);
  });

  it('reports PPRO and direct counts via APM_STATS', () => {
    expect(APM_STATS.total).toBe(ALL_APM_IDS.length);
    expect(APM_STATS.ppro).toBeGreaterThanOrEqual(39);
    expect(APM_STATS.direct).toBeGreaterThanOrEqual(16);
  });

  it('every entry in PPRO_APM_IDS is marked aggregator=PPRO', () => {
    for (const id of PPRO_APM_IDS) {
      const m = getApmMapping(id);
      expect(m, `mapping not found for ${id}`).toBeDefined();
      expect(m!.aggregator).toBe('PPRO');
    }
  });
});

describe('v2.2 PPRO routing — paymentMethod.provider on CH wire', () => {
  // Spot-check the heroes from each region. If these break, the whole
  // PPRO fan-out is broken.
  const PPRO_HEROES: Array<[string, string]> = [
    ['ideal', 'IDEAL'],
    ['bancontact', 'BANCONTACT'],
    ['sofort', 'SOFORT'],
    ['giropay', 'GIROPAY'],
    ['przelewy24', 'PRZELEWY24'],
    ['wero', 'WERO'],
    ['postfinance', 'POSTFINANCE'],
    ['swish', 'SWISH'],
    ['vipps', 'VIPPS'],
    ['mobilepay', 'MOBILEPAY'],
    ['mercadopago', 'MERCADOPAGO'],
    ['pix', 'PIX'],
    ['boleto', 'BOLETO'],
    ['oxxo', 'OXXO'],
    ['paynow', 'PAYNOW'],
    ['gcash', 'GCASH'],
    ['maya', 'MAYA'],
    ['linepay', 'LINEPAY'],
    ['ovo', 'OVO'],
    ['shopeepay', 'SHOPEEPAY'],
    ['touchngo', 'TOUCHNGO'],
    ['alipay', 'ALIPAY'],
    ['paypay', 'PAYPAY'],
    ['upi', 'UPI'],
    ['konbini', 'KONBINI'],
  ];

  it.each(PPRO_HEROES)(
    'PPRO sub-method %s sets paymentMethod.provider = %s',
    (apm, expectedProvider) => {
      const mapping = getApmMapping(apm);
      expect(mapping, `${apm} not registered`).toBeDefined();
      expect(mapping!.aggregator).toBe('PPRO');
      expect(mapping!.chProvider).toBe(expectedProvider);
      expect(mapping!.chSourceType).toBe('AlternativePaymentMethod');
      expect(isPproRouted(apm)).toBe(true);
    }
  );

  it('the literal string "PPRO" is never used as a chProvider value', () => {
    for (const id of ALL_APM_IDS) {
      const m = getApmMapping(id);
      expect(m!.chProvider, `${id} chProvider must not be "PPRO"`).not.toBe('PPRO');
    }
  });
});

describe('v2.2 direct (non-PPRO) routing', () => {
  it('Apple Pay → DigitalWallet + APPLE_PAY walletType', () => {
    const m = getApmMapping('applepay')!;
    expect(m.aggregator).toBe('WALLET');
    expect(m.chSourceType).toBe('DigitalWallet');
    expect(m.chWalletType).toBe('APPLE_PAY');
    expect(isPproRouted('applepay')).toBe(false);
  });

  it('Google Pay → DigitalWallet + GOOGLE_PAY walletType', () => {
    const m = getApmMapping('googlepay')!;
    expect(m.chSourceType).toBe('DigitalWallet');
    expect(m.chWalletType).toBe('GOOGLE_PAY');
  });

  it('Klarna → KLARNA aggregator (NOT routed via PPRO)', () => {
    const m = getApmMapping('klarna')!;
    expect(m.aggregator).toBe('KLARNA');
    expect(isPproRouted('klarna')).toBe(false);
  });

  it('PayPal → PAYPAL aggregator (NOT routed via PPRO)', () => {
    const m = getApmMapping('paypal')!;
    expect(m.aggregator).toBe('PAYPAL');
    expect(isPproRouted('paypal')).toBe(false);
  });
});

describe('v2.2 unknown APM handling', () => {
  it('getApmMapping returns undefined for unknown ids', () => {
    expect(getApmMapping('not-a-real-apm')).toBeUndefined();
  });

  it('isPproRouted returns false for unknown ids', () => {
    expect(isPproRouted('not-a-real-apm')).toBe(false);
  });
});
