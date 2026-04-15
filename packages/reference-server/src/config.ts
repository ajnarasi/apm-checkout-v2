/**
 * Server-wide singletons.
 *
 * Constructed once at boot, injected into route handlers via app.locals.
 */

import {
  CommerceHubClient,
  CheckoutOrdersClient,
  CircuitBreaker,
  StaticAuth,
  SingleTenantResolver,
  type TenantCredentialResolver,
} from '@commercehub/node';
import type { ServerEnv } from './env.js';
import { InMemoryEventBus } from './webhooks/event-bus.js';
import { logger } from './observability/logger.js';
import { setBreakerStateMetric } from './observability/metrics.js';

export interface AppContext {
  env: ServerEnv;
  /** Credentials API client — used by POST /v2/sessions to mint access tokens. */
  chClient: CommerceHubClient;
  /** Orders API client — used by POST /v2/orders/* to settle payments. */
  ordersClient: CheckoutOrdersClient;
  /** Tenant credential resolver — single-tenant default for v2.1, multi-tenant in v3. */
  tenantResolver: TenantCredentialResolver;
  breaker: CircuitBreaker;
  eventBus: InMemoryEventBus;
}

export function buildAppContext(env: ServerEnv): AppContext {
  // v2.2: harness mode short-circuits CH at the route layer, so the CH
  // clients are never actually called. We still need to construct something
  // that satisfies the AppContext shape — use dummy placeholder credentials
  // so StaticAuth's "required field" validation passes.
  const auth = new StaticAuth({
    apiKey: env.harnessMode ? (env.chApiKey || 'harness-fake-api-key') : env.chApiKey,
    staticAccessToken: env.harnessMode
      ? (env.chStaticAccessToken || 'harness-fake-static-token')
      : env.chStaticAccessToken,
  });

  // Architect Pass #2 P0 #6: tenant resolver is REQUIRED to exist as an
  // interface, even when v2.1 only has one tenant. v3 swaps in MultiTenantResolver
  // without touching call sites.
  const tenantResolver = new SingleTenantResolver({
    auth,
    baseUrl: env.chBaseUrl,
    webhookSecret: env.chWebhookSecret,
    label: 'v2.1-default',
  });

  const breaker = new CircuitBreaker();

  const loggerAdapter = {
    info: (obj: Record<string, unknown>, msg?: string) => logger.info(obj, msg),
    warn: (obj: Record<string, unknown>, msg?: string) => logger.warn(obj, msg),
    error: (obj: Record<string, unknown>, msg?: string) => logger.error(obj, msg),
  };

  // Credentials API client — POST /payments-vas/v1/security/credentials
  const chClient = new CommerceHubClient({
    baseUrl: env.chBaseUrl,
    auth,
    breaker,
    logger: loggerAdapter,
    __allowInsecureUrlForTests: env.nodeEnv !== 'production',
  });

  // v2.1: Checkout Orders API client — POST /checkouts/v1/orders
  // Used by all /v2/orders/* routes for actual payment settlement.
  const ordersClient = new CheckoutOrdersClient({
    baseUrl: env.chBaseUrl,
    auth,
    breaker, // Share the breaker — both endpoints fail together
    logger: loggerAdapter,
    __allowInsecureUrlForTests: env.nodeEnv !== 'production',
  });

  // Reflect breaker state into Prometheus on a 1s tick.
  setInterval(() => {
    setBreakerStateMetric(chClient.getBreakerState());
  }, 1000).unref();

  const eventBus = new InMemoryEventBus();

  return { env, chClient, ordersClient, tenantResolver, breaker, eventBus };
}
