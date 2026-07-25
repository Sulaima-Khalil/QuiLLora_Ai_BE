import cron from 'node-cron';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { cleanupExpiredTokens } from '../jobs/cleanupTokens.job.js';
import { cleanupOrphanedUploads } from '../jobs/cleanupUploads.job.js';
import { syncArticleViewCounts } from '../jobs/syncViewCounts.job.js';

/**
 * Scheduled maintenance.
 *
 * All jobs are idempotent, so running several instances (or replaying a
 * missed window) cannot corrupt data. Every schedule is pinned to UTC to
 * avoid a daylight-saving shift silently moving or skipping a run.
 */
const SCHEDULES = [
  {
    name: 'cleanup-expired-tokens',
    // Hourly, on the hour.
    expression: '0 * * * *',
    handler: cleanupExpiredTokens,
  },
  {
    name: 'sync-view-counts',
    // Every six hours — frequent enough to catch drift, cheap enough to ignore.
    expression: '15 */6 * * *',
    handler: syncArticleViewCounts,
  },
  {
    name: 'cleanup-orphaned-uploads',
    // Daily at 03:30 UTC, off the usual traffic peak.
    expression: '30 3 * * *',
    handler: cleanupOrphanedUploads,
  },
];

const tasks = [];

/** Registers every schedule. No-op when cron is disabled or under test. */
export const startCronJobs = () => {
  if (!config.jobs.enabled) {
    logger.info('Cron jobs are disabled (ENABLE_CRON=false or NODE_ENV=test)');
    return [];
  }

  SCHEDULES.forEach(({ name, expression, handler }) => {
    const task = cron.schedule(
      expression,
      async () => {
        logger.debug(`Cron '${name}' started`);
        try {
          await handler();
        } catch (error) {
          // A throwing handler must not take down the scheduler.
          logger.error(`Cron '${name}' failed: ${error.message}`);
        }
      },
      { timezone: 'UTC' },
    );

    tasks.push({ name, task });
  });

  logger.info(`Scheduled ${tasks.length} cron job(s): ${tasks.map((entry) => entry.name).join(', ')}`);

  return tasks;
};

/** Stops every scheduled task — used by graceful shutdown. */
export const stopCronJobs = () => {
  tasks.forEach(({ task }) => task.stop());
  tasks.length = 0;
};

export default startCronJobs;
