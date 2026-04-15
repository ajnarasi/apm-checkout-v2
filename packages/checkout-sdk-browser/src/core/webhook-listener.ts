/**
 * WebhookListener — browser-side SSE client for async-APM completion.
 *
 * For async APMs (iDEAL, PayTo, Boleto, Alipay+, most PPROs), the user
 * authorizes at their bank / provider and the SDK must wait for a
 * webhook to arrive on the merchant backend. The reference server
 * relays webhooks to connected browsers via Server-Sent Events on
 * `GET /v2/events/:sessionId`.
 *
 * Last-Event-ID support: if the browser disconnects (tab switch, network
 * blip), it reconnects with `Last-Event-ID` header and the server
 * replays any missed events from its ring buffer.
 *
 * Terminal events are NOT emitted by this class. It only calls
 * `onWebhook` so the BaseAdapter can drive the state machine.
 */

import type { WebhookEnvelope } from '@commercehub/shared-types';

export interface WebhookListenerConfig {
  /** Base URL where /v2/events/:sessionId lives (usually merchant backend). */
  baseUrl: string;
  sessionId: string;
  /** Called when a webhook envelope arrives. */
  onWebhook: (envelope: WebhookEnvelope) => void | Promise<void>;
  /** Called on unrecoverable connection error. */
  onError?: (err: Error) => void;
}

export class WebhookListener {
  private source?: EventSource;
  private closed = false;
  private lastEventId?: string;

  constructor(private readonly config: WebhookListenerConfig) {}

  /** Open the SSE connection. Safe to call multiple times — later calls are no-ops. */
  start(): void {
    if (this.source || this.closed) return;
    this.connect();
  }

  /** Close the SSE connection. Terminal. */
  stop(): void {
    this.closed = true;
    if (this.source) {
      this.source.close();
      this.source = undefined;
    }
  }

  private connect(): void {
    if (this.closed) return;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v2/events/${encodeURIComponent(this.config.sessionId)}`;
    // EventSource automatically sends Last-Event-ID from its own state
    // once it has received at least one event with an `id:` field.
    const source = new EventSource(url, { withCredentials: false });
    this.source = source;

    source.onmessage = async (ev) => {
      this.lastEventId = ev.lastEventId;
      try {
        const envelope = JSON.parse(ev.data) as WebhookEnvelope;
        await this.config.onWebhook(envelope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[WebhookListener] failed to parse envelope', err);
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects by default. We only surface the error
      // if we're already in CLOSED state (reconnect gave up).
      if (source.readyState === EventSource.CLOSED && !this.closed) {
        this.config.onError?.(new Error('WebhookListener: connection closed'));
      }
    };
  }

  /** Exposed for testing + future restart support. */
  getLastEventId(): string | undefined {
    return this.lastEventId;
  }
}
