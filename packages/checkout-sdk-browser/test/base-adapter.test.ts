/**
 * BaseAdapter integration test using a fake adapter that drives all
 * the lifecycle hooks. This is the closest thing to a parity test
 * we can do without v1 in scope: it asserts the canonical event
 * sequence is emitted for every legal flow.
 */

import { describe, expect, it } from 'vitest';
import type { CheckoutEvent, OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../src/core/base-adapter.js';
import { EventBus } from '../src/core/event-bus.js';
import type { CheckoutConfig, AdapterContext } from '../src/core/types.js';

class TestAdapter extends BaseAdapter {
  readonly id = 'test';
  readonly displayName = 'Test';
  readonly pattern = 'redirect-wallet' as const;

  authorizeResult: OrderResult = {
    orderId: 'O1',
    status: 'authorized',
    nextAction: { kind: 'none' },
  };

  protected async doInit(): Promise<void> {}

  protected async doAuthorize(): Promise<OrderResult> {
    return this.authorizeResult;
  }
}

const baseConfig: CheckoutConfig = {
  apm: 'test',
  amount: { value: 1, currency: 'USD' },
  merchantOrderId: 'O1',
  credentials: {
    accessToken: 'tok',
    sessionId: 'sess-1',
    chBaseUrl: 'http://localhost:3848',
  },
};

function buildCtx(): { ctx: AdapterContext; bus: EventBus<CheckoutEvent>; events: CheckoutEvent[] } {
  const bus = new EventBus<CheckoutEvent>();
  const events: CheckoutEvent[] = [];
  bus.onAny((e) => events.push(e));
  return {
    ctx: {
      sessionClient: {} as never,
      eventBus: bus,
    },
    bus,
    events,
  };
}

describe('BaseAdapter', () => {
  it('sync success emits INITIALIZING → SDK_LOADED → READY → AUTHORIZING → AUTHORIZED → COMPLETED', async () => {
    const adapter = new TestAdapter();
    const { ctx, events } = buildCtx();
    await adapter.init(baseConfig, ctx);
    await adapter.authorize();

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'INITIALIZING',
      'SDK_LOADED',
      'PAYMENT_METHOD_READY',
      'PAYMENT_AUTHORIZING',
      'PAYMENT_AUTHORIZED',
      'PAYMENT_COMPLETED',
    ]);
    expect(adapter.getState()).toBe('completed');
  });

  it('async pending: emits REDIRECT_REQUIRED + PAYMENT_PENDING and stays in pending', async () => {
    const adapter = new TestAdapter();
    adapter.authorizeResult = {
      orderId: 'O2',
      status: 'pending_authorization',
      nextAction: { kind: 'redirect', redirectUrl: 'https://bank.example' },
    };
    const { ctx, events } = buildCtx();
    await adapter.init(baseConfig, ctx);
    await adapter.authorize();

    const types = events.map((e) => e.type);
    expect(types).toContain('REDIRECT_REQUIRED');
    expect(types).toContain('PAYMENT_PENDING');
    expect(types).not.toContain('PAYMENT_COMPLETED');
    expect(adapter.getState()).toBe('pending');
  });

  it('declined result emits PAYMENT_FAILED', async () => {
    const adapter = new TestAdapter();
    adapter.authorizeResult = {
      orderId: 'O3',
      status: 'declined',
      nextAction: { kind: 'none' },
      error: { code: 'AUTH_FAILED', message: 'rejected' },
    };
    const { ctx, events } = buildCtx();
    await adapter.init(baseConfig, ctx);
    await adapter.authorize();

    expect(events.map((e) => e.type)).toContain('PAYMENT_FAILED');
    expect(adapter.getState()).toBe('failed');
  });

  it('cancelled result emits PAYMENT_CANCELLED', async () => {
    const adapter = new TestAdapter();
    adapter.authorizeResult = {
      orderId: 'O4',
      status: 'cancelled',
      nextAction: { kind: 'none' },
    };
    const { ctx, events } = buildCtx();
    await adapter.init(baseConfig, ctx);
    await adapter.authorize();

    expect(events.map((e) => e.type)).toContain('PAYMENT_CANCELLED');
    expect(adapter.getState()).toBe('cancelled');
  });

  it('cannot authorize before init', async () => {
    const adapter = new TestAdapter();
    await expect(adapter.authorize()).rejects.toThrow();
  });

  it('refuses to init with invalid config (missing accessToken)', async () => {
    const adapter = new TestAdapter();
    const { ctx } = buildCtx();
    const bad = { ...baseConfig, credentials: { ...baseConfig.credentials, accessToken: '' } };
    await expect(adapter.init(bad, ctx)).rejects.toThrow();
  });

  it('webhook envelope drives pending → completed', async () => {
    const adapter = new TestAdapter();
    adapter.authorizeResult = {
      orderId: 'O5',
      status: 'pending_authorization',
      nextAction: { kind: 'redirect', redirectUrl: 'https://bank.example' },
    };
    const { ctx, events } = buildCtx();
    await adapter.init(baseConfig, ctx);
    await adapter.authorize();
    expect(adapter.getState()).toBe('pending');

    // Simulate webhook arrival via the protected handler.
    // Real wiring would route through WebhookListener composition.
    (adapter as unknown as { onWebhookEnvelope: (e: unknown) => void }).onWebhookEnvelope({
      id: 'evt-1',
      sessionId: 'sess-1',
      provider: 'ch',
      kind: 'payment.succeeded',
      orderId: 'O5',
      occurredAt: Date.now(),
    });

    expect(adapter.getState()).toBe('completed');
    expect(events.map((e) => e.type)).toContain('PAYMENT_COMPLETED');
  });
});
