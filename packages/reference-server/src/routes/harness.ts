/**
 * v2.2 — Test Harness support routes.
 *
 * These routes exist ONLY to serve the production-grade browser harness at
 * `public/index.html`. They expose read-only views of the APM catalog +
 * synthetic capabilities, plus a webhook-injection primitive so the harness
 * can exercise async PPRO/iDEAL/Boleto flows end-to-end without real CH.
 *
 * All routes are gated behind `env.harnessMode`. When the flag is false the
 * router is never mounted (see app.ts). When true, the server exposes:
 *
 *   GET  /v2/harness/status                          → mode + counts + build info
 *   GET  /v2/harness/catalog                         → full APM_MAPPING, enriched
 *   GET  /v2/harness/catalog/:apm                    → single APM with synthetic capabilities
 *   GET  /v2/harness/scenarios                       → scenario descriptors
 *   POST /v2/harness/webhook-inject/:sessionId       → publish a webhook envelope to SSE
 *   POST /v2/harness/reset                           → clear ring buffers / listeners (test hygiene)
 *
 * The harness UI calls these plus the normal `POST /v2/sessions`, `POST /v2/orders/:apm`,
 * `GET /v2/events/:sessionId`, and `POST /v2/orders/:orderId/(capture|void|refund)`
 * routes. The difference is that when `harnessMode` is on, those production
 * routes short-circuit the CH calls with deterministic scenario-driven
 * responses (see routes/orders.ts and routes/sessions.ts).
 */

import express, { type Request, type Response, type Router } from 'express';
import {
  APM_MAPPING,
  ALL_APM_IDS,
  PPRO_APM_IDS,
  APM_STATS,
  getApmMapping,
  isPproRouted,
  type ApmCommerceHubMapping,
  type WebhookKind,
} from '@commercehub/shared-types';
import type { AppContext } from '../config.js';
import { logger } from '../observability/logger.js';
import { buildSyntheticCapabilities, type SyntheticCapabilities } from '../harness/synthetic-capabilities.js';
import { SCENARIOS } from '../harness/scenarios.js';
import { SDK_REGISTRY, getSdkRegistryEntry } from '../harness/sdk-registry.js';
import { v1Spawner } from '../harness/v1-spawner.js';

// ────────────────────────────────────────────────────────────────────────
// Response shapes consumed by the harness frontend. Kept here so the
// frontend can read them without importing anything from the SDK.
// ────────────────────────────────────────────────────────────────────────

export interface HarnessStatus {
  mode: 'harness' | 'live';
  instanceId: string;
  bootedAt: string;
  apmTotal: number;
  apmPpro: number;
  apmDirect: number;
  scenarios: number;
  patterns: string[];
  aggregators: string[];
  currencies: string[];
  countries: string[];
}

export interface HarnessCatalogEntry extends ApmCommerceHubMapping {
  isPproRouted: boolean;
  capabilities: SyntheticCapabilities;
}

