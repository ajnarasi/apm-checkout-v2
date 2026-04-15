/**
 * PII redaction helpers.
 *
 * Every log statement in this package and the reference server MUST pass
 * user-supplied data through redact() first. An ESLint rule in the
 * reference server forbids `logger.*(req.body)` entirely — use
 * `logger.info({ redacted: redact(req.body) }, 'message')`.
 *
 * The allowlist is deliberately small. When in doubt, REDACT.
 */

const REDACTED = '[REDACTED]';

/** Top-level keys whose entire subtree is replaced with [REDACTED]. */
const SENSITIVE_KEYS = new Set([
  // ── v2.0 list ──
  'source',
  'paymentSource', // CH Orders spec uses this exact key
  'billingAddress',
  'shippingAddress',
  'customerAddress',
  'customer',
  'encryptionData',
  'paymentTokens',
  'dataCapture',
  'dataStatic',
  'dataDynamic',
  'Authorization',
  'authorization',
  'Api-Key',
  'api-key',
  'apiKey',
  'Api-Secret',
  'api-secret',
  'apiSecret',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'password',
  'pin',
  'cvv',
  'cardNumber',
  'pan',
  // ── v2.1 additions (architect Pass #2 P1: token leakage paths) ──
  'token',
  'tokenData',
  'authorization_token', // Klarna
  'paymentData', // Apple Pay payment.token.paymentData
  'tokenizationData', // Google Pay
  'payerID', // PayPal onApprove
  'cryptogram',
  'staticAccessToken',
  'CH_STATIC_ACCESS_TOKEN',
  'CH_API_KEY',
  'CH_API_SECRET',
  'CH_WEBHOOK_SECRET',
]);

/** String field suffixes that trigger masking (partial redaction). */
const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

/**
 * Recursively redact PII from any JSON-ish value.
 * Returns a NEW object — does not mutate input.
 *
 * @example
 *   redact({ customer: { email: 'a@b.com' }, amount: 100 })
 *   // { customer: '[REDACTED]', amount: 100 }
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED; // safety against cycles
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Emails in free-form strings get masked
    if (EMAIL_RE.test(value)) return maskEmail(value);
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Mask email addresses: `user@example.com` → `u***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return REDACTED;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/**
 * Redact known sensitive HTTP headers.
 * Used when logging outbound request metadata.
 */
export function redactHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue;
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'api-key' ||
      lower === 'api-secret' ||
      lower === 'x-api-key'
    ) {
      out[key] = REDACTED;
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** The constant used for all redacted values. Exposed for tests. */
export const REDACTED_VALUE = REDACTED;
