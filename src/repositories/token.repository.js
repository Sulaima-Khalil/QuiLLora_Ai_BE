import { RefreshToken } from '../models/index.js';

export const create = (payload) => RefreshToken.create(payload);

export const findByHash = (tokenHash) => RefreshToken.findOne({ tokenHash }).exec();

/** Marks a single token revoked, optionally recording its replacement. */
export const revokeByHash = (tokenHash, replacedByTokenHash = null) =>
  RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { revokedAt: new Date(), replacedByTokenHash },
    { new: true },
  ).exec();

/** Revokes every active session for a user (logout-everywhere, password reset). */
export const revokeAllForUser = (user) =>
  RefreshToken.updateMany({ user, revokedAt: null }, { revokedAt: new Date() }).exec();

export const countActiveForUser = (user) =>
  RefreshToken.countDocuments({ user, revokedAt: null, expiresAt: { $gt: new Date() } }).exec();

export const listActiveForUser = (user) =>
  RefreshToken.find({ user, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .exec();

/**
 * Removes tokens that are expired or were revoked more than `graceDays` ago.
 * The grace window preserves the audit trail needed for reuse detection.
 */
export const purgeStale = (graceDays = 7) => {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
  return RefreshToken.deleteMany({
    $or: [{ expiresAt: { $lt: new Date() } }, { revokedAt: { $lt: cutoff } }],
  }).exec();
};

export const deleteAllForUser = (user) => RefreshToken.deleteMany({ user }).exec();

export default {
  create,
  findByHash,
  revokeByHash,
  revokeAllForUser,
  countActiveForUser,
  listActiveForUser,
  purgeStale,
  deleteAllForUser,
};
