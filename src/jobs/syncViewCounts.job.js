import { Article, ArticleView } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Reconciles the denormalised counters on Article with the ArticleView events
 * that are the source of truth.
 *
 * The counters are incremented at read time for speed; a failed increment, a
 * deleted event, or a restore from backup can leave them adrift. This job
 * corrects the drift rather than letting it compound.
 */
export const syncArticleViewCounts = async () => {
  try {
    const totals = await ArticleView.aggregate([
      {
        $group: {
          _id: '$article',
          views: { $sum: 1 },
          uniqueVisitors: { $addToSet: '$visitorHash' },
        },
      },
      { $project: { views: 1, uniqueViews: { $size: '$uniqueVisitors' } } },
    ]).exec();

    if (totals.length === 0) return 0;

    const operations = totals.map((entry) => ({
      updateOne: {
        filter: { _id: entry._id },
        update: { $set: { views: entry.views, uniqueViews: entry.uniqueViews } },
      },
    }));

    const result = await Article.bulkWrite(operations, { ordered: false });
    const corrected = result.modifiedCount ?? 0;

    if (corrected > 0) logger.info(`View sync: corrected counters on ${corrected} article(s)`);

    return corrected;
  } catch (error) {
    logger.error(`View count sync failed: ${error.message}`);
    return 0;
  }
};

export default syncArticleViewCounts;
