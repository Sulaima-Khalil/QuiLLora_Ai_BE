/**
 * Presentation layer.
 *
 * Mongoose documents are mapped to the exact shapes the InkFlow AI frontend
 * already renders (`id` not `_id`, `img` not `coverImage`, a formatted `date`
 * string, a `"5 min read"` label). Keeping the translation here means the
 * React components need no changes when the localStorage stores are swapped
 * for HTTP calls.
 */
import {
  ARTICLE_STATUS,
  BILLING_CYCLE,
  DEFAULT_PLAN_ID,
  READER_TYPES,
  SUBSCRIPTION_STATUS,
} from '../constants/index.js';
import { formatArticleDate, formatMonthYear } from './date.js';
import { formatReadingTime } from './readTime.js';

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/**
 * Reader-type label. Derived deterministically from the article id so the
 * label is stable across requests, matching the frontend's previous behaviour
 * in utils/metrics.js.
 */
const readerTypeFor = (id) => {
  const key = String(id ?? '');
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(index);
    hash |= 0;
  }
  return READER_TYPES[Math.abs(hash) % READER_TYPES.length];
};

/**
 * SEO score: a transparent rubric over fields the author actually controls,
 * replacing the frontend's hash-based placeholder with something actionable.
 */
const seoScoreFor = (article) => {
  let score = 40;

  const titleLength = article.title?.length ?? 0;
  if (titleLength >= 20 && titleLength <= 70) score += 15;
  else if (titleLength > 0) score += 7;

  const descriptionLength = (article.seoDescription || article.excerpt || '').length;
  if (descriptionLength >= 70 && descriptionLength <= 160) score += 15;
  else if (descriptionLength > 0) score += 7;

  const words = article.wordCount ?? 0;
  if (words >= 900) score += 15;
  else if (words >= 400) score += 10;
  else if (words > 0) score += 4;

  if ((article.tags?.length ?? 0) >= 3) score += 8;
  else if ((article.tags?.length ?? 0) > 0) score += 4;

  if (article.coverImage) score += 4;
  if (article.seoTitle) score += 3;

  return Math.max(0, Math.min(100, score));
};

/**
 * Serialises an article for list and detail responses.
 *
 * @param {object} article Mongoose document or lean object.
 * @param {object} [options]
 * @param {boolean} [options.includeContent] Include the full HTML body.
 * @param {Set<string>} [options.bookmarkedIds] Ids the current user saved.
 */
export const serializeArticle = (article, { includeContent = false, bookmarkedIds } = {}) => {
  if (!article) return null;

  const source = typeof article.toObject === 'function' ? article.toObject({ virtuals: true }) : article;
  const id = idOf(source._id ?? source.id);

  // `author` may be an ObjectId or a populated user document.
  const populatedAuthor = source.author && typeof source.author === 'object' && source.author.name
    ? source.author
    : null;

  const authorName = populatedAuthor?.name || source.authorName || 'Unknown author';

  const payload = {
    id,
    title: source.title,
    slug: source.slug ?? '',

    // The frontend card reads `description`; `excerpt` is kept as an alias so
    // both the card and the editor's SEO panel work unchanged.
    description: source.excerpt ?? '',
    excerpt: source.excerpt ?? '',

    category: source.category,
    tags: source.tags ?? [],

    author: authorName,
    authorId: idOf(source.author),
    authorAvatar: populatedAuthor?.avatar ?? '',
    authorRole: populatedAuthor?.role ?? '',

    // Pre-formatted for direct rendering; `createdAt` stays available for sorting.
    date: formatArticleDate(source.publishedAt ?? source.createdAt),
    readingTime: formatReadingTime(source.readTime),
    readTime: source.readTime ?? 0,

    status: source.status,
    previousStatus: source.previousStatus,
    visibility: source.visibility,
    allowComments: source.allowComments ?? true,

    img: source.coverImage || '',
    coverImage: source.coverImage || '',

    seoTitle: source.seoTitle ?? '',
    seoDescription: source.seoDescription ?? '',

    // Real values, replacing the hash-derived placeholders in utils/metrics.js.
    words: source.wordCount ?? 0,
    wordCount: source.wordCount ?? 0,
    views: source.status === ARTICLE_STATUS.PUBLISHED ? source.views ?? 0 : 0,
    uniqueViews: source.uniqueViews ?? 0,
    bookmarkCount: source.bookmarkCount ?? 0,
    seo: seoScoreFor(source),
    readerType: readerTypeFor(id),

    generatedByAI: source.generatedByAI ?? false,
    publishedAt: source.publishedAt ?? null,
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
  };

  if (bookmarkedIds) {
    payload.isBookmarked = bookmarkedIds.has(id);
  }

  if (includeContent) {
    payload.content = source.content ?? '';
    if (Array.isArray(source.notes)) {
      payload.notes = source.notes.map((note) => ({
        id: idOf(note._id),
        text: note.text,
        createdAt: note.createdAt,
      }));
    }
  }

  return payload;
};

