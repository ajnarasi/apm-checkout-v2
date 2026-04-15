/**
 * GET /v2/events/:sessionId
 *
 * Server-Sent Events stream that delivers webhook envelopes to the
 * browser SDK's WebhookListener.
 *
 * Last-Event-ID support: if the browser disconnects, on reconnect it
 * sends `Last-Event-ID` header; we replay all envelopes from the ring
 * buffer that came after that id before resuming live delivery.
 */

import type { Request, Response } from 'express';
import type { AppContext } from '../config.js';
import { sseConnectionsActive } from '../observability/metrics.js';
import { logger } from '../observability/logger.js';

export function buildEventsHandler(ctx: AppContext) {
  return (req: Request, res: Response): void => {
    const sessionId = req.params.sessionId;
    const lastEventId = req.header('Last-Event-ID');
    const correlationId = res.locals.correlationId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseConnectionsActive.inc();
    logger.info({ sessionId, lastEventId, correlationId }, 'sse.connected');

    // Heartbeat every 25s so proxies don't kill idle connections
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 25_000);

    // Replay buffered events first (after lastEventId, if provided)
    const replay = ctx.eventBus.replay(sessionId, lastEventId);
    for (const envelope of replay) {
      writeEvent(res, envelope.id, envelope);
    }

    // Subscribe to live events
    const unsubscribe = ctx.eventBus.subscribe(sessionId, (envelope) => {
      writeEvent(res, envelope.id, envelope);
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      sseConnectionsActive.dec();
      logger.info({ sessionId, correlationId }, 'sse.disconnected');
    });
  };
}

function writeEvent(res: Response, id: string, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
