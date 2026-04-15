import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionClient, SessionClientError } from '../src/core/session-client.js';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  const mock = vi.fn().mockImplementation(async () => {
    const r = responses[i++];
    if (!r) throw new Error(`mockFetch ran out (call ${i})`);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('SessionClient', () => {
  beforeEach(() => {
    // ensure clean fetch
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects construction without accessToken', () => {
    expect(
      () => new SessionClient({ accessToken: '', baseUrl: 'http://localhost' })
    ).toThrow(/accessToken is required/);
  });

  it('rejects construction without baseUrl', () => {
    expect(
      () => new SessionClient({ accessToken: 'tok', baseUrl: '' })
    ).toThrow(/baseUrl is required/);
  });

  it('authorizeOrder POSTs to /v2/orders/:apm with Bearer auth', async () => {
    const fetchMock = mockFetch([
      {
        status: 200,
        body: {
          gatewayResponse: {
            transactionState: 'AUTHORIZED',
            transactionProcessingDetails: { orderId: 'O1' },
          },
        },
      },
    ]);
    const client = new SessionClient({
      accessToken: 'tok-1',
      baseUrl: 'http://localhost:3848',
      correlationId: 'corr-1',
    });

    const result = await client.authorizeOrder({
      apm: 'klarna',
      merchantOrderId: 'ORDER-1',
      amount: { value: 49.99, currency: 'USD' },
    });

    expect(result.status).toBe('authorized');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3848/v2/orders/klarna');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['X-Correlation-Id']).toBe('corr-1');
  });

  it('maps 401 to SessionClientError(AUTH_FAILED)', async () => {
    mockFetch([{ status: 401, body: { error: 'unauthorized' } }]);
    const client = new SessionClient({
      accessToken: 'tok',
      baseUrl: 'http://localhost:3848',
    });
    try {
      await client.authorizeOrder({
        apm: 'klarna',
        merchantOrderId: 'O1',
        amount: { value: 1, currency: 'USD' },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SessionClientError);
      expect((err as SessionClientError).code).toBe('AUTH_FAILED');
    }
  });

  it('maps 500 to SessionClientError(SERVER_ERROR)', async () => {
    mockFetch([{ status: 500, body: { error: 'boom' } }]);
    const client = new SessionClient({
      accessToken: 'tok',
      baseUrl: 'http://localhost:3848',
    });
    try {
      await client.authorizeOrder({
        apm: 'klarna',
        merchantOrderId: 'O1',
        amount: { value: 1, currency: 'USD' },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as SessionClientError).code).toBe('SERVER_ERROR');
    }
  });

  it('getOrder hits GET /v2/orders/:orderId', async () => {
    const fetchMock = mockFetch([
      {
        status: 200,
        body: {
          gatewayResponse: {
            transactionState: 'PENDING',
            transactionProcessingDetails: { orderId: 'O2' },
          },
        },
      },
    ]);
    const client = new SessionClient({ accessToken: 'tok', baseUrl: 'http://localhost' });
    const r = await client.getOrder('O2');
    expect(r.status).toBe('pending_authorization');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
  });
});
