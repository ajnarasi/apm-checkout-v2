import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaticAuth } from '../src/static-auth.js';
import { RefusedProductionError } from '../src/errors.js';

describe('StaticAuth', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('constructs successfully in non-production', () => {
    const auth = new StaticAuth({ apiKey: 'k', staticAccessToken: 't' });
    expect(auth.apiKey).toBe('k');
  });

  it('throws RefusedProductionError when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new StaticAuth({ apiKey: 'k', staticAccessToken: 't' })).toThrow(
      RefusedProductionError
    );
  });

  it('allows production construction when test escape hatch is set', () => {
    process.env.NODE_ENV = 'production';
    expect(
      () =>
        new StaticAuth({
          apiKey: 'k',
          staticAccessToken: 't',
          __allowProductionForTests: true,
        })
    ).not.toThrow();
  });

  it('throws on missing apiKey', () => {
    expect(() => new StaticAuth({ apiKey: '', staticAccessToken: 't' })).toThrow(
      /apiKey is required/
    );
  });

  it('throws on missing staticAccessToken', () => {
    expect(() => new StaticAuth({ apiKey: 'k', staticAccessToken: '' })).toThrow(
      /staticAccessToken is required/
    );
  });

  it('buildHeaders returns all required CH headers', () => {
    const auth = new StaticAuth({ apiKey: 'k', staticAccessToken: 't' });
    const headers = auth.buildHeaders('req-1');
    expect(headers['Api-Key']).toBe('k');
    expect(headers['Authorization']).toBe('Bearer t');
    expect(headers['Auth-Token-Type']).toBe('AccessToken');
    expect(headers['Client-Request-Id']).toBe('req-1');
    expect(Number(headers['Timestamp'])).toBeGreaterThan(0);
  });
});
