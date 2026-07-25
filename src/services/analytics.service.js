import crypto from 'node:crypto';
import { ARTICLE_STATUS, TRAFFIC_SOURCE, TRAFFIC_SOURCES } from '../constants/index.js';
import { analyticsRepository, articleRepository } from '../repositories/index.js';
import logger from '../utils/logger.js';
import { formatWeekday, subtractDays, toDayKey } from '../utils/date.js';

/**
 * Analytics — the backend for pages/Analytics.jsx and the dashboard cards,
 * replacing the page's hardcoded arrays with real aggregations.
 */

const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'baidu.', 'ecosia.', 'brave.'];
const SOCIAL_HOSTS = [
  'twitter.', 'x.com', 't.co', 'facebook.', 'linkedin.', 'lnkd.in',
  'reddit.', 'instagram.', 'youtube.', 'mastodon.', 'threads.', 'bsky.',
];

/** Buckets a referrer URL into one of the four traffic sources. */
export const classifySource = (referrer, selfHost) => {
  if (!referrer) return TRAFFIC_SOURCE.DIRECT;

  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return TRAFFIC_SOURCE.DIRECT;
  }

  // Internal navigation is not a referral.
  if (selfHost && host === String(selfHost).toLowerCase()) return TRAFFIC_SOURCE.DIRECT;
  if (SEARCH_HOSTS.some((entry) => host.includes(entry))) return TRAFFIC_SOURCE.SEARCH;
  if (SOCIAL_HOSTS.some((entry) => host.includes(entry))) return TRAFFIC_SOURCE.SOCIAL;

  return TRAFFIC_SOURCE.REFERRAL;
};

/**
 * Pseudonymous visitor identifier.
 *
 * Signed-in readers are keyed by user id; anonymous ones by a hash of IP and
 * user agent. The raw IP is never stored, so unique-reader counts do not come
 * at the cost of retaining personal data.
 */
