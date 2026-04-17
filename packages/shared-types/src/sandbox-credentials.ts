/**
 * Sandbox test credentials for APMs that the harness drives against real
 * provider sandboxes (Klarna, CashApp, PPRO). These are committed test keys
 * issued by the providers for public sandbox playgrounds — never live merchant
 * keys. They are the single source of truth consumed by:
 *   - test-harness/server.js (v1 reference server)
 *   - reference-server harness route /v2/harness/sandbox-defaults
 */

export interface KlarnaSandboxCreds {
  baseUrl: string;
  /** Basic auth credentials (username:password) — used to build the Authorization header */
  username: string;
  password: string;
  merchantId: string;
}

export interface CashAppSandboxCreds {
  baseUrl: string;
  clientId: string;
  apiKeyId: string;
  brandId: string;
  merchantId: string;
}

export interface PproSandboxCreds {
  baseUrl: string;
  token: string;
  merchantId: string;
}

export interface SandboxCredentialsMap {
  klarna: KlarnaSandboxCreds;
  cashapp: CashAppSandboxCreds;
  ppro: PproSandboxCreds;
}

export type SandboxApmId = keyof SandboxCredentialsMap;

export const SANDBOX_CREDENTIALS: Readonly<SandboxCredentialsMap> = Object.freeze({
  klarna: {
    baseUrl: 'https://api-na.playground.klarna.com',
    username: 'eb9570bf-163e-487e-b8c6-f84a188c10a1',
    password:
      'klarna_test_api_OUtELVQ_RER4Kjc3VmpzQS8oY0t0NHlEN2dKS2ZlcXQsZWI5NTcwYmYtMTYzZS00ODdlLWI4YzYtZjg0YTE4OGMxMGExLDEscVpQU08vdGlCM0ZuNHl4NVJ2czhlejN2aHY2bHhEeEtTdk1rVVVBQVZEZz0',
    merchantId: 'PN129867',
  },
  cashapp: {
    baseUrl: 'https://sandbox.api.cash.app',
    clientId: 'CAS-CI_FISERV_TEST',
    apiKeyId: 'KEY_ksbja4hqrgtahqmw6nn5gyv1b',
    brandId: 'BRAND_bbq9jbpebz4fg81pmnm9vqeac',
    merchantId: 'MMI_1nk0ecoa69ilax9gno1lz6luh',
  },
  ppro: {
    baseUrl: 'https://api.sandbox.eu.ppro.com',
    token:
      'VmsuZdokSguLzDnCCDMG0O6RPJqWxPZICHvZd6GA4UjByBG3FH3dXmqpYNosW0Sz5WBFFoZQP9E0b5Mp',
    merchantId: 'FIRSTDATATESTCONTRACT',
  },
});

export function getSandboxCreds<K extends SandboxApmId>(
  apm: K
): SandboxCredentialsMap[K] {
  return SANDBOX_CREDENTIALS[apm];
}

export function isSandboxApmId(value: string): value is SandboxApmId {
  return value === 'klarna' || value === 'cashapp' || value === 'ppro';
}

/** Build the Basic auth header value for Klarna's sandbox. */
export function buildKlarnaAuthHeader(creds: KlarnaSandboxCreds): string {
  const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  return `Basic ${token}`;
}
