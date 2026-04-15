import { describe, expect, it } from 'vitest';
import {
  errorFromHttpStatus,
  ValidationError,
  AuthError,
  ForbiddenError,
  TooEarlyError,
  ServerError,
  CommerceHubError,
} from '../src/errors.js';

describe('errorFromHttpStatus', () => {
  const baseCtx = { message: 'upstream said no', apiTraceId: 'trace-1' };

  it('400 → ValidationError (not retryable)', () => {
    const err = errorFromHttpStatus(400, baseCtx);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.retryable).toBe(false);
  });

  it('401 → AuthError', () => {
    expect(errorFromHttpStatus(401, baseCtx)).toBeInstanceOf(AuthError);
  });

  it('403 → ForbiddenError', () => {
    expect(errorFromHttpStatus(403, baseCtx)).toBeInstanceOf(ForbiddenError);
  });

  it('425 → TooEarlyError (retryable)', () => {
    const err = errorFromHttpStatus(425, baseCtx);
    expect(err).toBeInstanceOf(TooEarlyError);
    expect(err.retryable).toBe(true);
  });

  it('429 → rate limited (retryable)', () => {
    const err = errorFromHttpStatus(429, baseCtx);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it.each([500, 502, 503, 504])('%d → ServerError (retryable)', (status) => {
    const err = errorFromHttpStatus(status, baseCtx);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.retryable).toBe(true);
  });

  it('418 → UNKNOWN (not retryable)', () => {
    const err = errorFromHttpStatus(418, baseCtx);
    expect(err.code).toBe('UNKNOWN');
    expect(err.retryable).toBe(false);
  });
});

describe('CommerceHubError.toJSON', () => {
  it('strips stack and exposes safe fields', () => {
    const err = new CommerceHubError({
      code: 'AUTH_FAILED',
      message: 'bad key',
      status: 401,
      apiTraceId: 'trace-1',
      clientRequestId: 'req-1',
      retryable: false,
    });
    const json = err.toJSON();
    expect(json).toMatchObject({
      name: 'CommerceHubError',
      code: 'AUTH_FAILED',
      message: 'bad key',
      status: 401,
      apiTraceId: 'trace-1',
      clientRequestId: 'req-1',
      retryable: false,
    });
    expect(json.stack).toBeUndefined();
  });
});
