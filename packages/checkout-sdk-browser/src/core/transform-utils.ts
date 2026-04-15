/**
 * Amount transform utilities — ported verbatim from v1.
 *
 * APM providers each expect amounts in different formats:
 *   - Cents integer (Klarna, Stripe)
 *   - Decimal string (PayPal)
 *   - Major unit float (some legacy APIs)
 *
 * These helpers centralize the conversion logic so adapters never
 * do arithmetic on amounts inline (and get it wrong).
 */

/** 49.99 → 4999 (integer minor units). */
export function multiply100(major: number): number {
  return Math.round(major * 100);
}

/** 4999 → 49.99. */
export function divide100(minor: number): number {
  return minor / 100;
}

/** 49.99 → "49.99". */
export function numberToString(value: number): string {
  return value.toFixed(2);
}

/** "49.99" → 49.99. */
export function stringToNumber(value: string): number {
  return parseFloat(value);
}

/** Zero-decimal currencies (JPY, KRW, etc.) use integer major units. */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

/** Smart minor conversion based on currency. */
export function toMinorUnits(amount: number, currency: string): number {
  return isZeroDecimalCurrency(currency) ? Math.round(amount) : multiply100(amount);
}

/** Smart major conversion based on currency. */
export function toMajorUnits(minor: number, currency: string): number {
  return isZeroDecimalCurrency(currency) ? minor : divide100(minor);
}

/** Format for display — respects zero-decimal currencies. */
export function formatAmount(amount: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
  }).format(amount);
}

/** Stable cache key from request params — used by the token cache. */
export function stableHash(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((k) => `${k}=${String(obj[k])}`);
  return pairs.join('&');
}

/** Clamp to 2 decimal places to avoid floating point drift. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True if the two amounts are equal after 2dp rounding. */
export function amountsEqual(a: number, b: number): boolean {
  return round2(a) === round2(b);
}

/** ISO-8601 timestamp for request metadata. */
export function nowIso(): string {
  return new Date().toISOString();
}
