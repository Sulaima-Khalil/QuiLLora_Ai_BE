import mongoose from 'mongoose';
import {
  ARTICLE_STATUS,
  ARTICLE_STATUSES,
  ARTICLE_VISIBILITIES,
  ARTICLE_VISIBILITY,
  DEFAULT_CATEGORY,
  RESTORABLE_STATUSES,
} from '../constants/index.js';
import { calculateReadTime, buildExcerpt, countWords } from '../utils/readTime.js';

const { Schema, model } = mongoose;

const articleSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title must be at most 200 characters'],
    },

    slug: { type: String, trim: true, lowercase: true, index: true },

    /** Sanitised TipTap HTML. */
    content: { type: String, default: '' },

    /** Card description — derived from `content` when not supplied. */
    excerpt: { type: String, trim: true, maxlength: 400, default: '' },

    /**
     * Free-form rather than an enum: pages/Write.jsx derives the category from
     * the author's first tag, so any string is legitimate input.
     */
    category: { type: String, trim: true, maxlength: 60, default: DEFAULT_CATEGORY, index: true },

    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
      validate: [(value) => value.length <= 20, 'An article may have at most 20 tags'],
    },

    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Author is required'],
      index: true,
    },

    /**
     * Denormalised author name. Keeps list endpoints single-query and
     * preserves attribution on articles seeded before a user existed.
     */
    authorName: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: ARTICLE_STATUSES,
      default: ARTICLE_STATUS.DRAFT,
      index: true,
    },

    /** Status to return to when un-archiving (articlesStore.restoreArticle). */
    previousStatus: { type: String, enum: RESTORABLE_STATUSES },

    visibility: {
      type: String,
      enum: ARTICLE_VISIBILITIES,
      default: ARTICLE_VISIBILITY.PUBLIC,
    },

    allowComments: { type: Boolean, default: true },

    /** Cover image path or URL (`img` on the frontend card). */
    coverImage: { type: String, default: '' },

    seoTitle: { type: String, trim: true, maxlength: 200, default: '' },
    seoDescription: { type: String, trim: true, maxlength: 320, default: '' },

    readTime: { type: Number, default: 0, min: 0 },
    wordCount: { type: Number, default: 0, min: 0 },

    /** Denormalised counters kept in step by the analytics service. */
    views: { type: Number, default: 0, min: 0 },
    uniqueViews: { type: Number, default: 0, min: 0 },
    bookmarkCount: { type: Number, default: 0, min: 0 },

    publishedAt: { type: Date },
    archivedAt: { type: Date },

    /** Private author notes from the Write page's notes panel. */
    notes: {
      type: [
        new Schema(
          {
            text: { type: String, required: true, trim: true, maxlength: 1000 },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
      select: false,
    },

    /** Whether the body was produced by the AI Writer. */
    generatedByAI: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Dashboard/My Articles: "this author's articles, newest first", optionally
// filtered by status. Compound order matches the equality-then-sort rule.
articleSchema.index({ author: 1, status: 1, createdAt: -1 });

// Discover: published public articles, newest first.
articleSchema.index({ status: 1, visibility: 1, publishedAt: -1 });

// Slugs are unique per author, so two writers may both publish "Hello World".
articleSchema.index({ author: 1, slug: 1 }, { unique: true, sparse: true });

// Full-text search for the Discover/My Articles filter inputs.
articleSchema.index(
  { title: 'text', excerpt: 'text', tags: 'text' },
  { weights: { title: 10, tags: 4, excerpt: 1 }, name: 'article_text_search' },
);

/**
 * Keeps derived fields consistent no matter which endpoint wrote the document.
 * Centralising this here means the controllers never compute read time twice.
 */
articleSchema.pre('save', function syncDerivedFields() {
  if (this.isModified('content')) {
    this.wordCount = countWords(this.content);
    this.readTime = calculateReadTime(this.content);
  }

  if (!this.excerpt && this.content) {
    this.excerpt = buildExcerpt(this.content);
  }

  if (this.isModified('status')) {
    if (this.status === ARTICLE_STATUS.PUBLISHED && !this.publishedAt) {
      this.publishedAt = new Date();
    }
    if (this.status === ARTICLE_STATUS.ARCHIVED) {
      this.archivedAt = new Date();
    }
  }
});

/** True when the article is publicly readable by an anonymous visitor. */
articleSchema.virtual('isPublic').get(function isPublic() {
  return this.status === ARTICLE_STATUS.PUBLISHED && this.visibility === ARTICLE_VISIBILITY.PUBLIC;
});

export const Article = model('Article', articleSchema);

export default Article;
