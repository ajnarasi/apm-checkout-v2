/**
 * Environment validator.
 *
 * Crashes the process on startup if any required variable is missing
 * or if the configuration would be unsafe (defense-in-depth layer 1
 * of the refuse-production tripwires).
 */

export interface ServerEnv {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  chBaseUrl: string;
  chApiKey: string;
  chStaticAccessToken: string;
  chWebhookSecret: string;
  corsOrigins: string[];
  instanceCount: number;
  redisUrl?: string;
  /**
   * v2.2: when true the reference server short-circuits Commerce Hub calls
   * with deterministic scenario-driven responses. This turns the server into
   * a self-contained test bed for the `public/` test harness — no CH creds
   * required. REFUSED in production.
   *
   * When true:
   *   - POST /v2/sessions    → synthesized session, no CH call
   *   - POST /v2/orders/:apm → synthesized CH response driven by
   *                            `X-Harness-Scenario` request header
   *   - POST /v2/orders/:orderId/capture|void|refund → synthesized responses
   *   - /v2/harness/*        → exposed (catalog, capabilities, webhook-inject)
   */
  harnessMode: boolean;
}

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const errors: string[] = [];

  const nodeEnv = (env.NODE_ENV ?? 'development') as ServerEnv['nodeEnv'];
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`NODE_ENV must be development|production|test, got "${nodeEnv}"`);
  }

  const port = parseInt(env.PORT ?? '3848', 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    errors.push(`PORT must be a valid port number, got "${env.PORT}"`);
  }

  // v2.2: harness mode flag resolved FIRST so the CH_* required-field checks
  // below can relax themselves when the server is short-circuiting CH.
  const harnessMode = (env.HARNESS_MODE ?? '').toLowerCase() === 'true';

  const chBaseUrl = env.CH_BASE_URL ?? (harnessMode ? 'http://127.0.0.1:0' : '');
  if (!chBaseUrl) errors.push('CH_BASE_URL is required');

  const chApiKey = env.CH_API_KEY ?? '';
  if (!chApiKey && !harnessMode) errors.push('CH_API_KEY is required');

  const chStaticAccessToken = env.CH_STATIC_ACCESS_TOKEN ?? '';
  // v2.2: harness mode short-circuits CH, so these creds are not required.
  if (!chStaticAccessToken && !harnessMode) {
    errors.push('CH_STATIC_ACCESS_TOKEN is required (POC mode)');
  }

  const chWebhookSecret = env.CH_WEBHOOK_SECRET ?? '';
  if (!chWebhookSecret && nodeEnv === 'production') {
    errors.push('CH_WEBHOOK_SECRET is required in production');
  }

  const corsOriginsRaw = env.CORS_ORIGINS ?? '';
  const corsOrigins = corsOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (nodeEnv === 'production') {
    if (corsOrigins.length === 0) {
      errors.push('CORS_ORIGINS is required in production (no wildcards allowed)');
    }
    if (corsOrigins.includes('*')) {
      errors.push('CORS_ORIGINS may not contain "*" in production');
    }
  }

  const instanceCount = parseInt(env.INSTANCE_COUNT ?? '1', 10);
  if (Number.isNaN(instanceCount) || instanceCount < 1) {
    errors.push(`INSTANCE_COUNT must be a positive integer, got "${env.INSTANCE_COUNT}"`);
  }

  // Refuse-production tripwire (layer 1 of 4).
  // Static auth + production = hard refuse. The boot script exits with code 1.
  if (nodeEnv === 'production') {
    errors.push(
      'REFUSED PRODUCTION: this reference server runs in POC mode (static access tokens). ' +
        'It refuses to boot when NODE_ENV=production. Implement HMAC signing in ' +
        '@commercehub/node first. See docs/SECURITY.md for the upgrade path.'
    );
  }

  // v2.2: harness mode is a deliberate dev/test escape hatch — it must NEVER
  // run in production. This is tripwire layer 5.
  if (harnessMode && nodeEnv === 'production') {
    errors.push(
      'REFUSED PRODUCTION: HARNESS_MODE=true short-circuits Commerce Hub with ' +
        'synthetic responses. It must never run in production. Unset HARNESS_MODE.'
    );
  }

  // In-memory event bus refuses multi-instance (architect concern #1).
  if (instanceCount > 1) {
    errors.push(
      'REFUSED MULTI-INSTANCE: the in-memory event bus loses webhook events ' +
        'when an event lands on a different instance from the SSE client. ' +
        'Set INSTANCE_COUNT=1 or implement a Redis event bus (see redis-cache.ts stub).'
    );
  }

  if (errors.length > 0) {
    throw new EnvValidationError(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`
    );
  }

  return {
    nodeEnv,
    port,
    chBaseUrl,
    chApiKey,
    chStaticAccessToken,
    chWebhookSecret,
    corsOrigins,
    instanceCount,
    redisUrl: env.REDIS_URL,
    harnessMode,
  };
}
