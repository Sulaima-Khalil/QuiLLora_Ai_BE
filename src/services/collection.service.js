import { ARTICLE_STATUS, ARTICLE_VISIBILITY } from '../constants/index.js';
import { articleRepository, collectionRepository, userRepository } from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import { serializeArticles, serializeCollection } from '../utils/serializers.js';
import { stripTags } from '../helpers/sanitizeHtml.helper.js';

/**
 * Saved articles and reading lists — the backend for collectionsStore.js.
 *
 * Bookmarks live on `User.bookmarks`; named lists live in the Collection
 * collection. Both are returned together by `getState`, matching the single
 * `{ bookmarks, collections }` object the frontend store exposes.
 */

/** Throws unless the article exists and the caller may save it. */
const assertArticleVisible = async (articleId, userId) => {
  const article = await articleRepository.findById(articleId);
  if (!article) throw ApiError.notFound('Article not found');

  const isOwner = String(article.author?._id ?? article.author) === String(userId);
  const isReadable =
    article.status === ARTICLE_STATUS.PUBLISHED && article.visibility !== ARTICLE_VISIBILITY.PRIVATE;

  if (!isOwner && !isReadable) throw ApiError.notFound('Article not found');

  return article;
};

/** Full collections state — one call powers the whole Collections page. */
export const getState = async (userId) => {
  const [collections, bookmarkIds] = await Promise.all([
    collectionRepository.findAllByOwner(userId),
    userRepository.getBookmarkIds(userId),
  ]);

  return {
    bookmarks: bookmarkIds,
    collections: collections.map((collection) => serializeCollection(collection)),
  };
};

/** The caller's saved articles, hydrated. */
export const listBookmarks = async (userId) => {
  const bookmarkIds = await userRepository.getBookmarkIds(userId);
  if (bookmarkIds.length === 0) return [];

  const articles = await articleRepository.findAll(
    articleRepository.buildFilter({ ids: bookmarkIds }),
    { sort: { createdAt: -1 } },
  );

  return serializeArticles(articles, { bookmarkedIds: new Set(bookmarkIds) });
};

/**
 * Toggles a bookmark — mirrors collectionsStore.toggleBookmark.
 *
 * Un-bookmarking also drops the article from every one of the caller's
 * collections, which is what the frontend store did.
 */
export const toggleBookmark = async (userId, articleId) => {
  await assertArticleVisible(articleId, userId);

  const bookmarkIds = await userRepository.getBookmarkIds(userId);
  const isBookmarked = bookmarkIds.includes(String(articleId));

  if (isBookmarked) {
    await userRepository.removeBookmark(userId, articleId);
    await articleRepository.adjustBookmarkCount(articleId, -1);

    const collections = await collectionRepository.findAllByOwner(userId);
    await Promise.all(
      collections
        .filter((collection) => collection.articles.some((id) => String(id) === String(articleId)))
        .map((collection) => collectionRepository.removeArticle(collection._id, userId, articleId)),
    );
  } else {
    await userRepository.addBookmark(userId, articleId);
    await articleRepository.adjustBookmarkCount(articleId, 1);
  }

  return { ...(await getState(userId)), bookmarked: !isBookmarked };
};

/**
 * The caller's collections, optionally narrowed by a free-text query.
 *
 * `search` is additive: without it the endpoint behaves exactly as before, so
 * the Collections page is unaffected. Regex over name and description matches
 * how articles are searched; the input is escaped so no user text reaches the
 * engine as regex metacharacters.
 */
export const listCollections = async (userId, { search } = {}) => {
  const term = stripTags(String(search ?? '')).trim();

  const pattern =
    term.length >= 2
      ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : undefined;

  // A one-character query would match nearly everything; treat it as no query
  // rather than returning a near-complete list as if it were a result set.
  if (search !== undefined && !pattern) return [];

  const collections = await collectionRepository.findAllByOwner(userId, { search: pattern });
  return collections.map((collection) => serializeCollection(collection));
};

/** Articles inside one collection. */
export const getCollection = async (userId, collectionId) => {
  const collection = await collectionRepository.findByIdForOwner(collectionId, userId, {
    populateArticles: true,
  });

  if (!collection) throw ApiError.notFound('Collection not found');

  return serializeCollection(collection, { includeArticles: true });
};

export const createCollection = async (userId, { name, description }) => {
  const cleanName = stripTags(name);
  if (!cleanName) throw ApiError.badRequest('Collection name is required');

  const existing = await collectionRepository
    .findAllByOwner(userId)
    .then((collections) => collections.find((c) => c.name.toLowerCase() === cleanName.toLowerCase()));

  if (existing) throw ApiError.conflict('You already have a collection with that name');

  const collection = await collectionRepository.create({
    owner: userId,
    name: cleanName,
    description: stripTags(description) ?? '',
  });

  return serializeCollection(collection);
};

export const renameCollection = async (userId, collectionId, { name, description }) => {
  const update = {};

  if (name !== undefined) {
    const cleanName = stripTags(name);
    if (!cleanName) throw ApiError.badRequest('Collection name is required');
    update.name = cleanName;
  }

  if (description !== undefined) update.description = stripTags(description);

  const collection = await collectionRepository.updateForOwner(collectionId, userId, update);
  if (!collection) throw ApiError.notFound('Collection not found');

  return serializeCollection(collection);
};

export const deleteCollection = async (userId, collectionId) => {
  const collection = await collectionRepository.deleteForOwner(collectionId, userId);
  if (!collection) throw ApiError.notFound('Collection not found');

  return { message: 'Collection deleted', id: String(collectionId) };
};

/**
 * Adds an article to a collection.
 *
 * The article is also bookmarked, keeping the invariant the frontend relied
 * on: everything in a collection appears in Saved.
 */
export const addArticleToCollection = async (userId, collectionId, articleId) => {
  await assertArticleVisible(articleId, userId);

  const collection = await collectionRepository.addArticle(collectionId, userId, articleId);
  if (!collection) throw ApiError.notFound('Collection not found');

  const bookmarkIds = await userRepository.getBookmarkIds(userId);
  if (!bookmarkIds.includes(String(articleId))) {
    await userRepository.addBookmark(userId, articleId);
    await articleRepository.adjustBookmarkCount(articleId, 1);
  }

  return serializeCollection(collection);
};

export const removeArticleFromCollection = async (userId, collectionId, articleId) => {
  const collection = await collectionRepository.removeArticle(collectionId, userId, articleId);
  if (!collection) throw ApiError.notFound('Collection not found');

  return serializeCollection(collection);
};

export default {
  getState,
  listBookmarks,
  toggleBookmark,
  listCollections,
  getCollection,
  createCollection,
  renameCollection,
  deleteCollection,
  addArticleToCollection,
  removeArticleFromCollection,
};
