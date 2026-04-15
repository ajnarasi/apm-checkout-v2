/**
 * Reference server entrypoint.
 *
 * Validates env (refuse-production guard layer 1), boots the Express
 * app, attaches graceful shutdown handlers, and starts listening.
 */

import { loadEnv, EnvValidationError } from './env.js';
import { buildAppContext } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';
import { attachShutdown } from './observability/shutdown.js';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // eslint-disable-next-line no-console
      console.error(`\n[FATAL] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const ctx = buildAppContext(env);
  const app = buildApp(ctx);

  const server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        nodeEnv: env.nodeEnv,
        chBaseUrl: env.chBaseUrl,
        corsOrigins: env.corsOrigins,
        instanceCount: env.instanceCount,
      },
      'reference-server.listening'
    );
    logger.warn(
      'POC MODE: this server uses static-token Commerce Hub authentication. ' +
        'It will refuse to boot when NODE_ENV=production. See docs/SECURITY.md.'
    );
  });

  attachShutdown({ server, logger });
}

main().catch((err) => {
  logger.error({ err }, 'reference-server.fatal');
  process.exit(1);
});
