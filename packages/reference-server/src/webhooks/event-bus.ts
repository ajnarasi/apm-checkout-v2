/**
 * In-memory webhook event bus with a per-session ring-buffer replay store.
 *
 * Architect concern #1: a naive in-memory bus loses events when the
 * SSE client and webhook land on different instances. We mitigate by:
 *   - REFUSING multi-instance via env.ts (INSTANCE_COUNT > 1 → boot fails)
 *   - Maintaining a 50-event ring buffer per sessionId for 5 minutes
 *   - Supporting `Last-Event-ID` SSE reconnect to replay missed events
 *
 * Multi-instance production deployments must implement RedisEventBus
 * — interface defined here, implementation deferred to v2.1.
 */

import type { WebhookEnvelope } from '@commercehub/shared-types';
import { randomUUID } from 'node:crypto';

export type WebhookListener = (envelope: WebhookEnvelope) => void;

export interface WebhookEventBus {
  /** Publish an event to all listeners and the ring buffer. */
  publish(envelope: Omit<WebhookEnvelope, 'id'>): WebhookEnvelope;
  /** Subscribe to events for a specific session. Returns an unsubscribe fn. */
  subscribe(sessionId: string, listener: WebhookListener): () => void;
  /** Replay all events for a session that came AFTER the given event id. */
  replay(sessionId: string, sinceEventId?: string): WebhookEnvelope[];
}

export interface InMemoryEventBusConfig {
  /** Per-session ring buffer size. Default 50. */
  bufferSize?: number;
  /** TTL for buffered events in ms. Default 5 minutes. */
  ttlMs?: number;
  /** Clock — injectable for tests. */
  now?: () => number;
}

interface BufferEntry {
  envelope: WebhookEnvelope;
  expiresAt: number;
}

export class InMemoryEventBus implements WebhookEventBus {
  private readonly listeners = new Map<string, Set<WebhookListener>>();
  private readonly buffers = new Map<string, BufferEntry[]>();
  private readonly bufferSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(config: InMemoryEventBusConfig = {}) {
    this.bufferSize = config.bufferSize ?? 50;
    this.ttlMs = config.ttlMs ?? 5 * 60 * 1000;
    this.now = config.now ?? Date.now;
  }

  publish(envelope: Omit<WebhookEnvelope, 'id'>): WebhookEnvelope {
    const full: WebhookEnvelope = { ...envelope, id: randomUUID() };

    // Append to the per-session ring buffer
    let buf = this.buffers.get(full.sessionId);
    if (!buf) {
      buf = [];
      this.buffers.set(full.sessionId, buf);
    }
    buf.push({ envelope: full, expiresAt: this.now() + this.ttlMs });
    if (buf.length > this.bufferSize) buf.shift();

    // Notify connected listeners
    const set = this.listeners.get(full.sessionId);
    if (set) {
      for (const l of set) {
        try {
          l(full);
        } catch {
          // listeners must not break the bus
        }
      }
    }

    return full;
  }

  subscribe(sessionId: string, listener: WebhookListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(sessionId);
    };
  }

  replay(sessionId: string, sinceEventId?: string): WebhookEnvelope[] {
    const buf = this.buffers.get(sessionId);
    if (!buf) return [];

    // Drop expired entries lazily on access
    const now = this.now();
    while (buf.length > 0 && buf[0]!.expiresAt <= now) buf.shift();

    if (!sinceEventId) return buf.map((e) => e.envelope);

    const idx = buf.findIndex((e) => e.envelope.id === sinceEventId);
    if (idx === -1) return buf.map((e) => e.envelope);
    return buf.slice(idx + 1).map((e) => e.envelope);
  }

  /** Active session count — used by /readyz. */
  activeSessions(): number {
    return this.buffers.size;
  }
}
