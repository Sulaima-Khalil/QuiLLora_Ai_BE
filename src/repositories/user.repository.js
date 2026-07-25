import { User } from '../models/index.js';

/**
 * Data access for users.
 *
 * Services depend on this module rather than on Mongoose directly, which keeps
 * query construction in one place and the services free of driver specifics.
 */

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export const findById = (id, { select } = {}) => {
  const query = User.findById(id);
  if (select) query.select(select);
  return query.exec();
};

export const findByEmail = (email, { select } = {}) => {
  const query = User.findOne({ email: normalizeEmail(email) });
  if (select) query.select(select);
  return query.exec();
};

export const findByUsername = (username) =>
  User.findOne({ username: String(username ?? '').trim().toLowerCase() }).exec();

/** Loads the password hash, which is `select: false` by default. */
export const findByEmailWithPassword = (email) =>
  User.findOne({ email: normalizeEmail(email) }).select('+password +passwordChangedAt').exec();

export const existsByEmail = async (email) =>
  Boolean(await User.exists({ email: normalizeEmail(email) }));

export const existsByUsername = async (username) =>
  Boolean(await User.exists({ username: String(username ?? '').trim().toLowerCase() }));

export const create = (payload) => User.create(payload);

/** Loads the reset-code fields, which are `select: false` by default. */
export const findByEmailWithResetCode = (email) =>
  User.findOne({ email: normalizeEmail(email) })
    .select('+passwordResetCode +passwordResetCodeAttempts +passwordResetExpires +passwordResetToken +password +passwordChangedAt')
    .exec();

/** Looks a user up by a hashed, unexpired single-use token. */
export const findByActiveToken = (tokenField, expiresField, tokenHash) =>
  User.findOne({ [tokenField]: tokenHash, [expiresField]: { $gt: new Date() } })
    .select(`+${tokenField} +${expiresField} +password +passwordChangedAt +passwordResetCode +passwordResetCodeAttempts`)
    .exec();

/** Finds a user by a linked OAuth identity. */
export const findByOAuthAccount = (provider, providerAccountId) =>
  User.findOne({
    oauthAccounts: { $elemMatch: { provider, providerAccountId: String(providerAccountId) } },
  }).exec();

export const updateById = (id, update, options = {}) =>
  User.findByIdAndUpdate(id, update, { new: true, runValidators: true, ...options }).exec();

/** Adds an article to the user's saved list. Idempotent via `$addToSet`. */
export const addBookmark = (userId, articleId) =>
  User.findByIdAndUpdate(userId, { $addToSet: { bookmarks: articleId } }, { new: true }).exec();

export const removeBookmark = (userId, articleId) =>
  User.findByIdAndUpdate(userId, { $pull: { bookmarks: articleId } }, { new: true }).exec();

/** Drops a deleted article from every user's saved list. */
export const removeBookmarkForAll = (articleId) =>
  User.updateMany({ bookmarks: articleId }, { $pull: { bookmarks: articleId } }).exec();

export const getBookmarkIds = async (userId) => {
  const user = await User.findById(userId).select('bookmarks').lean().exec();
  return (user?.bookmarks ?? []).map((id) => String(id));
};

export const deleteById = (id) => User.findByIdAndDelete(id).exec();

export default {
  findById,
  findByEmail,
  findByUsername,
  findByEmailWithPassword,
  findByEmailWithResetCode,
  existsByEmail,
  existsByUsername,
  create,
  findByActiveToken,
  findByOAuthAccount,
  updateById,
  addBookmark,
  removeBookmark,
  removeBookmarkForAll,
  getBookmarkIds,
  deleteById,
};
