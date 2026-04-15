/**
 * Commerce Hub error taxonomy.
 *
 * Every error thrown from CommerceHubClient is a subclass of CommerceHubError.
 * Callers can switch on `err.code` (stable) rather than `err.status` (HTTP).
 * The raw CH `apiTraceId` is always preserved for support tickets.
 */

export type CommerceHubErrorCode =
  | 'VALIDATION_ERROR' // 400
  | 'AUTH_FAILED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'TOO_EARLY' // 425 — retryable
  | 'RATE_LIMITED' // 429
  | 'SERVER_ERROR' // 5xx — retryable
  | 'NETWORK_ERROR' // fetch failed
  | 'TIMEOUT' // AbortController
  | 'DEADLINE_EXCEEDED' // caller-supplied deadline
  | 'CIRCUIT_OPEN' // breaker tripped
  | 'NOT_IMPLEMENTED' // HMAC stub
  | 'REFUSED_PRODUCTION' // static auth tripwire
  | 'UNKNOWN';

export interface CommerceHubErrorContext {
  /** Stable machine-readable code. */
  code: CommerceHubErrorCode;
  /** Human-readable message (PII-safe). */
  message: string;
  /** HTTP status if the error originated from an HTTP response. */
  status?: number;
  /** Commerce Hub's apiTraceId for support correlation. */
  apiTraceId?: string;
  /** Commerce Hub's original error type (e.g. "VALIDATION_ERROR"). */
  providerType?: string;
  /** Commerce Hub's original error code. */
  providerCode?: string;
  /** Field that failed validation, if applicable. */
  field?: string;
  /** Our own Client-Request-Id for log correlation. */
  clientRequestId?: string;
  /** Whether it's safe to retry this error. */
  retryable: boolean;
}

export class CommerceHubError extends Error {
  readonly code: CommerceHubErrorCode;
  readonly status?: number;
  readonly apiTraceId?: string;
  readonly providerType?: string;
  readonly providerCode?: string;
  readonly field?: string;
  readonly clientRequestId?: string;
  readonly retryable: boolean;

  constructor(ctx: CommerceHubErrorContext) {
    super(ctx.message);
    this.name = 'CommerceHubError';
    this.code = ctx.code;
    this.status = ctx.status;
    this.apiTraceId = ctx.apiTraceId;
    this.providerType = ctx.providerType;
    this.providerCode = ctx.providerCode;
    this.field = ctx.field;
    this.clientRequestId = ctx.clientRequestId;
    this.retryable = ctx.retryable;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * JSON representation safe for logging — strips stack + ensures no PII.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      apiTraceId: this.apiTraceId,
      providerType: this.providerType,
      providerCode: this.providerCode,
      field: this.field,
      clientRequestId: this.clientRequestId,
      retryable: this.retryable,
    };
  }
}

/** 400 — malformed request, missing fields. NOT retryable. */
export class ValidationError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>) {
    super({ ...ctx, code: 'VALIDATION_ERROR', retryable: false });
    this.name = 'ValidationError';
  }
}

/** 401 — bad API key / expired token. NOT retryable without refresh. */
export class AuthError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>) {
    super({ ...ctx, code: 'AUTH_FAILED', retryable: false });
    this.name = 'AuthError';
  }
}

/** 403 — account-level block. NOT retryable. */
export class ForbiddenError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>) {
    super({ ...ctx, code: 'FORBIDDEN', retryable: false });
    this.name = 'ForbiddenError';
  }
}

/** 425 Too Early — retry after a short delay. Retryable. */
export class TooEarlyError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>) {
    super({ ...ctx, code: 'TOO_EARLY', retryable: true });
    this.name = 'TooEarlyError';
  }
}

/** 5xx — server-side CH failure. Retryable. */
export class ServerError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>) {
    super({ ...ctx, code: 'SERVER_ERROR', retryable: true });
    this.name = 'ServerError';
  }
}

/** Fetch failed before a response was received. Retryable. */
export class NetworkError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable' | 'status'>) {
    super({ ...ctx, code: 'NETWORK_ERROR', retryable: true });
    this.name = 'NetworkError';
  }
}

/** Caller-supplied deadline exceeded. NOT retryable (caller's budget is gone). */
export class DeadlineExceededError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable' | 'status'>) {
    super({ ...ctx, code: 'DEADLINE_EXCEEDED', retryable: false });
    this.name = 'DeadlineExceededError';
  }
}

/** Circuit breaker is open — fail fast. NOT retryable this cycle. */
export class CircuitOpenError extends CommerceHubError {
  constructor(ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable' | 'status'>) {
    super({ ...ctx, code: 'CIRCUIT_OPEN', retryable: false });
    this.name = 'CircuitOpenError';
  }
}

/** HMAC signing is not implemented. POC upgrade gate. */
export class NotImplementedError extends CommerceHubError {
  constructor(message: string) {
    super({
      code: 'NOT_IMPLEMENTED',
      message,
      retryable: false,
    });
    this.name = 'NotImplementedError';
  }
}

/** Defense-in-depth refuse-production tripwire. */
export class RefusedProductionError extends CommerceHubError {
  constructor(message: string) {
    super({
      code: 'REFUSED_PRODUCTION',
      message,
      retryable: false,
    });
    this.name = 'RefusedProductionError';
  }
}

/**
 * Map an HTTP status code to the appropriate CommerceHubError subclass.
 * Used by client.ts after receiving a non-2xx response.
 */
export function errorFromHttpStatus(
  status: number,
  ctx: Omit<CommerceHubErrorContext, 'code' | 'retryable'>
): CommerceHubError {
  if (status === 400) return new ValidationError(ctx);
  if (status === 401) return new AuthError(ctx);
  if (status === 403) return new ForbiddenError(ctx);
  if (status === 404) {
    return new CommerceHubError({ ...ctx, code: 'NOT_FOUND', retryable: false });
  }
  if (status === 425) return new TooEarlyError(ctx);
  if (status === 429) {
    return new CommerceHubError({ ...ctx, code: 'RATE_LIMITED', retryable: true });
  }
  if (status >= 500 && status < 600) return new ServerError(ctx);
  return new CommerceHubError({ ...ctx, code: 'UNKNOWN', retryable: false });
}
