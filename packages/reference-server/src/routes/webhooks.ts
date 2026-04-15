/**
 * POST /v2/webhooks/:provider
 *
 * Receives webhook events from Commerce Hub (and APM providers behind it),
 * verifies the signature, normalizes to a WebhookEnvelope, and publishes
 * to the in-memory event bus. Connected SSE clients receive the event
 * via the events.ts route.
 *
 * Signature verification uses HMAC-SHA256 with CH_WEBHOOK_SECRET.
 */

import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEnvelope } from '@commercehub/shared-types';
import type { AppContext } from '../config.js';
import { logger } from '../observability/logger.js';
import { webhookReceivedTotal } from '../observability/metrics.js';

interface IncomingWebhookBody {
  sessionId: string;
  orderId: string;
  kind?: WebhookEnvelope['kind'];
  occurredAt?: number;
  raw?: Record<string, unknown>;
}

export function buildWebhookHandler(ctx: AppContext) {
  return async (req: Request, res: Response): Promise<void> => {
    const provider = req.params.provider;
    const signature = req.header('X-Webhook-Signature') ?? '';
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (ctx.env.nodeEnv === 'production' || ctx.env.chWebhookSecret) {
      if (!verifySignature(rawBody, signature, ctx.env.chWebhookSecret)) {
        logger.warn({ provider }, 'webhook.signature_invalid');
        res.status(401).json({ error: 'invalid_signature' });
        return;
      }
    }

    const body = req.body as IncomingWebhookBody;
    if (!body?.sessionId || !body?.orderId) {
      res.status(400).json({ error: 'sessionId and orderId are required' });
      return;
    }

    const envelope = ctx.eventBus.publish({
      sessionId: body.sessionId,
      provider,
      kind: body.kind ?? 'payment.succeeded',
      orderId: body.orderId,
      occurredAt: body.occurredAt ?? Date.now(),
      raw: body.raw,
    });

    webhookReceivedTotal.inc({ provider, kind: envelope.kind });

    logger.info(
      { provider, sessionId: envelope.sessionId, kind: envelope.kind, eventId: envelope.id },
      'webhook.received'
    );

    res.status(202).json({ accepted: true, eventId: envelope.id });
  };
}

function verifySignature(rawBody: Buffer | undefined, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signature.replace(/^sha256=/, '');
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}
