/**
 * Rate limiting middleware.
 *
 * In-memory by default. For multi-instance production, swap for the
 * Redis store via `rate-limit-redis` — documented in OBSERVABILITY.md
 * but out of scope for the POC.
 */

import rateLimit from 'express-rate-limit';

export const sessionsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60, // 60 sessions / minute / IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_session_requests' },
});

export const ordersRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_order_requests' },
});

export const webhookRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 600, // generous — providers can burst
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_webhook_requests' },
});
