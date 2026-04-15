import { describe, expect, it } from 'vitest';
import { sign, buildHmacHeaders } from '../src/hmac.js';
import { NotImplementedError } from '../src/errors.js';

describe('hmac stub', () => {
  const input = {
    apiKey: 'k',
    apiSecret: 's',
    clientRequestId: 'req-1',
    timestamp: 123,
    requestBody: '{}',
  };

  it('sign() throws NotImplementedError', () => {
    expect(() => sign(input)).toThrow(NotImplementedError);
  });

  it('buildHmacHeaders() throws NotImplementedError', () => {
    expect(() => buildHmacHeaders(input)).toThrow(NotImplementedError);
  });

  it('throw message directs user to docs/SECURITY.md', () => {
    expect(() => sign(input)).toThrow(/docs\/SECURITY\.md/);
  });
});
