import { describe, expect, it } from 'vitest';
import {
  AdapterStateMachine,
  IllegalTransitionError,
  TERMINAL_STATES,
} from '../src/core/adapter-state-machine.js';

describe('AdapterStateMachine', () => {
  it('starts in idle', () => {
    expect(new AdapterStateMachine().state).toBe('idle');
  });

  it('legal transitions: idle → initializing → ready → authorizing → completed', () => {
    const sm = new AdapterStateMachine();
    sm.transition('initializing');
    sm.transition('ready');
    sm.transition('authorizing');
    sm.transition('completed');
    expect(sm.state).toBe('completed');
    expect(sm.isTerminal()).toBe(true);
  });

  it('legal transitions: authorizing → pending → completed (async)', () => {
    const sm = new AdapterStateMachine();
    sm.transition('initializing');
    sm.transition('ready');
    sm.transition('authorizing');
    sm.transition('pending');
    sm.transition('completed');
    expect(sm.state).toBe('completed');
  });

  it('rejects illegal transition idle → ready', () => {
    const sm = new AdapterStateMachine();
    expect(() => sm.transition('ready')).toThrow(IllegalTransitionError);
  });

  it('rejects transition out of terminal state', () => {
    const sm = new AdapterStateMachine();
    sm.transition('initializing');
    sm.transition('ready');
    sm.transition('authorizing');
    sm.transition('completed');
    expect(() => sm.transition('failed')).toThrow(IllegalTransitionError);
  });

  it('self-transitions are no-ops', () => {
    const sm = new AdapterStateMachine();
    sm.transition('initializing');
    sm.transition('initializing');
    expect(sm.state).toBe('initializing');
  });

  it('notifies listeners on every transition', () => {
    const sm = new AdapterStateMachine();
    const events: Array<[string, string]> = [];
    sm.onChange((from, to) => events.push([from, to]));
    sm.transition('initializing');
    sm.transition('failed');
    expect(events).toEqual([
      ['idle', 'initializing'],
      ['initializing', 'failed'],
    ]);
  });

  it('TERMINAL_STATES contains the 5 terminal states from ADR-003', () => {
    expect(TERMINAL_STATES.has('completed')).toBe(true);
    expect(TERMINAL_STATES.has('failed')).toBe(true);
    expect(TERMINAL_STATES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATES.has('auth_expired')).toBe(true);
    expect(TERMINAL_STATES.has('script_load_failed')).toBe(true);
    expect(TERMINAL_STATES.has('pending')).toBe(false);
    expect(TERMINAL_STATES.has('awaiting_merchant_capture')).toBe(false);
    expect(TERMINAL_STATES.has('capturing')).toBe(false);
    expect(TERMINAL_STATES.size).toBe(5);
  });

  it('listener errors do not prevent transitions', () => {
    const sm = new AdapterStateMachine();
    sm.onChange(() => {
      throw new Error('listener boom');
    });
    expect(() => sm.transition('initializing')).not.toThrow();
    expect(sm.state).toBe('initializing');
  });

  // ──────────────── ADR-003 v2.1 transitions ────────────────

  describe('v2.1 merchant-initiated lifecycle (ADR-003)', () => {
    it('authorizing → awaiting_merchant_capture → capturing → completed', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('awaiting_merchant_capture');
      sm.transition('capturing');
      sm.transition('completed');
      expect(sm.state).toBe('completed');
    });

    it('pending → awaiting_merchant_capture (async merchant-initiated)', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('pending');
      sm.transition('awaiting_merchant_capture');
      expect(sm.state).toBe('awaiting_merchant_capture');
    });

    it('awaiting_merchant_capture → cancelled (explicit void)', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('awaiting_merchant_capture');
      sm.transition('cancelled');
      expect(sm.state).toBe('cancelled');
    });

    it('awaiting_merchant_capture → auth_expired (TTL fired)', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('awaiting_merchant_capture');
      sm.transition('auth_expired');
      expect(sm.state).toBe('auth_expired');
      expect(sm.isTerminal()).toBe(true);
    });

    it('capturing → failed', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('awaiting_merchant_capture');
      sm.transition('capturing');
      sm.transition('failed');
      expect(sm.state).toBe('failed');
    });

    it('initializing → script_load_failed', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('script_load_failed');
      expect(sm.state).toBe('script_load_failed');
      expect(sm.isTerminal()).toBe(true);
    });

    it('rejects awaiting_merchant_capture from idle', () => {
      const sm = new AdapterStateMachine();
      expect(() => sm.transition('awaiting_merchant_capture')).toThrow(IllegalTransitionError);
    });

    it('rejects capturing without going through awaiting_merchant_capture first', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      expect(() => sm.transition('capturing')).toThrow(IllegalTransitionError);
    });

    it('rejects transitions out of auth_expired (terminal)', () => {
      const sm = new AdapterStateMachine();
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      sm.transition('awaiting_merchant_capture');
      sm.transition('auth_expired');
      expect(() => sm.transition('capturing')).toThrow(IllegalTransitionError);
      expect(() => sm.transition('completed')).toThrow(IllegalTransitionError);
    });

    it('first-writer-wins precedence: race between sync + webhook becomes self-no-op', () => {
      const sm = new AdapterStateMachine();
      const events: Array<[string, string]> = [];
      sm.onChange((from, to) => events.push([from, to]));
      sm.transition('initializing');
      sm.transition('ready');
      sm.transition('authorizing');
      // Sync response transitions to completed first
      sm.transition('completed');
      // Webhook arrives later — same transition, should be self-no-op.
      // The state machine's API is to call transition() with the desired target.
      // Since 'completed' is terminal and we're already in it, the no-op kicks in.
      sm.transition('completed');
      // Listener should have fired exactly twice for the legal transitions
      // (initializing, ready, authorizing, completed) — that's 4 transitions.
      expect(events.length).toBe(4);
      expect(events[3]).toEqual(['authorizing', 'completed']);
    });
  });
});
