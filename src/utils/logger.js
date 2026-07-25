import config from '../config/env.js';

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const threshold = LEVEL_WEIGHT[config.logLevel] ?? LEVEL_WEIGHT.info;

const shouldLog = (level) => LEVEL_WEIGHT[level] >= threshold;

const format = (level, message) => {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
};

/**
 * Minimal level-aware logger.
 *
 * Deliberately dependency-free: structured log shipping belongs to the
 * platform (Docker/PM2/CloudWatch), which consumes stdout and stderr.
 */
export const logger = {
  debug(message, ...rest) {
    if (shouldLog('debug')) console.debug(format('debug', message), ...rest);
  },
  info(message, ...rest) {
    if (shouldLog('info')) console.info(format('info', message), ...rest);
  },
  warn(message, ...rest) {
    if (shouldLog('warn')) console.warn(format('warn', message), ...rest);
  },
  error(message, ...rest) {
    if (shouldLog('error')) console.error(format('error', message), ...rest);
  },
};

export default logger;
