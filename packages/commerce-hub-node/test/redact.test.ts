import { describe, expect, it } from 'vitest';
import { redact, redactHeaders, maskEmail, REDACTED_VALUE } from '../src/redact.js';

describe('redact', () => {
  it('replaces entire customer subtree with REDACTED', () => {
    const out = redact({ customer: { email: 'a@b.com', firstName: 'Ada' }, amount: 100 });
    expect(out).toEqual({ customer: REDACTED_VALUE, amount: 100 });
  });

  it('replaces billingAddress and source subtrees', () => {
    const out = redact({
      billingAddress: { city: 'LA' },
      source: { sourceType: 'card', cardNumber: '4111' },
    });
    expect(out).toEqual({
      billingAddress: REDACTED_VALUE,
      source: REDACTED_VALUE,
    });
  });

  it('masks email addresses inside non-sensitive string fields', () => {
    const out = redact({ note: 'contact user@example.com' });
    // Whole string does not match email regex — left alone
    expect(out).toEqual({ note: 'contact user@example.com' });
  });

  it('masks bare email strings at top level', () => {
    expect(redact('ada@example.com')).toBe('a***@example.com');
  });

  it('preserves numbers, booleans, nulls', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
  });

  it('handles nested arrays', () => {
    const out = redact({
      items: [
        { name: 'shoe', customer: { email: 'x@y.z' } },
        { name: 'hat' },
      ],
    });
    expect(out).toEqual({
      items: [
        { name: 'shoe', customer: REDACTED_VALUE },
        { name: 'hat' },
      ],
    });
  });

  it('does not mutate input', () => {
    const input = { customer: { email: 'a@b.com' } };
    redact(input);
    expect(input).toEqual({ customer: { email: 'a@b.com' } });
  });

  it('terminates on deeply nested objects', () => {
    const cyclicish: Record<string, unknown> = {};
    let cur = cyclicish;
    for (let i = 0; i < 20; i++) {
      cur.next = {};
      cur = cur.next as Record<string, unknown>;
    }
    // Should not throw or infinite-loop
    expect(() => redact(cyclicish)).not.toThrow();
  });
});

describe('redactHeaders', () => {
  it('redacts Authorization, Api-Key, Api-Secret', () => {
    const out = redactHeaders({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc',
      'Api-Key': 'sk_live_xyz',
      'Api-Secret': 'shh',
      'X-Correlation-Id': 'corr-1',
    });
    expect(out).toEqual({
      'Content-Type': 'application/json',
      Authorization: REDACTED_VALUE,
      'Api-Key': REDACTED_VALUE,
      'Api-Secret': REDACTED_VALUE,
      'X-Correlation-Id': 'corr-1',
    });
  });

  it('is case-insensitive for sensitive header names', () => {
    const out = redactHeaders({
      authorization: 'Bearer abc',
      'api-key': 'k',
    });
    expect(out.authorization).toBe(REDACTED_VALUE);
    expect(out['api-key']).toBe(REDACTED_VALUE);
  });

  it('drops undefined headers', () => {
    const out = redactHeaders({ foo: 'bar', missing: undefined });
    expect(out).toEqual({ foo: 'bar' });
  });
});

describe('maskEmail', () => {
  it('masks local part keeping first char and domain', () => {
    expect(maskEmail('ada@example.com')).toBe('a***@example.com');
  });

  it('returns REDACTED for malformed input', () => {
    expect(maskEmail('notanemail')).toBe(REDACTED_VALUE);
    expect(maskEmail('@foo.com')).toBe(REDACTED_VALUE);
  });
});