export const buildVisitorHash = ({ userId, ip, userAgent }) => {
  const seed = userId ? `user:${userId}` : `anon:${ip ?? ''}:${userAgent ?? ''}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
};

/**
 * Records a read of a published article.
 *
 * Drafts and the author's own reads are ignored — otherwise editing a piece
 * would inflate its view count.
 */
export const recordView = async (article, { userId, ip, userAgent, referrer, selfHost, durationSeconds }) => {
  if (article.status !== ARTICLE_STATUS.PUBLISHED) return { recorded: false, unique: false };

  const authorId = String(article.author?._id ?? article.author);
  if (userId && String(userId) === authorId) return { recorded: false, unique: false };

  const visitorHash = buildVisitorHash({ userId, ip, userAgent });
  const day = toDayKey(new Date());

  try {
    const { unique } = await analyticsRepository.recordView({
      article: article._id,
      author: article.author?._id ?? article.author,
      viewer: userId ?? null,
      visitorHash,
      source: classifySource(referrer, selfHost),
      referrer: String(referrer ?? '').slice(0, 500),
      day,
      durationSeconds: Number(durationSeconds) || 0,
    });

    // Only unique daily reads move the counters, matching what the dashboard shows.
    if (unique) await articleRepository.incrementViews(article._id, { unique: true });

    return { recorded: true, unique };
  } catch (error) {
    // Analytics must never break article delivery.
    logger.warn(`Failed to record view for article ${article._id}: ${error.message}`);
    return { recorded: false, unique: false };
  }
};

/** Percentage change between two periods, guarding division by zero. */
const percentChange = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

/** Zero-filled daily series so the chart always renders a full window. */
const buildDailySeries = (rows, days) => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = subtractDays(offset);
    const key = toDayKey(date);
    const row = byDay.get(key);

    series.push({
      day: key,
      label: formatWeekday(date),
      views: row?.views ?? 0,
      uniqueVisitors: row?.uniqueVisitors ?? 0,
    });
  }

  return series;
};

/** Every traffic source represented, so the legend is stable. */
const buildSourceBreakdown = (rows, totalViews) => {
  const bySource = new Map(rows.map((row) => [row.source, row.views]));

  return TRAFFIC_SOURCES.map((source) => {
    const views = bySource.get(source) ?? 0;
    return {
      label: source,
      views,
      value: totalViews > 0 ? Math.round((views / totalViews) * 100) : 0,
    };
  }).sort((a, b) => b.views - a.views);
};

/**
 * Everything pages/Analytics.jsx renders, in one response.
 *
 * @param {string} authorId
 * @param {number} days Trailing window, defaults to a week.
 */
export const getAnalytics = async (authorObjectId, days = 7) => {
  const from = subtractDays(days - 1);
  const previousFrom = subtractDays(days * 2 - 1);

  const [totals, dailyRows, sourceRows, top, uniqueVisitors, currentViews, previousWindowViews, categories] =
    await Promise.all([
      articleRepository.aggregateAuthorTotals(authorObjectId),
      analyticsRepository.viewsByDay(authorObjectId, from),
      analyticsRepository.viewsBySource(authorObjectId, from),
      analyticsRepository.topArticles(authorObjectId, from, 5),
      analyticsRepository.uniqueVisitorCount(authorObjectId, from),
      analyticsRepository.countViews(authorObjectId, from),
      analyticsRepository.countViews(authorObjectId, previousFrom),
      articleRepository.aggregateCategoryBreakdown(authorObjectId),
    ]);

  // `previousWindowViews` covers both windows; subtract to isolate the earlier one.
  const priorViews = Math.max(0, previousWindowViews - currentViews);

  const engagementRate =
    currentViews > 0 ? Math.round((uniqueVisitors / currentViews) * 1000) / 10 : 0;

  return {
    range: { days, from, to: new Date() },

    summary: {
      totalArticles: totals.total,
      published: totals.published,
      drafts: totals.drafts,
      archived: totals.archived,
      totalViews: totals.views,
      totalWords: totals.words,
      totalReadTime: totals.readTime,
      bookmarks: totals.bookmarks,
      periodViews: currentViews,
      uniqueVisitors,
      engagementRate,
      viewsTrend: percentChange(currentViews, priorViews),
      averageWordsPerArticle: totals.total > 0 ? Math.round(totals.words / totals.total) : 0,
    },

    daily: buildDailySeries(dailyRows, days),
    trafficSources: buildSourceBreakdown(sourceRows, currentViews),

    topArticles: top.map((entry) => ({
      id: String(entry.articleId),
      title: entry.title,
      category: entry.category,
      status: entry.status,
      views: entry.views,
      uniqueVisitors: entry.uniqueVisitors,
      averageDuration: Math.round(entry.averageDuration),
      // Reads-per-visitor: the closest honest proxy for engagement.
      engagement: entry.views > 0 ? Math.round((entry.uniqueVisitors / entry.views) * 100) : 0,
      publishedAt: entry.publishedAt ?? entry.createdAt,
    })),

    categories: categories.map((entry) => ({
      label: entry._id ?? 'Uncategorised',
      count: entry.count,
      views: entry.views,
    })),
  };
};

/** Compact figures for the dashboard summary cards. */
export const getDashboardSummary = async (authorObjectId) => {
  const from = subtractDays(6);

  const [totals, periodViews, uniqueVisitors] = await Promise.all([
    articleRepository.aggregateAuthorTotals(authorObjectId),
    analyticsRepository.countViews(authorObjectId, from),
    analyticsRepository.uniqueVisitorCount(authorObjectId, from),
  ]);

  return {
    totalArticles: totals.total,
    published: totals.published,
    drafts: totals.drafts,
    archived: totals.archived,
    totalViews: totals.views,
    totalWords: totals.words,
    totalReadTime: totals.readTime,
    bookmarks: totals.bookmarks,
    weeklyViews: periodViews,
    weeklyReaders: uniqueVisitors,
  };
};

export default { classifySource, buildVisitorHash, recordView, getAnalytics, getDashboardSummary };
