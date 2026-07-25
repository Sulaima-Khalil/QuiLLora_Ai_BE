import mongoose from 'mongoose';
import { ArticleView } from '../models/index.js';

/**
 * Records a read. Returns `{ recorded, unique }`.
 *
 * The unique index on (article, visitorHash, day) makes the first read of the
 * day a real insert and every repeat a duplicate-key error — so "unique
 * readers per day" is enforced by the database rather than a read-then-write
 * race in application code.
 */
export const recordView = async (payload) => {
  try {
    await ArticleView.create(payload);
    return { recorded: true, unique: true };
  } catch (error) {
    if (error?.code === 11000) return { recorded: true, unique: false };
    throw error;
  }
};

/** Total view events for an author since `from`. */
export const countViews = (author, from) =>
  ArticleView.countDocuments({ author, ...(from ? { createdAt: { $gte: from } } : {}) }).exec();

/** Daily totals, for the 7-day analytics bar chart. */
export const viewsByDay = (author, from) =>
  ArticleView.aggregate([
    { $match: { author, createdAt: { $gte: from } } },
    {
      $group: {
        _id: '$day',
        views: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$visitorHash' },
      },
    },
    { $project: { _id: 0, day: '$_id', views: 1, uniqueVisitors: { $size: '$uniqueVisitors' } } },
    { $sort: { day: 1 } },
  ]).exec();

/** Referrer breakdown, for the traffic-sources panel. */
export const viewsBySource = (author, from) =>
  ArticleView.aggregate([
    { $match: { author, createdAt: { $gte: from } } },
    { $group: { _id: '$source', views: { $sum: 1 } } },
    { $project: { _id: 0, source: '$_id', views: 1 } },
    { $sort: { views: -1 } },
  ]).exec();

/** Best-performing articles, for the "Top Articles" table. */
export const topArticles = (author, from, limit = 5) =>
  ArticleView.aggregate([
    { $match: { author, createdAt: { $gte: from } } },
    {
      $group: {
        _id: '$article',
        views: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$visitorHash' },
        totalDuration: { $sum: '$durationSeconds' },
      },
    },
    { $sort: { views: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'articles',
        localField: '_id',
        foreignField: '_id',
        as: 'article',
        pipeline: [{ $project: { title: 1, status: 1, publishedAt: 1, createdAt: 1, category: 1 } }],
      },
    },
    { $unwind: '$article' },
    {
      $project: {
        _id: 0,
        articleId: '$_id',
        title: '$article.title',
        category: '$article.category',
        status: '$article.status',
        publishedAt: '$article.publishedAt',
        createdAt: '$article.createdAt',
        views: 1,
        uniqueVisitors: { $size: '$uniqueVisitors' },
        averageDuration: {
          $cond: [{ $gt: ['$views', 0] }, { $divide: ['$totalDuration', '$views'] }, 0],
        },
      },
    },
  ]).exec();

/** Unique reader count across the whole window. */
export const uniqueVisitorCount = async (author, from) => {
  const [result] = await ArticleView.aggregate([
    { $match: { author, createdAt: { $gte: from } } },
    { $group: { _id: '$visitorHash' } },
    { $count: 'total' },
  ]).exec();

  return result?.total ?? 0;
};

/** Views for one article, used on the article detail/stats panel. */
export const viewsForArticle = (articleId, from) =>
  ArticleView.countDocuments({
    article: new mongoose.Types.ObjectId(String(articleId)),
    ...(from ? { createdAt: { $gte: from } } : {}),
  }).exec();

export const deleteAllForArticle = (article) => ArticleView.deleteMany({ article }).exec();

export const deleteAllForAuthor = (author) => ArticleView.deleteMany({ author }).exec();

export default {
  recordView,
  countViews,
  viewsByDay,
  viewsBySource,
  topArticles,
  uniqueVisitorCount,
  viewsForArticle,
  deleteAllForArticle,
  deleteAllForAuthor,
};
