import articleService from '../services/article.service.js';
import analyticsService from '../services/analytics.service.js';
import { articleRepository } from '../repositories/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/ApiResponse.js';
import { toPublicUrl } from '../middlewares/upload.middleware.js';
import ApiError from '../utils/ApiError.js';

/** Normalises an uploaded cover image into `{ publicUrl }`. */
const coverFile = (req) =>
  req.file ? { publicUrl: toPublicUrl(req.file, 'articles') } : null;

const query = (req) => req.validatedQuery ?? req.query ?? {};

/** GET /articles — the caller's own articles. */
export const listMyArticles = asyncHandler(async (req, res) => {
  const result = await articleService.listMyArticles(req.user._id, query(req));

  return sendPaginated(res, {
    message: 'Your articles',
    data: result.articles,
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/** GET /articles/discover — the public feed. */
export const listPublicArticles = asyncHandler(async (req, res) => {
  const result = await articleService.listPublicArticles(query(req), req.user?._id ?? null);

  return sendPaginated(res, {
    message: 'Discover articles',
    data: result.articles,
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await articleService.listCategories();
  return sendSuccess(res, { message: 'Categories', data: { categories } });
});

/** GET /articles/:id */
export const getArticle = asyncHandler(async (req, res) => {
  const result = await articleService.getArticle(req.params.id, req.user?._id ?? null);

  return sendSuccess(res, {
    message: 'Article',
    data: { article: result.article, isOwner: result.isOwner },
  });
});

export const createArticle = asyncHandler(async (req, res) => {
  const article = await articleService.createArticle(req.user._id, req.body, coverFile(req));
  return sendCreated(res, { message: 'Article created', data: { article } });
});

export const updateArticle = asyncHandler(async (req, res) => {
  const article = await articleService.updateArticle(
    req.user._id,
    req.params.id,
    req.body,
    coverFile(req),
  );

  return sendSuccess(res, { message: 'Article updated', data: { article } });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const article = await articleService.changeStatus(req.user._id, req.params.id, req.body.status);
  return sendSuccess(res, { message: `Article marked as ${article.status}`, data: { article } });
});

export const archiveArticle = asyncHandler(async (req, res) => {
  const article = await articleService.archiveArticle(req.user._id, req.params.id);
  return sendSuccess(res, { message: 'Article archived', data: { article } });
});

export const restoreArticle = asyncHandler(async (req, res) => {
  const article = await articleService.restoreArticle(req.user._id, req.params.id);
  return sendSuccess(res, { message: 'Article restored', data: { article } });
});

export const deleteArticle = asyncHandler(async (req, res) => {
  const result = await articleService.deleteArticle(req.user._id, req.params.id);
  return sendSuccess(res, { message: result.message, data: { id: result.id } });
});

/**
 * POST /articles/:id/view — records a read.
 *
 * Kept separate from GET so that fetching an article for editing, or a
 * prefetch, does not inflate the author's analytics.
 */
export const recordView = asyncHandler(async (req, res) => {
  const article = await articleRepository.findById(req.params.id);
  if (!article) throw ApiError.notFound('Article not found');

  const result = await analyticsService.recordView(article, {
    userId: req.user?._id ?? null,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? '',
    referrer: req.body?.referrer || req.get('referer') || '',
    selfHost: req.hostname,
    durationSeconds: req.body?.durationSeconds,
  });

  return sendSuccess(res, { message: 'View recorded', data: result });
});

export const addNote = asyncHandler(async (req, res) => {
  const notes = await articleService.addNote(req.user._id, req.params.id, req.body.text);
  return sendCreated(res, { message: 'Note added', data: { notes } });
});

export const deleteNote = asyncHandler(async (req, res) => {
  const notes = await articleService.deleteNote(req.user._id, req.params.id, req.params.noteId);
  return sendSuccess(res, { message: 'Note deleted', data: { notes } });
});

export default {
  listMyArticles,
  listPublicArticles,
  listCategories,
  getArticle,
  createArticle,
  updateArticle,
  changeStatus,
  archiveArticle,
  restoreArticle,
  deleteArticle,
  recordView,
  addNote,
  deleteNote,
};
