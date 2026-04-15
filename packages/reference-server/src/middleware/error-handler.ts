/**
 * Centralized error handler.
 *
 * Maps CommerceHubError subclasses to HTTP responses, redacts internals,
 * and ensures we NEVER leak stack traces or secrets to clients.
 */

import type { ErrorRequestHandler } from 'express';
import { CommerceHubError } from '@commercehub/node';
import { logger } from '../observability/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const correlationId = res.locals.correlationId;
  const requestId = res.locals.requestId;

  if (err instanceof CommerceHubError) {
    const status = err.status ?? mapCodeToStatus(err.code);
    logger.warn(
      {
        err: err.toJSON(),
        correlationId,
        requestId,
        path: req.path,
      },
      'request.commerce_hub_error'
    );
    res.status(status).json({
      error: err.code,
      message: err.message,
      apiTraceId: err.apiTraceId,
      requestId,
      correlationId,
    });
    return;
  }

  // Unknown / unexpected error
  logger.error(
    {
      err: { name: err?.name, message: err?.message },
      correlationId,
      requestId,
      path: req.path,
    },
    'request.unhandled_error'
  );
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
    requestId,
    correlationId,
  });
};

function mapCodeToStatus(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'AUTH_FAILED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'TOO_EARLY':
      return 425;
    case 'RATE_LIMITED':
      return 429;
    case 'CIRCUIT_OPEN':
    case 'SERVER_ERROR':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'DEADLINE_EXCEEDED':
      return 503;
    default:
      return 500;
  }
}
