import {
  ARTICLE_STATUS,
  ARTICLE_VISIBILITY,
  DEFAULT_CATEGORY,
} from '../constants/index.js';
import {
  articleRepository,
  collectionRepository,
  analyticsRepository,
  userRepository,
} from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import { resolvePagination, resolveSort } from '../utils/pagination.js';
import { serializeArticle, serializeArticles } from '../utils/serializers.js';
import { uniqueSlug } from '../utils/slugify.js';
import { buildExcerpt } from '../utils/readTime.js';
import { sanitizeArticleHtml, stripTags } from '../helpers/sanitizeHtml.helper.js';
import { removeUpload } from '../middlewares/upload.middleware.js';

/** Throws unless the article exists and belongs to the caller. */
const loadOwnedArticle = async (articleId, userId, { withNotes = false } = {}) => {
  const article = await articleRepository.findById(articleId, { withNotes });
  if (!article) throw ApiError.notFound('Article not found');

  const authorId = String(article.author?._id ?? article.author);
  if (authorId !== String(userId)) {
    throw ApiError.forbidden('You can only modify your own articles');
  }

  return article;
};

/** Normalises author-supplied text fields. */
const cleanTags = (tags) =>
  [...new Set((tags ?? []).map((tag) => stripTags(tag)).filter(Boolean))].slice(0, 20);

/**
 * Lists the caller's own articles (Dashboard, My Articles, Archive).
 * Drafts and private articles are included — this is the author's own view.
 */
export const listMyArticles = async (userId, query = {}) => {
  const { page, limit, skip } = resolvePagination(query);
  const sort = resolveSort(query.sort, articleRepository.SORTABLE_FIELDS);

  const filter = articleRepository.buildFilter({
    author: userId,
    status: query.status,
    category: query.category,
    tag: query.tag,
    search: query.search,
    excludeStatus: query.includeArchived === false ? [ARTICLE_STATUS.ARCHIVED] : undefined,
  });

  const { items, total } = await articleRepository.paginate({ filter, sort, skip, limit });

  return { articles: serializeArticles(items), page, limit, total };
};

/**
 * Public feed for the Discover page: published, public articles only.
 * When a reader is signed in, each item is flagged with `isBookmarked`.
 */
export const listPublicArticles = async (query = {}, viewerId = null) => {
  const { page, limit, skip } = resolvePagination(query);
  const sort = resolveSort(query.sort, articleRepository.SORTABLE_FIELDS, { publishedAt: -1 });

  const filter = articleRepository.buildFilter({
    publicOnly: true,
    category: query.category,
    tag: query.tag,
    search: query.search,
    author: query.author,
  });

  const [{ items, total }, bookmarkIds] = await Promise.all([
    articleRepository.paginate({ filter, sort, skip, limit }),
    viewerId ? userRepository.getBookmarkIds(viewerId) : Promise.resolve([]),
  ]);

  return {
    articles: serializeArticles(items, { bookmarkedIds: new Set(bookmarkIds) }),
    page,
    limit,
    total,
  };
};

/**
 * Reads a single article, enforcing visibility.
 *
 * Private and draft articles are readable only by their author; unlisted ones
 * are readable by anyone holding the link, which is the point of "unlisted".
 */
export const getArticle = async (articleId, viewerId = null) => {
  const article = await articleRepository.findById(articleId, { withNotes: true });
  if (!article) throw ApiError.notFound('Article not found');

  const isOwner = viewerId && String(article.author?._id ?? article.author) === String(viewerId);

  if (!isOwner) {
    const isReadable =
      article.status === ARTICLE_STATUS.PUBLISHED &&
      article.visibility !== ARTICLE_VISIBILITY.PRIVATE;

    if (!isReadable) throw ApiError.notFound('Article not found');
  }

  const serialized = serializeArticle(article, { includeContent: true });

  // Private notes belong to the author alone.
  if (!isOwner) delete serialized.notes;

  return { article: serialized, isOwner: Boolean(isOwner) };
};

/** Creates an article (Write page, AI Writer page). */
export const createArticle = async (userId, payload, file = null) => {
  const author = await userRepository.findById(userId);
  if (!author) throw ApiError.notFound('Author not found');

  const title = stripTags(payload.title) || 'Untitled Article';
  const content = sanitizeArticleHtml(payload.content);
  const tags = cleanTags(payload.tags);

  const slug = await uniqueSlug(title, (candidate) =>
    articleRepository.slugExistsForAuthor(userId, candidate),
  );

  const article = await articleRepository.create({
    title,
    slug,
    content,
    excerpt: stripTags(payload.excerpt) || buildExcerpt(content),
    // Mirrors the Write page, which falls back to the first tag.
    category: stripTags(payload.category) || tags[0] || DEFAULT_CATEGORY,
    tags,
    author: author._id,
    authorName: author.name,
    status: payload.status ?? ARTICLE_STATUS.DRAFT,
    visibility: payload.visibility ?? ARTICLE_VISIBILITY.PUBLIC,
    allowComments: payload.allowComments ?? true,
    coverImage: file?.publicUrl ?? payload.coverImage ?? '',
    seoTitle: stripTags(payload.seoTitle) ?? '',
    seoDescription: stripTags(payload.seoDescription) ?? '',
    generatedByAI: Boolean(payload.generatedByAI),
    notes: (payload.notes ?? []).map((note) => ({ text: stripTags(note) })).filter((note) => note.text),
  });

  return serializeArticle(article, { includeContent: true });
};

