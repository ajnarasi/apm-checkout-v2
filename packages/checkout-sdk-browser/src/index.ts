/**
 * Public entry point for @commercehub/checkout-sdk-browser.
 *
 * Importing this module also auto-registers all 55 adapters via the
 * side-effect import below.
 */

import './register-all.js';

export { createCheckout, type CheckoutHandle } from './core/checkout-manager.js';
export type {
  CheckoutConfig,
  CheckoutCredentials,
  APMAdapter,
  APMPattern,
  AdapterContext,
} from './core/types.js';

export { SessionClient, SessionClientError } from './core/session-client.js';
export { WebhookListener } from './core/webhook-listener.js';
export { EventBus } from './core/event-bus.js';
export { BaseAdapter } from './core/base-adapter.js';
export { AdapterStateMachine, IllegalTransitionError, TERMINAL_STATES } from './core/adapter-state-machine.js';
export type { AdapterState } from './core/adapter-state-machine.js';
export { AdapterEventEmitter } from './core/adapter-event-emitter.js';
export { AdapterValidator, ConfigValidationError } from './core/adapter-validator.js';
export { mapOrderResult } from './core/order-result-mapper.js';
export {
  registerAdapter,
  getAdapter,
  listAdapterIds,
  hasAdapter,
} from './core/adapter-registry.js';

export {
  PPRO_ADAPTERS,
  registerAllPproAdapters,
  type PproAdapterConfig,
} from './ppro-adapter-factory.js';

export type {
  CheckoutEvent,
  CheckoutEventType,
  OrderResult,
  OrderError,
  OrderStatus,
  NextAction,
  WebhookEnvelope,
  SessionResponse,
} from '@commercehub/shared-types';
