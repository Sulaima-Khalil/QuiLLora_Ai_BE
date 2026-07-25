import { PAGINATION } from '../constants/index.js';

/**
 * Normalises `?page=&limit=` query values into safe integers.
 *
 * Clamping `limit` to MAX_LIMIT prevents a caller from requesting the entire
 * collection in one query.
 */
export const resolvePagination = ({ page, limit } = {}) => {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);

  const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : PAGINATION.DEFAULT_PAGE;

  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;

  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

/**
 * Maps a `?sort=` value onto a Mongoose sort object.
 * Unknown keys fall back to `-createdAt` so callers cannot sort by
 * arbitrary (unindexed) fields.
 */
export const resolveSort = (sort, allowed, fallback = { createdAt: -1 }) => {
  if (!sort) return fallback;

  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;

  if (!allowed.includes(field)) return fallback;

  return { [field]: descending ? -1 : 1 };
};

export default resolvePagination;
