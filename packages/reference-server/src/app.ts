/**
 * Express app builder. Pure function — no side effects on import.
 * Exported separately from index.ts so tests can spin up the app
 * without binding to a port.
 */

import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correlationMiddleware } from './middleware/correlation.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import {
  sessionsRateLimit,
  ordersRateLimit,
  webhookRateLimit,
} from './middleware/rate-limit.js';
import { buildSessionsRouter } from './routes/sessions.js';
import {
  buildAuthorizeOrder,
  buildGetOrder,
  buildCaptureOrder,
  buildVoidOrder,
  buildRefundOrder,
} from './routes/orders.js';
import { buildApplePayMerchantValidation } from './routes/applepay-merchant-validation.js';
import { buildWebhookHandler } from './routes/webhooks.js';
import { buildEventsHandler } from './routes/events.js';
import { buildLivez, buildReadyz } from './routes/health.js';
import { buildHarnessRouter } from './routes/harness.js';
import { createV1StaticHandler, createV1ApiProxy } from './routes/v1-proxy.js';
import { v1Spawner } from './harness/v1-spawner.js';
import { registry } from './observability/metrics.js';
import type { AppContext } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function buildApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware);
  app.use(corsMiddleware(ctx.env.corsOrigins));

  // Webhooks need raw body for signature verification
  app.use(
    '/v2/webhooks',
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  app.use(express.json({ limit: '256kb' }));

  // Health endpoints — never rate-limited
  app.get('/livez', buildLivez());
  app.get('/readyz', buildReadyz(ctx));

  // Metrics endpoint
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  // Session creation
  app.post('/v2/sessions', sessionsRateLimit, buildSessionsRouter(ctx));

  // v2.1: Orders proxy — REAL CH /checkouts/v1/orders forwarding via CheckoutOrdersClient.
  // All five routes share the same backend client; operation discrimination
  // (authorize vs sale vs capture vs void vs refund) happens in the client layer.
  app.post('/v2/orders/:apm', ordersRateLimit, buildAuthorizeOrder(ctx));
  app.post('/v2/orders/:orderId/capture', ordersRateLimit, buildCaptureOrder(ctx));
  app.post('/v2/orders/:orderId/void', ordersRateLimit, buildVoidOrder(ctx));
  app.post('/v2/orders/:orderId/refund', ordersRateLimit, buildRefundOrder(ctx));
  app.get('/v2/orders/:orderId', ordersRateLimit, buildGetOrder(ctx));

  // v2.1: Apple Pay merchant validation handoff.
  // Stub implementation — production must replace with real Apple cert signing.
  app.post(
    '/v2/applepay/merchant-validation',
    ordersRateLimit,
    buildApplePayMerchantValidation()
  );

  // Webhooks (server → server)
  app.post('/v2/webhooks/:provider', webhookRateLimit, buildWebhookHandler(ctx));

  // SSE event stream (server → browser)
  app.get('/v2/events/:sessionId', buildEventsHandler(ctx));

  // v2.2: Test harness support routes + static UI.
  // Gated entirely on env.harnessMode so production never serves them.
  if (ctx.env.harnessMode) {
    app.use('/v2/harness', buildHarnessRouter(ctx));
    app.use(
      '/harness',
      express.static(PUBLIC_DIR, {
        index: 'index.html',
        extensions: ['html'],
        maxAge: 0,
      })
    );

    // v2.2 iteration 3b: V1 Legacy mode — embed v1's pages inside the
    // v2.2 harness via same-origin static + reverse-proxy.
    //   /v1/*      → static serve from test-harness/public/ with HTML rewrite
    //   /v1-api/*  → reverse proxy to http://localhost:3847/api/*
    // The v1 server is auto-spawned as a child process if not already running.
    app.use('/v1-api', createV1ApiProxy());
    app.use('/v1', createV1StaticHandler());

    // Kick off the v1 spawner asynchronously. Doesn't block boot — V1 mode
    // will report "starting"/"running"/"failed" via /v2/harness/v1-status.
    void v1Spawner.ensureRunning();

    // Convenience redirect so `/` lands on the harness when in harness mode
    app.get('/', (_req, res) => res.redirect(302, '/harness/'));
  }

  app.use(errorHandler);

  return app;
}
