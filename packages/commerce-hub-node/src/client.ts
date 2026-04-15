/**
 * CommerceHubClient — the single entry point for server-side calls to
 * Commerce Hub's Credentials API.
 *
 * Responsibilities:
 *   - Build request headers (via StaticAuth; HMAC path throws)
 *   - Enforce CH_BASE_URL host allowlist in production
 *   - Route calls through the circuit breaker
 *   - Apply deadline-aware retry with backoff + jitter
 *   - Map HTTP response codes to CommerceHubError taxonomy
 *   - Cache sessions by caller-supplied key
 *   - Redact PII before any structured logging
 *
 * NON-goals:
 *   - HMAC signing (stubbed in hmac.ts)
 *   - Multi-tenancy (out of scope — v2 is explicitly single-tenant)
 *   - Webhook delivery (lives in the reference server, not this package)
 */

import { randomUUID } from 'node:crypto';

import { CircuitBreaker } from './circuit-breaker.js';
import {
  CommerceHubError,
  errorFromHttpStatus,
  NetworkError,
  RefusedProductionError,
  ValidationError,
} from './errors.js';
import { redact, redactHeaders } from './redact.js';
import { withRetry, type RetryPolicy } from './retry.js';
import { StaticAuth } from './static-auth.js';
import { InMemoryTokenCache, type TokenCache } from './token-cache.js';
import type { CredentialsRequest } from './types/credentials-request.js';
import type { CredentialsResponse } from './types/credentials-response.js';

/** Sessions response surface returned by the client to callers. */
export interface CreatedSession {
  accessToken: string;
  sessionId: string;
  expiresAt: number;
  providerClientToken?: string;
  /** Commerce Hub's orderId — used for correlation. */
  orderId?: string;
  /** Commerce Hub's apiTraceId — used for support tickets. */
  apiTraceId?: string;
  /** Raw response for debugging (PII-redacted upstream before logging). */
  raw: CredentialsResponse;
}

export interface CommerceHubClientConfig {
  /** Base URL for Commerce Hub. Must be https://*.firstdata.com in production. */
  baseUrl: string;
  /** Auth adapter — currently only StaticAuth is supported. */
  auth: StaticAuth;
  /** Retry policy overrides. */
  retry?: Partial<RetryPolicy>;
  /** Token cache implementation. Defaults to InMemoryTokenCache. */
  tokenCache?: TokenCache<CreatedSession>;
  /** Circuit breaker. Caller can inject one for metrics export. */
  breaker?: CircuitBreaker;
  /** Structured logger (pino-compatible). Optional. */
  logger?: Logger;
  /**
   * Test-only escape hatch to skip the HTTPS + host allowlist check.
   * @internal
   */
  __allowInsecureUrlForTests?: boolean;
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface CreateSessionInput {
  apm: string;
  amount: { total: number; currency: string };
  merchantOrderId: string;
  merchantTransactionId?: string;
  customer?: CredentialsRequest['customer'];
  billingAddress?: CredentialsRequest['billingAddress'];
  orderData?: CredentialsRequest['orderData'];
  /** Arbitrary spec fields not yet typed. */
  additionalFields?: Record<string, unknown>;
  /**
   * Idempotency key — reused across HTTP retries for the same business op.
   * Auto-generated (UUIDv4) if omitted. Reuse explicitly on caller-level retries
   * so CH treats them as the same logical request inside the 5-minute window.
   */
  clientRequestId?: string;
  /** Absolute deadline (epoch ms). Retries are gated by this. */
  deadline?: number;
  /** Correlation id to propagate into logs and CH headers. */
  correlationId?: string;
  /** Cache key — set to enable caching. Must be deterministic. */
  cacheKey?: string;
}

const PRODUCTION_HOST_ALLOWLIST = /^https:\/\/[a-z0-9-]+\.firstdata\.com(\/|$)/i;
const CREDENTIALS_PATH = '/payments-vas/v1/security/credentials';

export class CommerceHubClient {
  private readonly config: CommerceHubClientConfig;
  private readonly tokenCache: TokenCache<CreatedSession>;
  private readonly breaker: CircuitBreaker;

  constructor(config: CommerceHubClientConfig) {
    this.validateBaseUrl(config);
    this.config = config;
    this.tokenCache = config.tokenCache ?? new InMemoryTokenCache<CreatedSession>();
    this.breaker = config.breaker ?? new CircuitBreaker();
  }

  /** Current circuit breaker state — exported for /readyz and metrics. */
  getBreakerState() {
    return this.breaker.getState();
  }

  /**
   * Create a Commerce Hub session.
   *
   * Path:
   *   cache check → breaker → retry → fetch → parse → cache set
   */
  async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    if (!input.apm) throw new ValidationError({ message: 'apm is required' });
    if (!input.merchantOrderId) {
      throw new ValidationError({ message: 'merchantOrderId is required' });
    }
    if (!input.amount?.total || !input.amount?.currency) {
      throw new ValidationError({ message: 'amount.total and amount.currency are required' });
    }

    // Cache hit — return without any upstream call
    if (input.cacheKey) {
      const cached = await this.tokenCache.get(input.cacheKey);
      if (cached) {
        this.log('info', {
          event: 'session.cache_hit',
          cacheKey: input.cacheKey,
          correlationId: input.correlationId,
        });
        return cached;
      }
    }

