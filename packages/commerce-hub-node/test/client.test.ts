import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceHubClient } from '../src/client.js';
import { StaticAuth } from '../src/static-auth.js';
import {
  AuthError,
  CircuitOpenError,
  DeadlineExceededError,
  RefusedProductionError,
  ServerError,
  ValidationError,
} from '../src/errors.js';
import { CircuitBreaker } from '../src/circuit-breaker.js';

const ORIGINAL_ENV = process.env.NODE_ENV;

function makeAuth() {
  return new StaticAuth({ apiKey: 'test-key', staticAccessToken: 'test-tok' });
}

function mockFetch(
  responses: Array<
    | { status: number; body: Record<string, unknown> }
    | { throws: Error }
  >
) {
  let i = 0;
  const mock = vi.fn().mockImplementation(async () => {
    const r = responses[i++];
    if (!r) throw new Error(`mockFetch ran out of responses (call ${i})`);
    if ('throws' in r) throw r.throws;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('CommerceHubClient', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  const validInput = {
    apm: 'klarna',
    amount: { total: 49.99, currency: 'USD' },
    merchantOrderId: 'order-1',
  };

  describe('createSession happy path', () => {
    it('returns accessToken + sessionId on 200', async () => {
      mockFetch([
        {
          status: 200,
          body: {
            accessToken: 'ch-tok-abc',
            providerClientToken: 'klarna-client-1',
            expiresAt: Date.now() + 3_600_000,
            gatewayResponse: {
              transactionProcessingDetails: {
                orderId: 'CH-ORDER-1',
                apiTraceId: 'trace-1',
              },
            },
          },
        },
      ]);

      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      const session = await client.createSession(validInput);

      expect(session.accessToken).toBe('ch-tok-abc');
      expect(session.sessionId).toBe('CH-ORDER-1');
      expect(session.providerClientToken).toBe('klarna-client-1');
      expect(session.orderId).toBe('CH-ORDER-1');
      expect(session.apiTraceId).toBe('trace-1');
    });

    it('sends the expected headers and body', async () => {
      const fetchMock = mockFetch([
        {
          status: 200,
          body: {
            accessToken: 'tok',
            expiresAt: Date.now() + 10_000,
          },
        },
      ]);

      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      await client.createSession({
        ...validInput,
        correlationId: 'corr-1',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:9999/payments-vas/v1/security/credentials');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Api-Key']).toBe('test-key');
      expect(headers['Authorization']).toBe('Bearer test-tok');
      expect(headers['Auth-Token-Type']).toBe('AccessToken');
      expect(headers['X-Correlation-Id']).toBe('corr-1');
      expect(headers['Client-Request-Id']).toBeTruthy();
      const body = JSON.parse(init.body as string);
      expect(body.amount).toEqual({ total: 49.99, currency: 'USD' });
      expect(body.additionalFields.apm).toBe('klarna');
    });
  });

  describe('validation', () => {
    it('throws ValidationError when apm missing', async () => {
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      await expect(
        client.createSession({ ...validInput, apm: '' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when merchantOrderId missing', async () => {
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      await expect(
        client.createSession({ ...validInput, merchantOrderId: '' })
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('production URL allowlist', () => {
    it('refuses http:// in production', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CommerceHubClient({
            baseUrl: 'http://evil.com',
            auth: new StaticAuth({
              apiKey: 'k',
              staticAccessToken: 't',
              __allowProductionForTests: true,
            }),
          })
      ).toThrow(RefusedProductionError);
    });

    it('refuses non-firstdata.com in production', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CommerceHubClient({
            baseUrl: 'https://cert.api.example.com',
            auth: new StaticAuth({
              apiKey: 'k',
              staticAccessToken: 't',
              __allowProductionForTests: true,
            }),
          })
      ).toThrow(RefusedProductionError);
    });

    it('allows https://cert.api.firstdata.com in production', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CommerceHubClient({
            baseUrl: 'https://cert.api.firstdata.com',
            auth: new StaticAuth({
              apiKey: 'k',
              staticAccessToken: 't',
              __allowProductionForTests: true,
            }),
          })
      ).not.toThrow();
    });
  });

  describe('error mapping', () => {
    it('maps 401 to AuthError without retrying', async () => {
      const fetchMock = mockFetch([
        {
          status: 401,
          body: { error: [{ type: 'AUTH', code: 'BAD_KEY', message: 'invalid' }] },
        },
      ]);
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      await expect(client.createSession(validInput)).rejects.toBeInstanceOf(AuthError);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('retries 500 up to maxAttempts then throws ServerError', async () => {
      const fetchMock = mockFetch([
        { status: 500, body: { error: [{ message: 'boom' }] } },
        { status: 500, body: { error: [{ message: 'boom' }] } },
        { status: 500, body: { error: [{ message: 'boom' }] } },
      ]);
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        __allowInsecureUrlForTests: true,
      });
      await expect(client.createSession(validInput)).rejects.toBeInstanceOf(ServerError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('deadline propagation', () => {
    it('throws DeadlineExceededError when deadline already passed', async () => {
      mockFetch([]); // never called
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });
      await expect(
        client.createSession({ ...validInput, deadline: Date.now() - 1000 })
      ).rejects.toBeInstanceOf(DeadlineExceededError);
    });
  });

  describe('circuit breaker integration', () => {
    it('fails fast with CircuitOpenError after breaker trips', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      const fetchMock = mockFetch([
        { status: 500, body: { error: [{ message: 'boom' }] } },
        // No further responses — if fetch is called again, test fails
      ]);
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        breaker,
        retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2 },
        __allowInsecureUrlForTests: true,
      });

      await expect(client.createSession(validInput)).rejects.toBeInstanceOf(ServerError);
      expect(breaker.getState()).toBe('open');

      await expect(client.createSession(validInput)).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe('token cache', () => {
    it('returns cached session on second call with same cacheKey', async () => {
      const fetchMock = mockFetch([
        {
          status: 200,
          body: {
            accessToken: 'cached-tok',
            expiresAt: Date.now() + 3_600_000,
            gatewayResponse: {
              transactionProcessingDetails: { orderId: 'O1' },
            },
          },
        },
      ]);
      const client = new CommerceHubClient({
        baseUrl: 'http://localhost:9999',
        auth: makeAuth(),
        __allowInsecureUrlForTests: true,
      });

      const first = await client.createSession({ ...validInput, cacheKey: 'k1' });
      const second = await client.createSession({ ...validInput, cacheKey: 'k1' });

      expect(first.accessToken).toBe('cached-tok');
      expect(second.accessToken).toBe('cached-tok');
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
