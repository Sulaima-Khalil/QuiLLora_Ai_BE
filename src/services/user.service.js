import { ARTICLE_STATUS, ARTICLE_VISIBILITY } from '../constants/index.js';
import {
  analyticsRepository,
  articleRepository,
  collectionRepository,
  teamRepository,
  tokenRepository,
  userRepository,
} from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import { serializeArticles, serializeUser } from '../utils/serializers.js';
import { stripTags } from '../helpers/sanitizeHtml.helper.js';
import { removeUpload } from '../middlewares/upload.middleware.js';

/** Profile and settings — the backend for profileStore.js and Setting.jsx. */

export const getProfile = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  return serializeUser(user);
};

/** Updates the caller's profile. Only allow-listed fields are writable. */
export const updateProfile = async (userId, payload, file = null) => {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  if (payload.username !== undefined && payload.username !== user.username) {
    const username = String(payload.username).trim().toLowerCase();
    if (username && (await userRepository.existsByUsername(username))) {
      throw ApiError.conflict('That username is already taken');
    }
    user.username = username || undefined;
  }

  const nameChanged = payload.name !== undefined && stripTags(payload.name) !== user.name;

  if (payload.name !== undefined) {
    const name = stripTags(payload.name);
    if (!name) throw ApiError.badRequest('Name cannot be empty');
    user.name = name;
  }

  if (payload.role !== undefined) user.role = stripTags(payload.role);
  if (payload.bio !== undefined) user.bio = stripTags(payload.bio);
  if (payload.country !== undefined) user.country = stripTags(payload.country);
  if (payload.newsletterOptIn !== undefined) user.newsletterOptIn = Boolean(payload.newsletterOptIn);

  if (file?.publicUrl) {
    const previousAvatar = user.avatar;
    user.avatar = file.publicUrl;
    await removeUpload(previousAvatar);
  } else if (payload.avatar !== undefined) {
    user.avatar = payload.avatar;
  }

  await user.save();

  // Refresh the denormalised byline so existing articles show the new name.
  if (nameChanged) {
    await articleRepository.updateAuthorName(user._id, user.name);
  }

  return serializeUser(user);
};

/** Editorial preferences from the Settings page. */
export const updateSettings = async (userId, settings) => {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  // Merge rather than replace, so a partial PATCH keeps untouched toggles.
  user.settings = { ...user.settings.toObject(), ...settings };
  await user.save();

  return serializeUser(user).settings;
};

/**
 * Public author profile: their published work plus aggregate stats.
 * Powers the Profile page and author links on article cards.
 */
export const getPublicProfile = async (identifier, viewerId = null) => {
  const user = /^[a-f\d]{24}$/i.test(identifier)
    ? await userRepository.findById(identifier)
    : await userRepository.findByUsername(identifier);

  if (!user || !user.isActive) throw ApiError.notFound('User not found');

  const isSelf = viewerId && String(viewerId) === String(user._id);

  // The owner sees everything; visitors see only published, public work.
  const filter = isSelf
    ? { author: user._id }
    : { author: user._id, status: ARTICLE_STATUS.PUBLISHED, visibility: ARTICLE_VISIBILITY.PUBLIC };

  const [articles, totals] = await Promise.all([
    articleRepository.findAll(filter, { sort: { publishedAt: -1, createdAt: -1 }, limit: 50 }),
    articleRepository.aggregateAuthorTotals(user._id),
  ]);

  const profile = serializeUser(user);

  // Never expose another user's contact details or account internals.
  if (!isSelf) {
    delete profile.email;
    delete profile.settings;
    delete profile.newsletterOptIn;
    delete profile.linkedProviders;
    delete profile.hasPassword;
  }

  return {
    profile,
    articles: serializeArticles(articles),
    stats: {
      totalArticles: isSelf ? totals.total : totals.published,
      published: totals.published,
      drafts: isSelf ? totals.drafts : undefined,
      archived: isSelf ? totals.archived : undefined,
      totalViews: totals.views,
      totalWords: totals.words,
      totalReadTime: totals.readTime,
      bookmarks: totals.bookmarks,
    },
  };
};

/**
 * People results for the global search bar.
 *
 * Returns the public author shape with every private field stripped: a search
 * result must never leak an address or account internals, and unlike
 * `getPublicProfile` there is no "is this me" case that would widen it.
 */
export const searchUsers = async (query, { page = 1, limit = 12 } = {}) => {
  const term = stripTags(String(query ?? '')).trim();

  // Below two characters a regex matches most of the table; that is a scan,
  // not a search, so the endpoint answers empty rather than working hard.
  if (term.length < 2) return { people: [], page, limit, total: 0 };

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');

  const { items, total } = await userRepository.searchActive({
    pattern,
    skip: (page - 1) * limit,
    limit,
  });

  const people = items.map((user) => {
    const profile = serializeUser(user);

    delete profile.email;
    delete profile.settings;
    delete profile.newsletterOptIn;
    delete profile.linkedProviders;
    delete profile.hasPassword;
    delete profile.isEmailVerified;
    delete profile.authProvider;
    delete profile.lastLoginAt;

    return profile;
  });

  return { people, page, limit, total };
};

/**
 * Permanently deletes the account and everything it owns.
 *
 * Ordered so nothing is orphaned if a later step fails: dependent records
 * first, the user document last.
 */
export const deleteAccount = async (userId, password) => {
  const user = await userRepository.findById(userId, { select: '+password' });
  if (!user) throw ApiError.notFound('User not found');

  // Password confirmation is required whenever the account has one.
  if (user.password) {
    if (!password) throw ApiError.badRequest('Your password is required to delete this account');
    if (!(await user.comparePassword(password))) throw ApiError.unauthorized('Incorrect password');
  }

  const articles = await articleRepository.findAll({ author: user._id });

  await Promise.all([
    ...articles.map((article) => collectionRepository.removeArticleFromAll(article._id)),
    ...articles.map((article) => userRepository.removeBookmarkForAll(article._id)),
    ...articles.map((article) => removeUpload(article.coverImage)),
  ]);

  await Promise.all([
    articleRepository.deleteAllByAuthor(user._id),
    collectionRepository.deleteAllByOwner(user._id),
    teamRepository.deleteAllByWorkspace(user._id),
    analyticsRepository.deleteAllForAuthor(user._id),
    tokenRepository.deleteAllForUser(user._id),
    removeUpload(user.avatar),
  ]);

  await userRepository.deleteById(user._id);

  return { message: 'Your account and all associated data have been deleted' };
};

export default {
  getProfile,
  updateProfile,
  updateSettings,
  getPublicProfile,
  searchUsers,
  deleteAccount,
};
