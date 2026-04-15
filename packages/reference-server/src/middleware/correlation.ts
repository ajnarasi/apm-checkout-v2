/**
 * Correlation ID middleware.
 *
 * Reads `X-Correlation-Id` from the incoming request, generates one if
 * absent, and stores it on `res.locals.correlationId` for downstream
 * handlers and the logger.
 *
 * The same id flows out to Commerce Hub via the CommerceHubClient,
 * back into webhooks via the merchant order id mapping, and out to
 * the browser SDK via the SSE event metadata.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      correlationId: string;
      requestId: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('X-Correlation-Id');
  const correlationId = incoming ?? randomUUID();
  res.locals.correlationId = correlationId;
  res.locals.requestId = randomUUID();
  res.setHeader('X-Correlation-Id', correlationId);
  res.setHeader('X-Request-Id', res.locals.requestId);
  next();
}
