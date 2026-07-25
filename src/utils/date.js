/**
 * Date formatting helpers.
 *
 * The frontend renders pre-formatted date strings straight into the DOM
 * (e.g. `"Dec 4, 2025"`, `"Jan 2024"`), so formatting happens here rather than
 * in React. Everything is pinned to `en-US`/UTC to keep API output
 * deterministic regardless of server locale or timezone.
 */

const ARTICLE_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'UTC',
});

const toDate = (value) => (value instanceof Date ? value : new Date(value));

const isValid = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/** `"Dec 4, 2025"` — the format used on every article card. */
export const formatArticleDate = (value) => {
  const date = toDate(value);
  return isValid(date) ? ARTICLE_DATE.format(date) : '';
};

/** `"Jan 2024"` — the format used for team member join dates. */
export const formatMonthYear = (value) => {
  const date = toDate(value);
  return isValid(date) ? MONTH_YEAR.format(date) : '';
};

/** `"Mon"` — weekday labels for the analytics bar chart. */
export const formatWeekday = (value) => {
  const date = toDate(value);
  return isValid(date) ? WEEKDAY.format(date) : '';
};

/** `YYYY-MM-DD` in UTC — stable grouping key for daily aggregations. */
export const toDayKey = (value) => {
  const date = toDate(value);
  return isValid(date) ? date.toISOString().slice(0, 10) : '';
};

/** Midnight UTC on the given date. */
export const startOfUtcDay = (value = new Date()) => {
  const date = toDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** `days` whole UTC days before `from`, at midnight. */
export const subtractDays = (days, from = new Date()) => {
  const start = startOfUtcDay(from);
  start.setUTCDate(start.getUTCDate() - days);
  return start;
};

/** `"Just now"`, `"5m ago"`, `"3h ago"`, `"2d ago"`, else an absolute date. */
export const formatRelative = (value, now = new Date()) => {
  const date = toDate(value);
  if (!isValid(date)) return '';

  const seconds = Math.floor((toDate(now).getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatArticleDate(date);
};

export default {
  formatArticleDate,
  formatMonthYear,
  formatWeekday,
  toDayKey,
  startOfUtcDay,
  subtractDays,
  formatRelative,
};
