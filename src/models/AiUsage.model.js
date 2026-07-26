import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One row per user per UTC day, counting successful AI generations.
 *
 * A separate collection rather than a field on the user: the row is written on
 * every generation and read on every entitlements check, and keeping that
 * churn off the user document avoids contending with profile and subscription
 * writes. It also gives each day its own document, so a day can be inspected
 * or expired without touching the account.
 *
 * `day` is a `YYYY-MM-DD` string in UTC, not a Date. A string cannot drift
 * across timezones the way a timestamp silently can, it reads correctly in the
 * shell, and it indexes as cheaply as anything else.
 */
const aiUsageSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /** UTC calendar day, `YYYY-MM-DD`. */
    day: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'day must be a YYYY-MM-DD UTC date'],
    },

    /** Successful generations so far today. Never incremented on failure. */
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

/**
 * Unique per user per day.
 *
 * This index is what makes the quota safe under concurrency: the atomic
 * "increment only while below the limit" upsert relies on a duplicate-key
 * error to signal a full day, which only happens if this constraint exists.
 */
aiUsageSchema.index({ user: 1, day: 1 }, { unique: true });

export const AiUsage = model('AiUsage', aiUsageSchema);

export default AiUsage;
