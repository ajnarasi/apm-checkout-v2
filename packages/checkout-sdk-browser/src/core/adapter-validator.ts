/**
 * AdapterValidator — config shape validation at init time.
 *
 * Extracted from BaseAdapter so it's individually testable and so
 * subclasses can add pattern-specific validators without touching
 * the base class.
 */

import type { CheckoutConfig } from './types.js';

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface ValidatorRule {
  /** Human-readable rule name for error messages. */
  name: string;
  /** Returns an error message if invalid, undefined if OK. */
  validate: (config: CheckoutConfig) => string | undefined;
}

const CORE_RULES: ValidatorRule[] = [
  {
    name: 'apm-required',
    validate: (c) => (c.apm ? undefined : 'apm is required'),
  },
  {
    name: 'amount-required',
    validate: (c) =>
      c.amount && typeof c.amount.value === 'number' && c.amount.currency
        ? undefined
        : 'amount.value and amount.currency are required',
  },
  {
    name: 'amount-positive',
    validate: (c) => (c.amount?.value > 0 ? undefined : 'amount.value must be positive'),
  },
  {
    name: 'credentials-required',
    validate: (c) =>
      c.credentials && c.credentials.accessToken && c.credentials.chBaseUrl
        ? undefined
        : 'credentials.accessToken and credentials.chBaseUrl are required — call your merchant backend POST /v2/sessions first',
  },
  {
    name: 'merchantOrderId-required',
    validate: (c) => (c.merchantOrderId ? undefined : 'merchantOrderId is required'),
  },
];

export class AdapterValidator {
  private readonly rules: ValidatorRule[];

  constructor(extraRules: ValidatorRule[] = []) {
    this.rules = [...CORE_RULES, ...extraRules];
  }

  /**
   * Validate a config. Throws ConfigValidationError on the first failure.
   * Use validateAll() to collect every failure at once.
   */
  validate(config: CheckoutConfig): void {
    for (const rule of this.rules) {
      const err = rule.validate(config);
      if (err) throw new ConfigValidationError(`${rule.name}: ${err}`);
    }
  }

  /** Return every failing rule — useful for test harness UIs. */
  validateAll(config: CheckoutConfig): string[] {
    const errors: string[] = [];
    for (const rule of this.rules) {
      const err = rule.validate(config);
      if (err) errors.push(`${rule.name}: ${err}`);
    }
    return errors;
  }
}
