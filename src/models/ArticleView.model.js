import mongoose from 'mongoose';
import { TRAFFIC_SOURCE, TRAFFIC_SOURCES } from '../constants/index.js';

const { Schema, model } = mongoose;

/**
 * One row per article read.
 *
 * Event rows (rather than a bare counter on Article) are what make the
 * Analytics page's real features possible: the 7-day bar chart, the traffic
 * source breakdown, and unique-reader counts. `Article.views` remains as a
 * denormalised total so list endpoints never need an aggregation.
 */
const articleViewSchema = new Schema(
  {
    article: {
      type: Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
      index: true,
    },

    /** The article's author — lets analytics filter without a join. */
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Null for anonymous readers. */
    viewer: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Hash of viewer id (or IP + user agent) — identifies unique readers
     * without storing personally identifiable information.
     */
    visitorHash: { type: String, required: true },

    source: { type: String, enum: TRAFFIC_SOURCES, default: TRAFFIC_SOURCE.DIRECT },

    referrer: { type: String, default: '' },

    /** `YYYY-MM-DD` (UTC). Pre-computed so daily grouping needs no $dateToString. */
    day: { type: String, required: true, index: true },

    /** Seconds spent reading, when the client reports it. */
    durationSeconds: { type: Number, default: 0, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The analytics dashboard's core query: this author's views over a date range.
articleViewSchema.index({ author: 1, createdAt: -1 });
articleViewSchema.index({ author: 1, day: 1 });

// Deduplicates repeated reads: one unique view per visitor per article per day.
articleViewSchema.index({ article: 1, visitorHash: 1, day: 1 }, { unique: true });

export const ArticleView = model('ArticleView', articleViewSchema);

export default ArticleView;
