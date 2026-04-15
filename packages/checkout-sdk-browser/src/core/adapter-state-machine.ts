/**
 * Canonical adapter state machine — v3 (ADR-003 LOCKED 2026-04-14).
 *
 * 11 states, 18 legal transitions. Supersedes ADR-001 (8 states) and
 * ADR-002 (10 states, drafted but never coded).
 *
 * Any adapter action outside this vocabulary is a bug. Parity tests assert
 * v1 event sequences and v2.1 hero-adapter flows map cleanly into this
 * vocabulary.
 *
 * Terminal states (completed, failed, cancelled, auth_expired, script_load_failed)
 * are emitted from exactly ONE path — the state machine via AdapterEventEmitter.
 * Neither HTTP responses nor webhooks emit terminal events directly; they only
 * request state transitions. The single-source-of-truth emission rule plus the
 * first-writer-wins precedence rule (see OrderResultCache) eliminate dual
 * emission across sync + webhook paths.
 *
 * See docs/ADR-003-state-machine-vocabulary.md for full rationale.
 */

export type AdapterState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'authorizing'
  | 'pending'
  | 'awaiting_merchant_capture' // v2.1: paymentInitiator=MERCHANT auth-only success
  | 'capturing' // v2.1: merchant.capture() in flight
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'auth_expired' // v2.1: TTL elapsed before merchant captured
  | 'script_load_failed'; // v2.1: provider CDN load failed

const LEGAL_TRANSITIONS: Record<AdapterState, readonly AdapterState[]> = {
  idle: ['initializing'],
  initializing: ['ready', 'failed', 'script_load_failed'],
  ready: ['authorizing'],
  authorizing: [
    'pending',
    'awaiting_merchant_capture',
    'completed',
    'failed',
    'cancelled',
  ],
  pending: [
    'awaiting_merchant_capture',
    'completed',
    'failed',
    'cancelled',
  ],
  awaiting_merchant_capture: [
    'capturing',
    'cancelled', // explicit void
    'auth_expired', // TTL guard fired
  ],
  capturing: ['completed', 'failed'],
  // ── terminal states ──
  completed: [],
  failed: [],
  cancelled: [],
  auth_expired: [],
  script_load_failed: [],
};

export const TERMINAL_STATES: ReadonlySet<AdapterState> = new Set([
  'completed',
  'failed',
  'cancelled',
  'auth_expired',
  'script_load_failed',
]);

export class IllegalTransitionError extends Error {
  readonly from: AdapterState;
  readonly to: AdapterState;
  constructor(from: AdapterState, to: AdapterState) {
    super(
      `Illegal adapter state transition: ${from} → ${to}. ` +
        `Legal transitions from ${from}: ${LEGAL_TRANSITIONS[from].join(', ') || '(terminal)'}`
    );
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export type StateChangeListener = (from: AdapterState, to: AdapterState) => void;

/**
 * The state machine. Validates transitions, notifies listeners,
 * and refuses all transitions once terminal.
 */
export class AdapterStateMachine {
  private _state: AdapterState = 'idle';
  private readonly listeners = new Set<StateChangeListener>();

  get state(): AdapterState {
    return this._state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  canTransition(to: AdapterState): boolean {
    return LEGAL_TRANSITIONS[this._state].includes(to);
  }

  /**
   * Request a state transition.
   *
   * - Self-transitions (e.g. `pending → pending`) are no-ops, not errors.
   *   This implements the first-writer-wins precedence rule from ADR-003:
   *   if a sync HTTP response and an async webhook both request the same
   *   transition, the second arriver's request is silently absorbed.
   * - Illegal transitions throw IllegalTransitionError.
   */
  transition(to: AdapterState): void {
    if (this._state === to) return; // no-op self-transition (precedence rule)
    if (!this.canTransition(to)) {
      throw new IllegalTransitionError(this._state, to);
    }
    const from = this._state;
    this._state = to;
    for (const listener of this.listeners) {
      try {
        listener(from, to);
      } catch {
        // listener errors must NOT prevent other listeners from running
        // (no console.log per coding-style — drop silently, listeners own their own errors)
      }
    }
  }

  onChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