/** Updates an article the caller owns. */
export const updateArticle = async (userId, articleId, payload, file = null) => {
  const article = await loadOwnedArticle(articleId, userId, { withNotes: true });

  if (payload.title !== undefined) {
    const title = stripTags(payload.title) || 'Untitled Article';
    if (title !== article.title) {
      article.title = title;
      article.slug = await uniqueSlug(title, async (candidate) => {
        if (candidate === article.slug) return false;
        return articleRepository.slugExistsForAuthor(userId, candidate);
      });
    }
  }

  if (payload.content !== undefined) {
    article.content = sanitizeArticleHtml(payload.content);
    // Only auto-generate when there is no excerpt at all; an author-written
    // one is never silently overwritten.
    if (payload.excerpt === undefined && !article.excerpt) {
      article.excerpt = buildExcerpt(article.content);
    }
  }

  if (payload.excerpt !== undefined) article.excerpt = stripTags(payload.excerpt);
  if (payload.tags !== undefined) article.tags = cleanTags(payload.tags);
  if (payload.category !== undefined) {
    article.category = stripTags(payload.category) || article.tags[0] || DEFAULT_CATEGORY;
  }
  if (payload.visibility !== undefined) article.visibility = payload.visibility;
  if (payload.allowComments !== undefined) article.allowComments = payload.allowComments;
  if (payload.seoTitle !== undefined) article.seoTitle = stripTags(payload.seoTitle);
  if (payload.seoDescription !== undefined) article.seoDescription = stripTags(payload.seoDescription);

  if (payload.status !== undefined && payload.status !== article.status) {
    // Track where an archived article came from so it can be restored.
    if (payload.status === ARTICLE_STATUS.ARCHIVED) {
      article.previousStatus = article.status;
    }
    article.status = payload.status;
  }

  if (file?.publicUrl) {
    const previousImage = article.coverImage;
    article.coverImage = file.publicUrl;
    await removeUpload(previousImage);
  } else if (payload.coverImage !== undefined) {
    article.coverImage = payload.coverImage;
  }

  if (payload.notes !== undefined) {
    article.notes = payload.notes
      .map((note) => ({ text: stripTags(typeof note === 'string' ? note : note.text) }))
      .filter((note) => note.text);
  }

  await article.save();

  return serializeArticle(article, { includeContent: true });
};

/** Explicit status transition (used by the publish/draft toggles). */
export const changeStatus = async (userId, articleId, status) => {
  const article = await loadOwnedArticle(articleId, userId);

  if (status === ARTICLE_STATUS.ARCHIVED) {
    article.previousStatus = article.status;
  }

  article.status = status;
  await article.save();

  return serializeArticle(article);
};

/** Archives an article — mirrors articlesStore.archiveArticle. */
export const archiveArticle = (userId, articleId) =>
  changeStatus(userId, articleId, ARTICLE_STATUS.ARCHIVED);

/** Restores an archived article to whatever status it held before. */
export const restoreArticle = async (userId, articleId) => {
  const article = await loadOwnedArticle(articleId, userId);

  if (article.status !== ARTICLE_STATUS.ARCHIVED) {
    throw ApiError.badRequest('Only archived articles can be restored');
  }

  article.status = article.previousStatus ?? ARTICLE_STATUS.DRAFT;
  article.previousStatus = undefined;
  article.archivedAt = undefined;
  await article.save();

  return serializeArticle(article);
};

/**
 * Permanently deletes an article and every reference to it, so no collection
 * or bookmark list is left pointing at a missing document.
 */
export const deleteArticle = async (userId, articleId) => {
  const article = await loadOwnedArticle(articleId, userId);
  const coverImage = article.coverImage;

  await articleRepository.deleteById(articleId);

  await Promise.all([
    collectionRepository.removeArticleFromAll(articleId),
    userRepository.removeBookmarkForAll(articleId),
    analyticsRepository.deleteAllForArticle(articleId),
    removeUpload(coverImage),
  ]);

  return { message: 'Article deleted successfully', id: String(articleId) };
};

/** Appends a private note from the Write page's notes panel. */
export const addNote = async (userId, articleId, text) => {
  const article = await loadOwnedArticle(articleId, userId, { withNotes: true });

  const clean = stripTags(text);
  if (!clean) throw ApiError.badRequest('Note text is required');

  article.notes.push({ text: clean });
  await article.save();

  return serializeArticle(article, { includeContent: true }).notes;
};

export const deleteNote = async (userId, articleId, noteId) => {
  const article = await loadOwnedArticle(articleId, userId, { withNotes: true });

  const note = article.notes.id(noteId);
  if (!note) throw ApiError.notFound('Note not found');

  note.deleteOne();
  await article.save();

  return serializeArticle(article, { includeContent: true }).notes;
};

/** Categories present in the public feed, for the Discover filter chips. */
export const listCategories = async () => {
  const categories = await articleRepository.distinctCategories({
    status: ARTICLE_STATUS.PUBLISHED,
    visibility: ARTICLE_VISIBILITY.PUBLIC,
  });

  return categories.filter(Boolean).sort();
};

export default {
  listMyArticles,
  listPublicArticles,
  getArticle,
  createArticle,
  updateArticle,
  changeStatus,
  archiveArticle,
  restoreArticle,
  deleteArticle,
  addNote,
  deleteNote,
  listCategories,
};
