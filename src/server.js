import fs from 'node:fs';
import app from './app.js';
import config from './config/env.js';
import { connectDatabase, disconnectDatabase, syncIndexes } from './database/connect.js';
import { startCronJobs, stopCronJobs } from './cron/index.js';
import { closeTransporter, verifyTransporter } from './emails/transporter.js';
import logger from './utils/logger.js';

let server;
let shuttingDown = false;

/**
 * Closes everything in dependency order, then exits.
 *
 * The HTTP server stops first so in-flight requests finish before their
 * database connection disappears. A hard timeout guarantees the process
 * exits even if a socket refuses to close.
 */
const shutdown = async (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received — shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    stopCronJobs();
    closeTransporter();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('HTTP server closed');
    }

    await disconnectDatabase();
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    clearTimeout(forceExit);
    process.exit(1);
  }

  clearTimeout(forceExit);
  process.exit(exitCode);
};

const start = async () => {
  try {
    fs.mkdirSync(config.uploads.dir, { recursive: true });

    await connectDatabase();
    await syncIndexes();

    // Non-blocking: a mail outage should not prevent the API from serving.
    verifyTransporter();

    startCronJobs();

    server = app.listen(config.port, () => {
      logger.info(`InkFlow AI API listening on http://localhost:${config.port} [${config.env}]`);
      logger.info(`API base: http://localhost:${config.port}${config.apiPrefix}`);
      logger.info(`Allowed origins: ${config.client.corsOrigins.join(', ')}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use`);
      } else {
        logger.error(`Server error: ${error.message}`);
      }
      process.exit(1);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
};

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

// An unhandled rejection or uncaught exception leaves the process in an
// unknown state; restart rather than continue serving from it.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown('uncaughtException', 1);
});

start();

export default server;