    // Stable per-business-op id — retries of THIS createSession call reuse it
    const clientRequestId = input.clientRequestId ?? randomUUID();
    const body = this.buildRequestBody(input);
    const bodyJson = JSON.stringify(body);

    const session = await this.breaker.execute(() =>
      withRetry(
        (attempt) => this.doRequest({ input, clientRequestId, bodyJson, attempt }),
        { ...this.config.retry, deadline: input.deadline }
      )
    );

    if (input.cacheKey) {
      // Cache for the remaining token lifetime, minus a 60s safety margin
      const ttlMs = Math.max(60_000, session.expiresAt - Date.now() - 60_000);
      await this.tokenCache.set(input.cacheKey, session, ttlMs);
    }

    return session;
  }

  // -------- internals --------

  private validateBaseUrl(config: CommerceHubClientConfig): void {
    if (config.__allowInsecureUrlForTests) return;
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !PRODUCTION_HOST_ALLOWLIST.test(config.baseUrl)) {
      throw new RefusedProductionError(
        `CommerceHubClient refuses baseUrl "${config.baseUrl}" in production. ` +
          'Only https://*.firstdata.com hosts are allowed. ' +
          'Set NODE_ENV=development for sandbox testing.'
      );
    }
    if (!config.baseUrl.startsWith('https://') && isProd) {
      throw new RefusedProductionError(
        `CommerceHubClient requires HTTPS in production. Got: ${config.baseUrl}`
      );
    }
  }

  private buildRequestBody(input: CreateSessionInput): CredentialsRequest {
    return {
      amount: {
        total: input.amount.total,
        currency: input.amount.currency,
      },
      merchantOrderId: input.merchantOrderId,
      merchantTransactionId: input.merchantTransactionId,
      customer: input.customer,
      billingAddress: input.billingAddress,
      orderData: input.orderData,
      transactionDetails: {
        captureFlag: false,
        interactionType: 'ECOMMERCE',
      },
      additionalFields: {
        apm: input.apm,
        ...input.additionalFields,
      },
    };
  }

  private async doRequest(args: {
    input: CreateSessionInput;
    clientRequestId: string;
    bodyJson: string;
    attempt: number;
  }): Promise<CreatedSession> {
    const { input, clientRequestId, bodyJson, attempt } = args;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${CREDENTIALS_PATH}`;

    const headers = {
      'Content-Type': 'application/json',
      ...this.config.auth.buildHeaders(clientRequestId),
      ...(input.correlationId ? { 'X-Correlation-Id': input.correlationId } : {}),
    };

    const startedAt = Date.now();
    this.log('info', {
      event: 'ch.request',
      attempt,
      apm: input.apm,
      merchantOrderId: input.merchantOrderId,
      clientRequestId,
      correlationId: input.correlationId,
      headers: redactHeaders(headers),
      body: redact(JSON.parse(bodyJson)),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyJson,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', {
        event: 'ch.network_error',
        clientRequestId,
        correlationId: input.correlationId,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw new NetworkError({ message, clientRequestId });
    }

    const durationMs = Date.now() - startedAt;
    let payload: CredentialsResponse;
    try {
      payload = (await response.json()) as CredentialsResponse;
    } catch {
      payload = {};
    }

    const apiTraceId =
      payload.gatewayResponse?.transactionProcessingDetails?.apiTraceId ?? undefined;

    if (!response.ok) {
      const firstError = payload.error?.[0];
      const err = errorFromHttpStatus(response.status, {
        message:
          firstError?.message ??
          `Commerce Hub returned HTTP ${response.status}`,
        status: response.status,
        apiTraceId,
        providerType: firstError?.type,
        providerCode: firstError?.code,
        field: firstError?.field,
        clientRequestId,
      });
      this.log('warn', {
        event: 'ch.error',
        attempt,
        status: response.status,
        code: err.code,
        retryable: err.retryable,
        apiTraceId,
        clientRequestId,
        correlationId: input.correlationId,
        durationMs,
      });
      throw err;
    }

    const accessToken = payload.accessToken;
    if (!accessToken) {
      throw new CommerceHubError({
        code: 'VALIDATION_ERROR',
        message: 'Commerce Hub response missing accessToken',
        status: response.status,
        apiTraceId,
        clientRequestId,
        retryable: false,
      });
    }

    const session: CreatedSession = {
      accessToken,
      sessionId:
        payload.gatewayResponse?.transactionProcessingDetails?.orderId ?? clientRequestId,
      expiresAt: payload.expiresAt ?? Date.now() + 2 * 60 * 60 * 1000,
      providerClientToken: payload.providerClientToken,
      orderId: payload.gatewayResponse?.transactionProcessingDetails?.orderId,
      apiTraceId,
      raw: payload,
    };

    this.log('info', {
      event: 'ch.success',
      attempt,
      durationMs,
      clientRequestId,
      correlationId: input.correlationId,
      apiTraceId,
      sessionId: session.sessionId,
    });

    return session;
  }

  private log(level: 'info' | 'warn' | 'error', obj: Record<string, unknown>): void {
    if (!this.config.logger) return;
    this.config.logger[level](obj);
  }
}
