/**
 * BaseAdapter — composition-based abstract class.
 *
 * Delegates to AdapterStateMachine + AdapterEventEmitter + AdapterValidator.
 * Subclasses override:
 *   - metadata (id, displayName, pattern)
 *   - `loadSDK()` — optional, default no-op
 *   - `doInit()` — set up provider state after validation
 *   - `doRender()` — mount widget / prepare DOM. May be no-op.
 *   - `doAuthorize()` — return an OrderResult or throw
 *   - `doTeardown()` — clean up DOM + timers
 *
 * The base class handles lifecycle ordering, state transitions,
 * event emission, webhook subscription for async flows, and error mapping.
 */

import type {
  CheckoutEvent,
  OrderError,
  OrderResult,
  WebhookEnvelope,
} from '@commercehub/shared-types';
import type { APMAdapter, APMPattern, AdapterContext, CheckoutConfig } from './types.js';
import { AdapterStateMachine, type AdapterState } from './adapter-state-machine.js';
import {
  AdapterEventEmitter,
} from './adapter-event-emitter.js';
import { AdapterValidator } from './adapter-validator.js';
import { SessionClientError } from './session-client.js';

export abstract class BaseAdapter implements APMAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly pattern: APMPattern;

  protected config!: CheckoutConfig;
  protected ctx!: AdapterContext;

  protected readonly sm = new AdapterStateMachine();
  protected validator = new AdapterValidator();
  protected emitter!: AdapterEventEmitter;

  private webhookUnsub?: () => void;

  /** Subclasses override to load provider SDKs. */
  async loadSDK(): Promise<void> {
    // default no-op
  }

  /**
   * Lifecycle: init.
   * 1. validate config
   * 2. transition idle → initializing
   * 3. call subclass doInit
   * 4. wire webhook listener (for async adapters)
   * 5. load SDK
   * 6. transition initializing → ready
   */
  async init(config: CheckoutConfig, ctx: AdapterContext): Promise<void> {
    this.config = config;
    this.ctx = ctx;
    this.emitter = new AdapterEventEmitter({
      apm: this.id,
      sessionId: config.credentials.sessionId,
      correlationId: this.deriveCorrelationId(config),
      bus: ctx.eventBus,
    });

    this.sm.onChange((from, to) => {
      void this.emitter.onStateChange(from, to);
    });

    this.validator.validate(config);

    this.sm.transition('initializing');

    try {
      await this.loadSDK();
      await this.doInit(config, ctx);
      this.wireWebhooks();
      this.sm.transition('ready');
    } catch (err) {
      this.fail(err);
      throw err;
    }
  }

  async render(): Promise<void> {
    if (this.sm.state !== 'ready') {
      throw new Error(`${this.id}: cannot render from state ${this.sm.state}`);
    }
    await this.doRender();
  }

  /**
   * Lifecycle: authorize.
   * Transitions ready → authorizing, then either:
   *   - sync success → completed
   *   - async → pending (awaiting webhook)
   *   - error → failed
   *   - user cancelled → cancelled
   */
  async authorize(): Promise<OrderResult> {
    if (this.sm.state !== 'ready') {
      throw new Error(`${this.id}: cannot authorize from state ${this.sm.state}`);
    }
    this.sm.transition('authorizing');

    let result: OrderResult;
    try {
      result = await this.doAuthorize();
    } catch (err) {
      this.fail(err);
      throw err;
    }

    return this.resolveAuthorizeResult(result);
  }

  async teardown(): Promise<void> {
    this.webhookUnsub?.();
    try {
      await this.doTeardown();
    } finally {
      this.ctx?.eventBus.clear();
    }
  }

  // -------- subclass hooks --------

  protected abstract doInit(config: CheckoutConfig, ctx: AdapterContext): Promise<void>;

  protected async doRender(): Promise<void> {
    // default no-op for headless flows
  }

  protected abstract doAuthorize(): Promise<OrderResult>;

  protected async doTeardown(): Promise<void> {
    // default no-op
  }

  // -------- helpers available to subclasses --------

  /**
   * Drive completion from a webhook envelope. Called by the BaseAdapter's
   * webhook handler; subclasses generally don't call this directly.
   */
  protected onWebhookEnvelope(envelope: WebhookEnvelope): void {
    if (this.sm.state !== 'pending') return;
    if (envelope.sessionId !== this.config.credentials.sessionId) return;

    switch (envelope.kind) {
      case 'payment.succeeded':
        this.emitter.setContext({
          orderResult: {
            orderId: envelope.orderId,
            status: 'captured',
            nextAction: { kind: 'none' },
          },
        });
        this.sm.transition('completed');
        break;
      case 'payment.failed':
        this.emitter.setContext({
          error: {
            code: 'PROVIDER_REJECTED',
            message: 'Payment failed at provider',
          },
        });
        this.sm.transition('failed');
        break;
      case 'payment.cancelled':
        this.emitter.setContext({ cancellationReason: 'Cancelled at provider' });
        this.sm.transition('cancelled');
        break;
      case 'payment.expired':
        this.emitter.setContext({ cancellationReason: 'Session expired before authorization' });
        this.sm.transition('cancelled');
        break;
    }
  }

  /** Map an authorize() return value to the correct terminal state. */
  private resolveAuthorizeResult(result: OrderResult): OrderResult {
    if (result.status === 'pending_authorization') {
      this.emitter.setContext({
        pendingOrderId: result.orderId,
        redirectUrl:
          result.nextAction.kind === 'redirect' ? result.nextAction.redirectUrl : undefined,
      });
      this.sm.transition('pending');
      return result;
    }

    if (result.status === 'authorized' || result.status === 'captured') {
      this.emitter.setContext({ orderResult: result });
      this.sm.transition('completed');
      return result;
    }

    if (result.status === 'cancelled') {
      this.emitter.setContext({ cancellationReason: 'User cancelled' });
      this.sm.transition('cancelled');
      return result;
    }

    // declined | failed
    this.emitter.setContext({
      error: result.error ?? { code: 'PROVIDER_REJECTED', message: 'Payment failed' },
    });
    this.sm.transition('failed');
    return result;
  }

  /** Normalize an unknown error into a state-machine `failed` transition. */
  private fail(err: unknown): void {
    const error: OrderError = this.normalizeError(err);
    this.emitter.setContext({ error });
    if (!this.sm.isTerminal()) {
      // Always drive to failed unless we're already terminal.
      const targetFrom = this.sm.state;
      try {
        if (targetFrom === 'idle' || targetFrom === 'initializing' || targetFrom === 'authorizing' || targetFrom === 'pending') {
          this.sm.transition('failed');
        }
      } catch {
        // If the transition is illegal (e.g. from ready), force terminal via alternate path
        // by not transitioning at all — keeps the machine consistent.
      }
    }
  }

  private normalizeError(err: unknown): OrderError {
    if (err instanceof SessionClientError) {
      return {
        code: err.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'NETWORK_ERROR',
        message: err.message,
      };
    }
    if (err instanceof Error) {
      return { code: 'PROVIDER_REJECTED', message: err.message };
    }
    return { code: 'UNKNOWN', message: 'Unknown error' };
  }

  private wireWebhooks(): void {
    const listener = this.ctx.webhookListener;
    if (!listener) return;
    const originalOnWebhook = (listener as unknown as { config: { onWebhook: (e: WebhookEnvelope) => void } }).config.onWebhook;
    // BaseAdapter composes: forward every envelope through the adapter first.
    (listener as unknown as { config: { onWebhook: (e: WebhookEnvelope) => void } }).config.onWebhook = (
      envelope
    ) => {
      this.onWebhookEnvelope(envelope);
      originalOnWebhook?.(envelope);
    };
    this.webhookUnsub = () => {
      (listener as unknown as { config: { onWebhook: ((e: WebhookEnvelope) => void) | undefined } }).config.onWebhook = originalOnWebhook;
    };
  }

  private deriveCorrelationId(config: CheckoutConfig): string {
    return `${config.credentials.sessionId}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Current state — exposed for tests and parity assertions. */
  getState(): AdapterState {
    return this.sm.state;
  }

  /** Returns a read-only reference to the event bus for external subscribers. */
  getEventBus() {
    return this.ctx.eventBus as { on: (type: string, fn: (e: CheckoutEvent) => void) => () => void };
  }
}
