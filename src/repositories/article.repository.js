import { Article } from '../models/index.js';
import { ARTICLE_STATUS, ARTICLE_VISIBILITY } from '../constants/index.js';

/** Fields safe to sort by (all indexed or cheap). */
export const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'publishedAt', 'views', 'title', 'readTime'];

const AUTHOR_POPULATE = { path: 'author', select: 'name avatar role username' };

/**
 * Translates API filters into a Mongo query.
 *
 * @param {object} filters
 * @param {string} [filters.author] Restrict to one author.
 * @param {string|string[]} [filters.status]
 * @param {string} [filters.category]
 * @param {string} [filters.tag]
 * @param {string} [filters.search] Free-text query.
 * @param {string[]} [filters.ids] Restrict to a set of ids.
 * @param {boolean} [filters.publicOnly] Only published + public articles.
 * @param {string[]} [filters.excludeStatus]
 */
export const buildFilter = ({
  author,
  status,
  category,
  tag,
  search,
  ids,
  publicOnly,
  excludeStatus,
} = {}) => {
  const filter = {};

  if (author) filter.author = author;
  if (ids) filter._id = { $in: ids };

  if (status) {
    filter.status = Array.isArray(status) ? { $in: status } : status;
  } else if (excludeStatus?.length) {
    filter.status = { $nin: excludeStatus };
  }

  if (publicOnly) {
    filter.status = ARTICLE_STATUS.PUBLISHED;
    filter.visibility = ARTICLE_VISIBILITY.PUBLIC;
  }

  if (category && category !== 'All') filter.category = category;
  if (tag) filter.tags = tag;

  if (search) {
    // Regex rather than $text so partial words match as the user types, which
    // is what the Discover/My Articles filter inputs expect. The input is
    // escaped so user text cannot inject regex metacharacters.
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ title: pattern }, { excerpt: pattern }, { tags: pattern }, { category: pattern }];
  }

  return filter;
};

/** Paginated list plus a total count, issued as one round trip. */
export const paginate = async ({ filter = {}, sort = { createdAt: -1 }, skip = 0, limit = 12 }) => {
  const [items, total] = await Promise.all([
    Article.find(filter).sort(sort).skip(skip).limit(limit).populate(AUTHOR_POPULATE).lean({ virtuals: true }).exec(),
    Article.countDocuments(filter).exec(),
  ]);

  return { items, total };
};

export const findAll = (filter = {}, { sort = { createdAt: -1 }, limit } = {}) => {
  const query = Article.find(filter).sort(sort).populate(AUTHOR_POPULATE).lean({ virtuals: true });
  if (limit) query.limit(limit);
  return query.exec();
};

/** Document (not lean) so callers can mutate and `.save()`. */
export const findById = (id, { withNotes = false } = {}) => {
  const query = Article.findById(id);
  if (withNotes) query.select('+notes');
  return query.populate(AUTHOR_POPULATE).exec();
};

export const findBySlug = (author, slug) =>
  Article.findOne({ author, slug }).populate(AUTHOR_POPULATE).exec();

export const slugExistsForAuthor = async (author, slug) =>
  Boolean(await Article.exists({ author, slug }));

export const create = (payload) => Article.create(payload);

export const deleteById = (id) => Article.findByIdAndDelete(id).exec();

export const deleteAllByAuthor = (author) => Article.deleteMany({ author }).exec();

export const countByAuthor = (author, extraFilter = {}) =>
  Article.countDocuments({ author, ...extraFilter }).exec();

/**
 * Refreshes the denormalised byline on every article by this author.
 * Called when a user renames themselves.
 */
export const updateAuthorName = (author, authorName) =>
  Article.updateMany({ author }, { $set: { authorName } }).exec();

/** Increments the denormalised view counters. */
export const incrementViews = (id, { unique = false } = {}) =>
  Article.findByIdAndUpdate(
    id,
    { $inc: { views: 1, ...(unique ? { uniqueViews: 1 } : {}) } },
    { new: true },
  ).exec();

export const adjustBookmarkCount = (id, delta) =>
  Article.findByIdAndUpdate(id, { $inc: { bookmarkCount: delta } }, { new: true }).exec();

/** Distinct categories in use, for the Discover filter chips. */
export const distinctCategories = (filter = {}) => Article.distinct('category', filter).exec();

/**
 * Per-author totals for the dashboard summary cards, computed in one
 * aggregation rather than four count queries.
 */
export const aggregateAuthorTotals = async (author) => {
  const [result] = await Article.aggregate([
    { $match: { author } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        published: { $sum: { $cond: [{ $eq: ['$status', ARTICLE_STATUS.PUBLISHED] }, 1, 0] } },
        drafts: { $sum: { $cond: [{ $eq: ['$status', ARTICLE_STATUS.DRAFT] }, 1, 0] } },
        archived: { $sum: { $cond: [{ $eq: ['$status', ARTICLE_STATUS.ARCHIVED] }, 1, 0] } },
        views: { $sum: '$views' },
        words: { $sum: '$wordCount' },
        readTime: { $sum: '$readTime' },
        bookmarks: { $sum: '$bookmarkCount' },
      },
    },
  ]).exec();

  return (
    result ?? {
      total: 0,
      published: 0,
      drafts: 0,
      archived: 0,
      views: 0,
      words: 0,
      readTime: 0,
      bookmarks: 0,
    }
  );
};

/** Category distribution for the analytics donut. */
export const aggregateCategoryBreakdown = (author) =>
  Article.aggregate([
    { $match: { author, status: ARTICLE_STATUS.PUBLISHED } },
    { $group: { _id: '$category', count: { $sum: 1 }, views: { $sum: '$views' } } },
    { $sort: { views: -1 } },
    { $limit: 8 },
  ]).exec();

export default {
  SORTABLE_FIELDS,
  buildFilter,
  paginate,
  findAll,
  findById,
  findBySlug,
  slugExistsForAuthor,
  create,
  deleteById,
  deleteAllByAuthor,
  countByAuthor,
  updateAuthorName,
  incrementViews,
  adjustBookmarkCount,
  distinctCategories,
  aggregateAuthorTotals,
  aggregateCategoryBreakdown,
};
