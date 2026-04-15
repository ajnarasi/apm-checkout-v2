/**
 * CORS middleware backed by an explicit allowlist.
 *
 * No wildcard support. Production refuses to boot if the allowlist is
 * empty (see env.ts).
 */

import cors from 'cors';
import type { CorsOptions } from 'cors';

export function corsMiddleware(allowedOrigins: string[]) {
  const set = new Set(allowedOrigins);
  const options: CorsOptions = {
    origin: (origin, callback) => {
      // Allow same-origin / non-browser callers
      if (!origin) return callback(null, true);
      if (set.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'Last-Event-ID'],
    exposedHeaders: ['X-Correlation-Id', 'X-Request-Id'],
    maxAge: 86400,
  };
  return cors(options);
}