export const serializeArticles = (articles, options) =>
  (articles ?? []).map((article) => serializeArticle(article, options));

/** Public-facing user shape, used for the session user and author profiles. */
export const serializeUser = (user) => {
  if (!user) return null;

  const source = typeof user.toObject === 'function' ? user.toObject({ virtuals: true }) : user;

  return {
    id: idOf(source._id ?? source.id),
    name: source.name,
    username: source.username ?? '',
    email: source.email,
    role: source.role ?? '',
    bio: source.bio ?? '',
    country: source.country ?? '',
    avatar: source.avatar ?? '',
    initials: source.initials ?? '',
    isEmailVerified: source.isEmailVerified ?? false,
    newsletterOptIn: source.newsletterOptIn ?? false,
    authProvider: source.authProvider,
    linkedProviders: (source.oauthAccounts ?? []).map((account) => account.provider),
    hasPassword: Boolean(source.password) || source.hasPassword === true,
    settings: source.settings ?? {},
    createdAt: source.createdAt ?? null,
    lastLoginAt: source.lastLoginAt ?? null,
  };
};

/** Collection shape expected by pages/Collections.jsx. */
export const serializeCollection = (collection, { includeArticles = false } = {}) => {
  if (!collection) return null;

  const source =
    typeof collection.toObject === 'function' ? collection.toObject({ virtuals: true }) : collection;

  const articles = source.articles ?? [];
  const isPopulated = articles.length > 0 && typeof articles[0] === 'object' && articles[0].title;

  return {
    id: idOf(source._id ?? source.id),
    name: source.name,
    description: source.description ?? '',
    articleIds: articles.map((article) => idOf(article)),
    articleCount: articles.length,
    ...(includeArticles && isPopulated
      ? { articles: articles.map((article) => serializeArticle(article)) }
      : {}),
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
  };
};

/** Team member shape expected by pages/Team.jsx (note the `joined` label). */
export const serializeTeamMember = (member) => {
  if (!member) return null;

  const source = typeof member.toObject === 'function' ? member.toObject({ virtuals: true }) : member;

  return {
    id: idOf(source._id ?? source.id),
    name: source.name,
    email: source.email,
    role: source.role,
    status: source.status,
    initials: source.initials ?? '',
    joined: formatMonthYear(source.joinedAt ?? source.createdAt),
    joinedAt: source.joinedAt ?? source.createdAt ?? null,
    userId: idOf(source.user),
  };
};

/**
 * Subscription shape for the client.
 *
 * Allow-listed rather than spread: the subdocument also carries provider
 * customer and subscription ids, which are nobody's business but the server's.
 */
export const serializeSubscription = (subscription) => {
  const source =
    typeof subscription?.toObject === 'function' ? subscription.toObject() : subscription ?? {};

  return {
    planId: source.planId ?? DEFAULT_PLAN_ID,
    status: source.status ?? SUBSCRIPTION_STATUS.ACTIVE,
    cycle: source.cycle ?? BILLING_CYCLE.MONTHLY,
    startedAt: source.startedAt ?? null,
    currentPeriodEnd: source.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: source.cancelAtPeriodEnd ?? false,
    pendingPlanId: source.pendingPlanId ?? null,
    pendingCycle: source.pendingCycle ?? null,
    pendingSince: source.pendingSince ?? null,
    provider: source.provider ?? null,
  };
};

export default {
  serializeArticle,
  serializeArticles,
  serializeUser,
  serializeCollection,
  serializeTeamMember,
  serializeSubscription,
};
