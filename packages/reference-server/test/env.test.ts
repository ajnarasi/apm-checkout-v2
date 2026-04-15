import { describe, expect, it } from 'vitest';
import { loadEnv, EnvValidationError } from '../src/env.js';

const baseEnv = {
  NODE_ENV: 'development',
  PORT: '3848',
  CH_BASE_URL: 'https://cert.api.firstdata.com',
  CH_API_KEY: 'k',
  CH_STATIC_ACCESS_TOKEN: 't',
  CH_WEBHOOK_SECRET: 'shh',
  CORS_ORIGINS: 'http://localhost:3000',
  INSTANCE_COUNT: '1',
};

describe('loadEnv', () => {
  it('accepts a valid development env', () => {
    expect(() => loadEnv(baseEnv as never)).not.toThrow();
  });

  it('rejects missing CH_API_KEY', () => {
    expect(() => loadEnv({ ...baseEnv, CH_API_KEY: '' } as never)).toThrow(EnvValidationError);
  });

  it('rejects missing CH_STATIC_ACCESS_TOKEN', () => {
    expect(() =>
      loadEnv({ ...baseEnv, CH_STATIC_ACCESS_TOKEN: '' } as never)
    ).toThrow(EnvValidationError);
  });

  it('REFUSES PRODUCTION (refuse-production guard layer 1)', () => {
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production' } as never)
    ).toThrow(/REFUSED PRODUCTION/);
  });

  it('REFUSES MULTI-INSTANCE (architect concern #1)', () => {
    expect(() =>
      loadEnv({ ...baseEnv, INSTANCE_COUNT: '3' } as never)
    ).toThrow(/REFUSED MULTI-INSTANCE/);
  });

  it('rejects invalid PORT', () => {
    expect(() => loadEnv({ ...baseEnv, PORT: 'abc' } as never)).toThrow(/PORT/);
  });

  it('parses corsOrigins as comma-separated list', () => {
    const env = loadEnv({
      ...baseEnv,
      CORS_ORIGINS: 'http://a.com, http://b.com,http://c.com',
    } as never);
    expect(env.corsOrigins).toEqual(['http://a.com', 'http://b.com', 'http://c.com']);
  });

  // v2.2: harness mode tests
  it('HARNESS_MODE=true bypasses CH_API_KEY / CH_STATIC_ACCESS_TOKEN requirement', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      PORT: '3848',
      CORS_ORIGINS: 'http://localhost:3848',
      INSTANCE_COUNT: '1',
      HARNESS_MODE: 'true',
    } as never);
    expect(env.harnessMode).toBe(true);
    expect(env.chApiKey).toBe('');
    expect(env.chStaticAccessToken).toBe('');
  });

  it('harnessMode defaults to false when HARNESS_MODE unset', () => {
    expect(loadEnv(baseEnv as never).harnessMode).toBe(false);
  });

  it('REFUSES PRODUCTION with HARNESS_MODE=true (tripwire layer 5)', () => {
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production', HARNESS_MODE: 'true' } as never)
    ).toThrow(/REFUSED PRODUCTION/);
  });
});
