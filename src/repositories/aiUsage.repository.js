import { AiUsage } from '../models/index.js';

/**
 * Daily AI generation counters.
 *
 * The reservation below is the whole point of this module: checking the count
 * and then incrementing it in two steps is a race, and under two simultaneous
 * requests at 4 of 5 both would read 4 and both would write 5. A single
 * conditional update lets the database arbitrate instead.
 */

/** The current UTC calendar day as `YYYY-MM-DD`. */
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** Today's count for a user, without creating a row. */
export const countForDay = async (user, day = utcDay()) => {
  const doc = await AiUsage.findOne({ user, day }).lean().exec();
  return doc?.count ?? 0;
};

/**
 * Atomically claims one generation for today.
 *
 * With a numeric `limit`, the filter matches only while the day is below it,
 * so the increment and the check are the same operation. When the day is
 * full the filter misses, the upsert attempts an insert, and the unique
 * `{user, day}` index rejects it — that duplicate-key error *is* the answer,
 * not a failure to handle elsewhere.
 *
 * `limit: null` means unlimited: usage is still recorded, never refused.
 *
 * @returns {Promise<{allowed: boolean, count: number|null}>}
 */
export const reserve = async ({ user, day = utcDay(), limit }) => {
  const unlimited = limit === null || limit === undefined;

  const filter = unlimited ? { user, day } : { user, day, count: { $lt: limit } };

  try {
    const doc = await AiUsage.findOneAndUpdate(
      filter,
      { $inc: { count: 1 }, $setOnInsert: { user, day } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec();

    return { allowed: true, count: doc.count };
  } catch (error) {
    // 11000 here means a row already exists and did not satisfy `count < limit`.
    if (error?.code === 11000) return { allowed: false, count: null };
    throw error;
  }
};

/**
 * Hands a reserved generation back.
 *
 * Used when the work fails after the slot was claimed, so a generation that
 * never produced output does not spend the user's day. Floored at zero so a
 * double release can never drive the counter negative.
 */
export const release = async ({ user, day = utcDay() }) => {
  await AiUsage.findOneAndUpdate({ user, day, count: { $gt: 0 } }, { $inc: { count: -1 } }).exec();
};

/** Test and maintenance helper: clears a user's counters. */
export const deleteAllForUser = (user) => AiUsage.deleteMany({ user }).exec();

export default { utcDay, countForDay, reserve, release, deleteAllForUser };
