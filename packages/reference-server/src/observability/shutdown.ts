/**
 * Graceful shutdown handler.
 *
 * Listens for SIGTERM / SIGINT, stops accepting new connections,
 * drains in-flight requests for up to drainMs, then exits.
 */

import type { Server } from 'node:http';
import type { Logger } from './logger.js';

export interface ShutdownConfig {
  server: Server;
  logger: Logger;
  drainMs?: number;
  /** Hooks to run before exit (close DB, flush logs, etc.). */
  hooks?: Array<() => Promise<void> | void>;
}

export function attachShutdown({ server, logger, drainMs = 10_000, hooks = [] }: ShutdownConfig): void {
  let shuttingDown = false;

  const handle = (signal: string) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, drainMs }, 'shutdown.start');

    server.close((err) => {
      if (err) logger.error({ err }, 'shutdown.server_close_error');
      else logger.info('shutdown.server_closed');
    });

    const drainTimer = setTimeout(() => {
      logger.warn('shutdown.drain_timeout — forcing exit');
      process.exit(1);
    }, drainMs);

    try {
      for (const hook of hooks) {
        await hook();
      }
    } catch (err) {
      logger.error({ err }, 'shutdown.hook_error');
    }

    clearTimeout(drainTimer);
    logger.info('shutdown.complete');
    process.exit(0);
  };

  process.on('SIGTERM', handle('SIGTERM'));
  process.on('SIGINT', handle('SIGINT'));
}
