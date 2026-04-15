/**
 * AdapterEventEmitter — translates state-machine transitions into
 * `CheckoutEvent`s on the shared event bus.
 *
 * This is the ONLY place where terminal checkout events
 * (PAYMENT_COMPLETED / PAYMENT_FAILED / PAYMENT_CANCELLED) are emitted.
 * Adapters never emit terminal events directly — they request state
 * transitions and the emitter decides what to publish.
 */

import type { CheckoutEvent, OrderError, OrderResult } from '@commercehub/shared-types';
import type { EventBus } from './event-bus.js';
import type { AdapterState } from './adapter-state-machine.js';

export interface AdapterEventEmitterConfig {
  apm: string;
  sessionId: string;
  correlationId: string;
  bus: EventBus<CheckoutEvent>;
}

/**
 * Hooks the emitter needs access to when emitting terminal events.
 * Populated by BaseAdapter before each authorize attempt.
 */
export interface EmissionContext {
  /** Set after a successful sync authorization. */
  orderResult?: OrderResult;
  /** Set when authorization failed. */
  error?: OrderError;
  /** Set on cancellation — free-form reason. */
  cancellationReason?: string;
  /** Redirect URL when transitioning authorizing → pending via redirect. */
  redirectUrl?: string;
  /** Order id for async pending state. */
  pendingOrderId?: string;
  /** Expiry for pending state. */
  pendingExpiresAt?: number;
}

export class AdapterEventEmitter {
  private readonly ctx: EmissionContext = {};

  constructor(private readonly config: AdapterEventEmitterConfig) {}

  /** Expose the mutable emission context to BaseAdapter subclasses. */
  setContext(patch: Partial<EmissionContext>): void {
    Object.assign(this.ctx, patch);
  }

  clearContext(): void {
    for (const k of Object.keys(this.ctx)) {
      delete (this.ctx as Record<string, unknown>)[k];
    }
  }

  /** Called by the state machine onChange hook. */
  async onStateChange(_from: AdapterState, to: AdapterState): Promise<void> {
    switch (to) {
      case 'initializing':
        await this.emit({ type: 'INITIALIZING' });
        break;
      case 'ready':
        await this.emit({ type: 'SDK_LOADED' });
        await this.emit({ type: 'PAYMENT_METHOD_READY' });
        break;
      case 'authorizing':
        await this.emit({ type: 'PAYMENT_AUTHORIZING' });
        break;
      case 'pending':
        if (this.ctx.redirectUrl) {
          await this.emit({
            type: 'REDIRECT_REQUIRED',
            redirectUrl: this.ctx.redirectUrl,
          });
        }
        await this.emit({
          type: 'PAYMENT_PENDING',
          orderId: this.ctx.pendingOrderId ?? 'unknown',
          expiresAt: this.ctx.pendingExpiresAt,
        });
        break;
      case 'completed': {
        if (this.ctx.orderResult) {
          await this.emit({ type: 'PAYMENT_AUTHORIZED' });
          await this.emit({
            type: 'PAYMENT_COMPLETED',
            result: this.ctx.orderResult,
          });
        }
        break;
      }
      case 'failed':
        if (this.ctx.error) {
          await this.emit({
            type: 'PAYMENT_FAILED',
            error: this.ctx.error,
          });
        }
        break;
      case 'cancelled':
        await this.emit({
          type: 'PAYMENT_CANCELLED',
          reason: this.ctx.cancellationReason,
        });
        break;
      default:
        break;
    }
  }

  private async emit(partial: Partial<CheckoutEvent> & { type: CheckoutEvent['type'] }): Promise<void> {
    const event = {
      apm: this.config.apm,
      sessionId: this.config.sessionId,
      correlationId: this.config.correlationId,
      timestamp: Date.now(),
      ...partial,
    } as CheckoutEvent;
    await this.config.bus.emit(event);
  }
}