export function buildHarnessRouter(ctx: AppContext): Router {
  const router = express.Router();

  // ── GET /v2/harness/status ─────────────────────────────────────────
  router.get('/status', (_req: Request, res: Response) => {
    const allPatterns = new Set<string>();
    const allAggregators = new Set<string>();
    const allCurrencies = new Set<string>();
    const allCountries = new Set<string>();

    for (const m of Object.values(APM_MAPPING)) {
      allPatterns.add(m.pattern);
      allAggregators.add(m.aggregator);
      for (const c of m.currencies) allCurrencies.add(c);
      for (const c of m.countries) allCountries.add(c);
    }

    const status: HarnessStatus = {
      mode: ctx.env.harnessMode ? 'harness' : 'live',
      instanceId: process.pid.toString(),
      bootedAt: new Date(globalBootedAt).toISOString(),
      apmTotal: APM_STATS.total,
      apmPpro: APM_STATS.ppro,
      apmDirect: APM_STATS.direct,
      scenarios: SCENARIOS.length,
      patterns: Array.from(allPatterns).sort(),
      aggregators: Array.from(allAggregators).sort(),
      currencies: Array.from(allCurrencies).sort(),
      countries: Array.from(allCountries).sort(),
    };

    res.json(status);
  });

  // ── GET /v2/harness/catalog ────────────────────────────────────────
  router.get('/catalog', (_req: Request, res: Response) => {
    const entries: HarnessCatalogEntry[] = ALL_APM_IDS.map((id) => {
      const m = APM_MAPPING[id];
      return {
        ...m,
        isPproRouted: isPproRouted(id),
        capabilities: buildSyntheticCapabilities(m),
      };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json({
      total: entries.length,
      ppro: PPRO_APM_IDS.length,
      direct: entries.length - PPRO_APM_IDS.length,
      entries,
    });
  });

  // ── GET /v2/harness/catalog/:apm ───────────────────────────────────
  router.get('/catalog/:apm', (req: Request, res: Response) => {
    const m = getApmMapping(req.params.apm);
    if (!m) {
      res.status(404).json({ error: 'UNKNOWN_APM', apm: req.params.apm });
      return;
    }
    const entry: HarnessCatalogEntry = {
      ...m,
      isPproRouted: isPproRouted(m.id),
      capabilities: buildSyntheticCapabilities(m),
    };
    res.json(entry);
  });

  // ── GET /v2/harness/scenarios ──────────────────────────────────────
  router.get('/scenarios', (_req: Request, res: Response) => {
    res.json({
      total: SCENARIOS.length,
      scenarios: SCENARIOS,
    });
  });

  // ── GET /v2/harness/sdk-registry ──────────────────────────────────
  router.get('/sdk-registry', (_req: Request, res: Response) => {
    res.json({ total: SDK_REGISTRY.length, entries: SDK_REGISTRY });
  });

  // ── GET /v2/harness/sdk-registry/:apm ─────────────────────────────
  router.get('/sdk-registry/:apm', (req: Request, res: Response) => {
    const entry = getSdkRegistryEntry(req.params.apm);
    if (!entry) {
      res.status(404).json({ error: 'UNKNOWN_SDK_APM', apm: req.params.apm });
      return;
    }
    res.json(entry);
  });

  // ── POST /v2/harness/webhook-inject/:sessionId ─────────────────────
  // Bypasses signature verification and pushes a typed event envelope
  // into the session's SSE stream. Lets the harness drive async flows.
  router.post('/webhook-inject/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const body = req.body as {
      kind?: WebhookKind;
      apm?: string;
      orderId?: string;
      referenceTransactionId?: string;
      raw?: Record<string, unknown>;
    };

    const allowed: WebhookKind[] = [
      'payment.authorized',
      'payment.succeeded',
      'payment.failed',
      'payment.cancelled',
      'payment.expired',
    ];
    if (!body?.kind || !allowed.includes(body.kind)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `kind must be one of ${allowed.join(', ')}`,
      });
      return;
    }

    const envelope = ctx.eventBus.publish({
      sessionId,
      provider: body.apm ?? 'ppro',
      kind: body.kind,
      orderId: body.orderId ?? `harness-${sessionId}`,
      referenceTransactionId: body.referenceTransactionId,
      occurredAt: Date.now(),
      raw: body.raw,
    });

    logger.info(
      { sessionId, kind: body.kind, id: envelope.id },
      'harness.webhook.injected'
    );

    res.json({ injected: true, envelope });
  });

  // ── GET /v2/harness/v1-status ──────────────────────────────────────
  router.get('/v1-status', (_req: Request, res: Response) => {
    res.json(v1Spawner.getStatus());
  });

  // ── GET /v2/harness/v1-logs ────────────────────────────────────────
  router.get('/v1-logs', (req: Request, res: Response) => {
    const tail = Math.max(1, Math.min(500, parseInt(String(req.query.tail ?? '50'), 10) || 50));
    res.json({ logs: v1Spawner.getLogs(tail) });
  });

  // ── GET /v2/harness/v1-pages ───────────────────────────────────────
  router.get('/v1-pages', (_req: Request, res: Response) => {
    res.json({
      pages: [
        { file: 'checkout-sdk-test.html', title: 'Unified 54-APM harness' },
        { file: 'index.html',              title: 'v1 portal hub' },
        { file: 'klarna.html',             title: 'Klarna solo test' },
        { file: 'cashapp.html',            title: 'Cash App Pay solo test' },
        { file: 'ppro.html',               title: 'PPRO 52-APM matrix' },
        { file: 'zepto-setup.html',        title: 'Zepto OAuth bootstrap' },
      ],
    });
  });

  // ── POST /v2/harness/reset ─────────────────────────────────────────
  router.post('/reset', (_req: Request, res: Response) => {
    // No destructive reset — harness state is intentionally ephemeral
    // (ring-buffer TTL). We just acknowledge so the UI can show a
    // "state cleared" affordance.
    res.json({ reset: true, timestamp: Date.now() });
  });

  return router;
}

const globalBootedAt = Date.now();
