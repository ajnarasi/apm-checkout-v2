import { describe, expect, it } from 'vitest';
import { AdapterValidator, ConfigValidationError } from '../src/core/adapter-validator.js';
import type { CheckoutConfig } from '../src/core/types.js';

function validConfig(): CheckoutConfig {
  return {
    apm: 'klarna',
    amount: { value: 49.99, currency: 'USD' },
    merchantOrderId: 'ORDER-1',
    credentials: {
      accessToken: 'tok-1',
      sessionId: 'sess-1',
      chBaseUrl: 'http://localhost:3848',
    },
  };
}

describe('AdapterValidator', () => {
  it('passes a valid config', () => {
    expect(() => new AdapterValidator().validate(validConfig())).not.toThrow();
  });

  it('rejects missing apm', () => {
    const cfg = validConfig();
    cfg.apm = '';
    expect(() => new AdapterValidator().validate(cfg)).toThrow(ConfigValidationError);
  });

  it('rejects missing accessToken', () => {
    const cfg = validConfig();
    cfg.credentials.accessToken = '';
    expect(() => new AdapterValidator().validate(cfg)).toThrow(/accessToken.*required/);
  });

  it('rejects missing chBaseUrl', () => {
    const cfg = validConfig();
    cfg.credentials.chBaseUrl = '';
    expect(() => new AdapterValidator().validate(cfg)).toThrow(/chBaseUrl/);
  });

  it('rejects non-positive amount', () => {
    const cfg = validConfig();
    cfg.amount.value = 0;
    expect(() => new AdapterValidator().validate(cfg)).toThrow(/positive/);
  });

  it('rejects missing merchantOrderId', () => {
    const cfg = validConfig();
    cfg.merchantOrderId = '';
    expect(() => new AdapterValidator().validate(cfg)).toThrow(/merchantOrderId/);
  });

  it('validateAll collects every failure', () => {
    const cfg = validConfig();
    cfg.apm = '';
    cfg.merchantOrderId = '';
    cfg.amount.value = 0;
    const errs = new AdapterValidator().validateAll(cfg);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});
