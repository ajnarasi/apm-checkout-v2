/**
 * POST /v2/sessions
 *
 * Creates a Commerce Hub session via the Credentials API and returns
 * the access token + session id to the merchant frontend.
 *
 * This is the single endpoint the v2 industry-standard pattern requires.
 * Frontend → POST /v2/sessions → CommerceHubClient.createSession() →
 * { accessToken, sessionId, expiresAt, providerClientToken }.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AppContext } from '../config.js';
import { sessionCreateDuration } from '../observability/metrics.js';
import { logger } from '../observability/logger.js';
import { harnessSessionResponse } from '../harness/runtime.js';

interface CreateSessionBody {
  apm: string;
  amount: { value: number; currency: string };
  merchantOrderId: string;
  customer?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
}

export function buildSessionsRouter(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const correlationId = res.locals.correlationId;
    const startedAt = Date.now();

    try {
      const body = req.body as CreateSessionBody;
      if (!body?.apm || !body?.merchantOrderId || !body?.amount) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'apm, merchantOrderId, and amount are required',
          correlationId,
        });
        return;
      }

      // v2.2: harness mode — short-circuit CH and return a synthetic session.
      if (ctx.env.harnessMode) {
        const synthetic = harnessSessionResponse({
          apm: body.apm,
          currency: body.amount.currency,
          amountMinor: Math.round(body.amount.value * 100),
        });
        sessionCreateDuration.observe({ apm: body.apm, status: 'success' }, 0);
        logger.info(
          { correlationId, apm: body.apm, sessionId: synthetic.sessionId, harness: true },
          'session.created'
        );
        res.json(synthetic);
        return;
      }

      const session = await ctx.chClient.createSession({
        apm: body.apm,
        amount: { total: body.amount.value, currency: body.amount.currency },
        merchantOrderId: body.merchantOrderId,
        customer: body.customer as never,
        billingAddress: body.billingAddress as never,
        correlationId,
        // 4-second deadline — comfortably below the typical 30s gateway timeout
        deadline: Date.now() + 4000,
      });

      const durationMs = Date.now() - startedAt;
      sessionCreateDuration.observe({ apm: body.apm, status: 'success' }, durationMs);

      logger.info(
        {
          correlationId,
          apm: body.apm,
          sessionId: session.sessionId,
          durationMs,
        },
        'session.created'
      );

      res.json({
        accessToken: session.accessToken,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        providerClientToken: session.providerClientToken,
        apm: body.apm,
        currency: body.amount.currency,
        amountMinor: Math.round(body.amount.value * 100),
      });
    } catch (err) {
      sessionCreateDuration.observe(
        { apm: (req.body as CreateSessionBody)?.apm ?? 'unknown', status: 'error' },
        Date.now() - startedAt
      );
      next(err);
    }
  };
}
