import { tokenRepository } from '../repositories/index.js';
import logger from '../utils/logger.js';

/**
 * Removes refresh tokens that are expired, or were revoked long enough ago
 * that they are no longer useful for reuse detection.
 *
 * MongoDB's TTL index already reaps expired documents; this sweep also clears
 * revoked-but-unexpired rows, which the TTL index cannot express.
 */
export const cleanupExpiredTokens = async () => {
  try {
    const result = await tokenRepository.purgeStale(7);

    if (result.deletedCount > 0) {
      logger.info(`Token cleanup: removed ${result.deletedCount} stale refresh token(s)`);
    }

    return result.deletedCount;
  } catch (error) {
    logger.error(`Token cleanup failed: ${error.message}`);
    return 0;
  }
};

export default cleanupExpiredTokens;
