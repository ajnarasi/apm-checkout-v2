/**
 * GET /livez — process liveness (always 200 if event loop is running)
 * GET /readyz — readiness (CH circuit closed, env loaded, breaker healthy)
 *
 * Container orchestrators should hit /livez for restart decisions and
 * /readyz for traffic decisions.
 */

import type { Request, Response } from 'express';
import type { AppContext } from '../config.js';

export function buildLivez() {
  return (_req: Request, res: Response): void => {
    res.json({ status: 'live', timestamp: Date.now() });
  };
}

export function buildReadyz(ctx: AppContext) {
  return (_req: Request, res: Response): void => {
    const breakerState = ctx.chClient.getBreakerState();
    const ready =
      breakerState !== 'open' &&
      Boolean(ctx.env.chBaseUrl) &&
      Boolean(ctx.env.chApiKey);

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      breaker: breakerState,
      activeSessions: ctx.eventBus.activeSessions(),
      timestamp: Date.now(),
    });
  };
}
