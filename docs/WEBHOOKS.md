# Webhooks — Async APM Completion

Half of the 55 supported APMs are async. They settle hours (or days, for Boleto) after the user authorizes at their bank or wallet. Webhooks are first-class in v2 — not bolted on.

## End-to-end flow

```
APM provider
   |
   | (settles the payment after user action)
   v
Commerce Hub
   |
   | POST https://your-merchant-backend.example.com/v2/webhooks/:provider
   | X-Webhook-Signature: sha256=<hex>
   v
reference-server route handler
   |
   | 1) verify signature against CH_WEBHOOK_SECRET (timing-safe)
   | 2) normalize to WebhookEnvelope
   | 3) publish to InMemoryEventBus
   v
InMemoryEventBus
   |
   | append to per-session ring buffer + notify SSE subscribers
   v
GET /v2/events/:sessionId (SSE stream)
   |
   v
WebhookListener (browser SDK)
   |
   v
BaseAdapter.onWebhookEnvelope() → AdapterStateMachine.transition(pending → completed)
   |
   v
PAYMENT_COMPLETED event fires on the EventBus
```

## Signature verification

Every webhook MUST carry `X-Webhook-Signature: sha256=<hex>` where `<hex>` is `HMAC-SHA256(CH_WEBHOOK_SECRET, rawRequestBody)`.

The handler uses `timingSafeEqual` to prevent timing attacks. Mismatched signatures get `401 invalid_signature` and never reach the event bus.

In development, signature verification is skipped if `CH_WEBHOOK_SECRET` is unset. **In production it is mandatory** (env validator refuses to boot without it).

## WebhookEnvelope shape

```ts
interface WebhookEnvelope {
  id: string;             // server-generated UUID, used as SSE event id
  sessionId: string;       // matches credentials.sessionId
  provider: string;       // "ch" | "ppro" | "klarna" | etc.
  kind: 'payment.succeeded' | 'payment.failed' | 'payment.cancelled' | 'payment.expired';
  orderId: string;
  occurredAt: number;     // unix epoch ms
  raw?: Record<string, unknown>;  // pass-through provider payload
}
```

## Replay buffer

The in-memory event bus keeps the last 50 envelopes per `sessionId` for 5 minutes. When an SSE client reconnects, it sends `Last-Event-ID: <last-seen-uuid>` and the server replays everything that came after.

If the buffer overflows (>50 events) or expires (>5 minutes) without a reconnect, the missed events are gone. In practice this is fine: 50 events in 5 minutes is far above any normal session activity.

## Refuse-multi-instance

The in-memory bus has a critical failure mode: a webhook landing on instance B is invisible to an SSE client connected to instance A. The reference server **refuses to boot** if `INSTANCE_COUNT > 1`. To run multi-instance, implement `RedisEventBus` (interface defined in `webhooks/event-bus.ts`, implementation deferred to v2.1).

This is intentional: a silent-data-loss default is worse than a noisy refusal.

## Testing webhooks locally

The reference server's webhook handler is a plain Express route. To trigger one without a real CH callback:

```bash
# Compute the signature
PAYLOAD='{"sessionId":"sess-1","orderId":"O-abc","kind":"payment.succeeded","occurredAt":1700000000000}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$CH_WEBHOOK_SECRET" | sed 's/^.* //')

# POST it
curl -X POST http://localhost:3848/v2/webhooks/ch \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIG" \
  -d "$PAYLOAD"

# Should respond:
# { "accepted": true, "eventId": "..." }
```

Any browser connected to `GET /v2/events/sess-1` will receive the envelope on the next event-loop tick.

## Single-source-of-truth emission

Critical invariant: **terminal `CheckoutEvent`s are emitted from exactly one path** — the `AdapterStateMachine.onChange` hook in `AdapterEventEmitter`. The webhook listener does NOT emit `PAYMENT_COMPLETED` directly; it only requests a state transition. This eliminates the dual-emission bug where a sync `OrderResult.status = captured` and a webhook `payment.succeeded` both fire `PAYMENT_COMPLETED` for the same order.
