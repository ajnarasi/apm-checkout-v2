/**
 * Adapter registry coverage test.
 *
 * Asserts every one of the 55 expected adapters is registered after
 * importing register-all.ts. This is the closest thing to a parity
 * test we can do without v1 in scope — it ensures nothing got dropped
 * during the port.
 */

import { describe, expect, it } from 'vitest';
import { listAdapterIds, hasAdapter } from '../src/core/adapter-registry.js';
import '../src/register-all.js';

const EXPECTED_DIRECT = [
  'klarna',
  'paypal',
  'paypal_paylater',
  'venmo',
  'cashapp',
  'afterpay',
  'affirm',
  'sezzle',
  'zip',
  'alipayplus',
  'wechatpay',
  'grabpay',
  'applepay',
  'googlepay',
  'zepto',
  'tabapay',
];

// v2.2 reconciled list — 54 PPRO entries (39 v1 + 14 v2.1 forward-compat extras)
// after renaming `p24` → `przelewy24`, `ppro_alipay` → `alipay`, `ppro_paypay` → `paypay`,
// `ppro_kakaopay` → `kakaopay`, `ppro_dana` → `dana`, and adding 15 missing v1 methods
// (WERO, POSTFINANCE, SWISH, VIPPS, MOBILEPAY, MERCADOPAGO, PAYNOW, GCASH, MAYA,
// LINEPAY, OVO, SHOPEEPAY, TOUCHNGO, UPI, KONBINI).
const EXPECTED_PPRO = [
  // ── European bank redirects ──
  'ideal', 'bancontact', 'eps', 'blik', 'trustly', 'wero',
  'sofort', 'giropay', 'przelewy24', 'postfinance',
  'mbway', 'multibanco', 'mybank', 'finlandbanks',
  // ── Nordic mobile wallets ──
  'swish', 'vipps', 'mobilepay', 'twint',
  // ── LATAM ──
  'spei', 'pse', 'webpay', 'mercadopago',
  'pix', 'boleto', 'oxxo', 'efecty', 'baloto',
  'rapipago', 'pagofacil', 'redpagos', 'pagoefectivo',
  // ── APAC ──
  'paynow', 'gcash', 'maya', 'linepay', 'kakaopay',
  'dana', 'ovo', 'shopeepay', 'touchngo',
  'alipay', 'paypay', 'upi', 'konbini',
  // ── v2.1 extras kept for forward compat ──
  'ppro_wechatpay', 'ppro_naverpay', 'ppro_gopay',
  'ppro_truemoney', 'ppro_promptpay', 'ppro_momo',
  // ── Bank debit / direct entry ──
  'sepa', 'becs', 'bacs', 'paybybank',
];

describe('adapter registry — full v2.2 coverage', () => {
  it('registers all 16 direct adapters', () => {
    for (const id of EXPECTED_DIRECT) {
      expect(hasAdapter(id), `missing adapter: ${id}`).toBe(true);
    }
  });

  it('registers all PPRO adapters', () => {
    for (const id of EXPECTED_PPRO) {
      expect(hasAdapter(id), `missing PPRO adapter: ${id}`).toBe(true);
    }
  });

  it('total is at least 70 (16 direct + 54 PPRO)', () => {
    const ids = listAdapterIds();
    const unique = new Set(ids);
    expect(unique.size).toBeGreaterThanOrEqual(70);
  });

  it('every direct + PPRO id is unique (no collision)', () => {
    const all = [...EXPECTED_DIRECT, ...EXPECTED_PPRO];
    const set = new Set(all);
    expect(set.size).toBe(all.length);
  });
});
