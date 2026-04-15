/**
 * TenantCredentialResolver — interface for resolving CH credentials per-request.
 *
 * v2.1 ships a single-tenant default implementation (env-var-backed). The
 * interface exists so v3 multi-tenancy is NOT a rewrite — implementing a
 * `MultiTenantResolver` is a one-class addition.
 *
 * Architect Pass #2 P0 #6: "Forward endpoint must be wired to multi-tenant
 * credential resolver from review #1 — declared explicitly even though v2 is
 * single-tenant; resolver must exist as a 1-tenant default so v3 isn't a
 * rewrite."
 */

import type { StaticAuth } from './static-auth.js';

export interface TenantContext {
  /** Opaque tenant id. For single-tenant v2.1 this is always 'default'. */
  tenantId: string;
  /** Optional human-readable label for logs. */
  label?: string;
}

export interface ResolvedTenantCredentials {
  /** Tenant context echoed back for logging. */
  context: TenantContext;
  /** Auth adapter ready to inject into CommerceHubClient / CheckoutOrdersClient. */
  auth: StaticAuth;
  /** CH base URL (per-tenant — some merchants use cert vs prod). */
  baseUrl: string;
  /** Optional webhook secret for verifying inbound CH webhooks. */
  webhookSecret?: string;
}

/**
 * Resolver interface. Implementations look up tenant credentials by some
 * request signal (HTTP header, JWT claim, subdomain, etc.).
 */
export interface TenantCredentialResolver {
  /**
   * Resolve credentials for a request. Throws if the tenant cannot be
   * identified or has no credentials configured.
   *
   * @param hint Caller-supplied lookup key. For v2.1 single-tenant impls
   *             this is ignored. For v3 multi-tenant impls this is the
   *             tenantId / merchantId / API key fingerprint.
   */
  resolve(hint?: string): Promise<ResolvedTenantCredentials>;
}

export interface SingleTenantResolverConfig {
  auth: StaticAuth;
  baseUrl: string;
  webhookSecret?: string;
  label?: string;
}

/**
 * Default v2.1 implementation — always returns the same env-backed credentials
 * regardless of hint. The resolver pattern is preserved so v3 multi-tenancy is
 * a clean swap without touching call sites.
 */
export class SingleTenantResolver implements TenantCredentialResolver {
  private readonly resolved: ResolvedTenantCredentials;

  constructor(config: SingleTenantResolverConfig) {
    this.resolved = {
      context: { tenantId: 'default', label: config.label ?? 'single-tenant' },
      auth: config.auth,
      baseUrl: config.baseUrl,
      webhookSecret: config.webhookSecret,
    };
  }

  async resolve(_hint?: string): Promise<ResolvedTenantCredentials> {
    return this.resolved;
  }
}
