/**
 * Pino logger with PII redaction allowlist.
 *
 * Use ONLY this logger for structured logging. The redact paths below
 * cover every field that could contain customer PII or secrets.
 *
 * The companion ESLint rule (see ESLINT.md) forbids `logger.*(req.body)`.
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["api-key"]',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      // Body fields that must never be logged
      '*.customer',
      '*.billingAddress',
      '*.shippingAddress',
      '*.source',
      '*.encryptionData',
      '*.paymentTokens',
      '*.dataCapture',
      '*.password',
      '*.cardNumber',
      '*.pan',
      '*.cvv',
      '*.accessToken',
      '*.refreshToken',
      '*.staticAccessToken',
      '*.apiSecret',
    ],
    censor: '[REDACTED]',
    remove: false,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
