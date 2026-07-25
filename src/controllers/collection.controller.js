import collectionService from '../services/collection.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendCreated, sendSuccess } from '../utils/ApiResponse.js';

/**
 * GET /collections/state — bookmarks and collections in one call.
 * Mirrors `getState()` in the frontend's collectionsStore.
 */
export const getState = asyncHandler(async (req, res) => {
  const state = await collectionService.getState(req.user._id);
  return sendSuccess(res, { message: 'Collections state', data: state });
});

export const listBookmarks = asyncHandler(async (req, res) => {
  const articles = await collectionService.listBookmarks(req.user._id);
  return sendSuccess(res, { message: 'Saved articles', data: { articles } });
});

export const toggleBookmark = asyncHandler(async (req, res) => {
  const articleId = req.body?.articleId ?? req.params.articleId;
  const state = await collectionService.toggleBookmark(req.user._id, articleId);

  return sendSuccess(res, {
    message: state.bookmarked ? 'Article saved' : 'Article removed from saved',
    data: state,
  });
});

export const listCollections = asyncHandler(async (req, res) => {
  const collections = await collectionService.listCollections(req.user._id);
  return sendSuccess(res, { message: 'Collections', data: { collections } });
});

export const getCollection = asyncHandler(async (req, res) => {
  const collection = await collectionService.getCollection(req.user._id, req.params.id);
  return sendSuccess(res, { message: 'Collection', data: { collection } });
});

export const createCollection = asyncHandler(async (req, res) => {
  const collection = await collectionService.createCollection(req.user._id, req.body);
  return sendCreated(res, { message: 'Collection created', data: { collection } });
});

export const updateCollection = asyncHandler(async (req, res) => {
  const collection = await collectionService.renameCollection(req.user._id, req.params.id, req.body);
  return sendSuccess(res, { message: 'Collection updated', data: { collection } });
});

export const deleteCollection = asyncHandler(async (req, res) => {
  const result = await collectionService.deleteCollection(req.user._id, req.params.id);
  return sendSuccess(res, { message: result.message, data: { id: result.id } });
});

export const addArticle = asyncHandler(async (req, res) => {
  const articleId = req.body?.articleId ?? req.params.articleId;
  const collection = await collectionService.addArticleToCollection(
    req.user._id,
    req.params.id,
    articleId,
  );

  return sendSuccess(res, { message: 'Article added to collection', data: { collection } });
});

export const removeArticle = asyncHandler(async (req, res) => {
  const collection = await collectionService.removeArticleFromCollection(
    req.user._id,
    req.params.id,
    req.params.articleId,
  );

  return sendSuccess(res, { message: 'Article removed from collection', data: { collection } });
});

export default {
  getState,
  listBookmarks,
  toggleBookmark,
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addArticle,
  removeArticle,
};
