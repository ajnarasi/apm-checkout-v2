/**
 * Klarna real-adapter test using the provider fake.
 *
 * Validates the architect Pass #2 P0 #1 + P1 requirement: the adapter calls
 * REAL `Klarna.Payments.init/load/authorize` APIs end-to-end, but the
 * `window.Klarna` global is stubbed by the provider fake so unit tests
 * don't hit the real Klarna CDN.
 *
 * If this test passes, it proves:
 *   1. KlarnaAdapter loads the SDK via the loadScript helper (resolved
 *      via globalCheck since the fake is pre-installed)
 *   2. KlarnaAdapter wires Klarna.Payments.init with the providerClientToken
 *   3. KlarnaAdapter mounts the widget via Klarna.Payments.load
 *   4. KlarnaAdapter calls Klarna.Payments.authorize and forwards the
 *      authorization_token to sessionClient.authorizeOrder
 *   5. The state machine progresses through the canonical event sequence
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// jsdom test environment is configured in vitest.config.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KlarnaAdapter } from '../src/adapters/tokenization/klarna-adapter.js';
import {
  installKlarnaFake,
  uninstallKlarnaFake,
} from '../src/testing/provider-fakes/klarna.js';
import { EventBus } from '../src/core/event-bus.js';
import type { CheckoutEvent } from '@commercehub/shared-types';
import type { CheckoutConfig, AdapterContext } from '../src/core/types.js';

function buildConfig(overrides: Partial<CheckoutConfig> = {}): CheckoutConfig {
  return {
    apm: 'klarna',
    amount: { value: 49.99, currency: 'USD' },
    merchantOrderId: 'TEST-ORDER-1',
    containerId: 'klarna-test-container',
    credentials: {
      accessToken: 'fake-access-token',
      sessionId: 'fake-session-1',
      chBaseUrl: 'http://localhost:3848',
      providerClientToken: 'klarna-fake-client-token',
    },
    ...overrides,
  };
}

function buildCtx(): {
  ctx: AdapterContext;
  bus: EventBus<CheckoutEvent>;
  events: CheckoutEvent[];
  authorizeOrder: ReturnType<typeof vi.fn>;
} {
  const bus = new EventBus<CheckoutEvent>();
  const events: CheckoutEvent[] = [];
  bus.onAny((e) => events.push(e));

  const authorizeOrder = vi.fn().mockResolvedValue({
    orderId: 'TEST-CH-ORDER-1',
    status: 'authorized',
    nextAction: { kind: 'none' },
  });

  return {
    ctx: {
      sessionClient: {
        authorizeOrder,
      } as any,
      eventBus: bus,
    } as AdapterContext,
    bus,
    events,
    authorizeOrder,
  };
}

describe('KlarnaAdapter (real adapter + provider fake)', () => {
  beforeEach(() => {
    // Mount a container the adapter can render into.
    const div = document.createElement('div');
    div.id = 'klarna-test-container';
    document.body.appendChild(div);
    installKlarnaFake({ approved: true, authorizationToken: 'fake-tok-xyz' });
  });

  afterEach(() => {
    uninstallKlarnaFake();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('declares a capabilities row matching ADR / capability matrix', () => {
    const caps = KlarnaAdapter.capabilities;
    expect(caps.pattern).toBe('tokenization');
    expect(caps.displayName).toBe('Klarna');
    expect(caps.region).toBe('Global');
    // Architect P0: token TTL declared
    expect(caps.token.tokenTTLMs).toBeGreaterThan(0);
    expect(caps.token.singleUse).toBe(true);
    // Klarna supports both gateway- and merchant-initiated
    expect(caps.intents.supportsGatewayInitiated).toBe(true);
    expect(caps.intents.supportsMerchantInitiated).toBe(true);
    expect(caps.intents.supportsSeparateCapture).toBe(true);
    // BNPL widgets
    expect(caps.bnpl.providesPromoWidget).toBe(true);
    expect(caps.bnpl.authHoldTTLMs).toBeGreaterThan(0);
    // Amount transform
    expect(caps.amountTransform).toBe('MULTIPLY_100');
    // CSP origins declared
    expect(caps.csp.scriptOrigins).toContain('https://x.klarnacdn.net');
  });

  it('completes the gateway-initiated lifecycle end-to-end via the provider fake', async () => {
    const adapter = new KlarnaAdapter();
    const { ctx, events, authorizeOrder } = buildCtx();

    await adapter.init(buildConfig(), ctx);
    await adapter.render();
    await adapter.authorize();

    // 1. The adapter forwarded the Klarna authorization_token to the backend
    expect(authorizeOrder).toHaveBeenCalledOnce();
    const call = authorizeOrder.mock.calls[0][0];
    expect(call.apm).toBe('klarna');
    expect(call.merchantOrderId).toBe('TEST-ORDER-1');
    expect(call.providerData).toMatchObject({
      authorizationToken: 'fake-tok-xyz',
    });

    // 2. The state machine reached completed
    expect(adapter.getState()).toBe('completed');

    // 3. Event sequence
    const types = events.map((e) => e.type);
    expect(types).toContain('INITIALIZING');
    expect(types).toContain('SDK_LOADED');
    expect(types).toContain('PAYMENT_METHOD_READY');
    expect(types).toContain('PAYMENT_AUTHORIZING');
    expect(types).toContain('PAYMENT_COMPLETED');
  });

  it('throws if providerClientToken is missing', async () => {
    const adapter = new KlarnaAdapter();
    const { ctx } = buildCtx();
    const config = buildConfig({
      credentials: {
        accessToken: 'tok',
        sessionId: 'sess-1',
        chBaseUrl: 'http://localhost',
        // providerClientToken intentionally omitted
      },
    });
    await expect(adapter.init(config, ctx)).rejects.toThrow(/providerClientToken/);
  });

  it('declined authorize transitions to failed', async () => {
    uninstallKlarnaFake();
    installKlarnaFake({ approved: false, invalidFields: ['shipping_address'] });

    const adapter = new KlarnaAdapter();
    const { ctx, events } = buildCtx();
    await adapter.init(buildConfig(), ctx);
    await adapter.render();
    await expect(adapter.authorize()).rejects.toThrow(/Klarna declined/);
    expect(adapter.getState()).toBe('failed');
    expect(events.map((e) => e.type)).toContain('PAYMENT_FAILED');
  });
});
