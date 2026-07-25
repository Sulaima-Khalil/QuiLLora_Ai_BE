import { Collection } from '../models/index.js';

const ARTICLE_POPULATE = {
  path: 'articles',
  select: 'title excerpt category coverImage status visibility readTime wordCount views author authorName publishedAt createdAt tags',
  populate: { path: 'author', select: 'name avatar role' },
};

export const findAllByOwner = (owner, { populateArticles = false } = {}) => {
  const query = Collection.find({ owner }).sort({ createdAt: 1 });
  if (populateArticles) query.populate(ARTICLE_POPULATE);
  return query.exec();
};

export const findByIdForOwner = (id, owner, { populateArticles = false } = {}) => {
  const query = Collection.findOne({ _id: id, owner });
  if (populateArticles) query.populate(ARTICLE_POPULATE);
  return query.exec();
};

export const create = (payload) => Collection.create(payload);

export const updateForOwner = (id, owner, update) =>
  Collection.findOneAndUpdate({ _id: id, owner }, update, { new: true, runValidators: true }).exec();

export const deleteForOwner = (id, owner) => Collection.findOneAndDelete({ _id: id, owner }).exec();

/** Idempotent add — `$addToSet` avoids duplicate entries. */
export const addArticle = (id, owner, articleId) =>
  Collection.findOneAndUpdate(
    { _id: id, owner },
    { $addToSet: { articles: articleId } },
    { new: true },
  ).exec();

export const removeArticle = (id, owner, articleId) =>
  Collection.findOneAndUpdate({ _id: id, owner }, { $pull: { articles: articleId } }, { new: true }).exec();

/** Drops a deleted article from every collection that referenced it. */
export const removeArticleFromAll = (articleId) =>
  Collection.updateMany({ articles: articleId }, { $pull: { articles: articleId } }).exec();

export const deleteAllByOwner = (owner) => Collection.deleteMany({ owner }).exec();

export const countByOwner = (owner) => Collection.countDocuments({ owner }).exec();

export default {
  findAllByOwner,
  findByIdForOwner,
  create,
  updateForOwner,
  deleteForOwner,
  addArticle,
  removeArticle,
  removeArticleFromAll,
  deleteAllByOwner,
  countByOwner,
};
