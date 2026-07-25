/**
 * Application-wide constants.
 *
 * Values here mirror the vocabulary already used by the InkFlow AI frontend
 * (src/utils/*Store.js) so that no translation layer is needed between the
 * API payloads and the React state.
 */

/** Article lifecycle states — mirrors articlesStore.js `status`. */
export const ARTICLE_STATUS = Object.freeze({
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
});

export const ARTICLE_STATUSES = Object.freeze(Object.values(ARTICLE_STATUS));

/** Statuses an article can be restored to when un-archiving. */
export const RESTORABLE_STATUSES = Object.freeze([
  ARTICLE_STATUS.DRAFT,
  ARTICLE_STATUS.PUBLISHED,
]);

/** Article visibility — mirrors the VISIBILITY select in pages/Write.jsx. */
export const ARTICLE_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  UNLISTED: 'unlisted',
  PRIVATE: 'private',
});

export const ARTICLE_VISIBILITIES = Object.freeze(Object.values(ARTICLE_VISIBILITY));

/**
 * Categories seeded by the frontend. Kept as suggestions rather than a schema
 * enum: pages/Write.jsx derives `category` from the first free-text tag, so a
 * hard enum would reject legitimate user input.
 */
export const SUGGESTED_CATEGORIES = Object.freeze([
  'AI',
  'Design',
  'UX Research',
  'Engineering',
  'Technology',
  'Ethics',
  'Science',
  'Internal',
  'General',
]);

export const DEFAULT_CATEGORY = 'General';

/** Workspace roles — mirrors teamStore.js ROLES. */
export const TEAM_ROLE = Object.freeze({
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
});

export const TEAM_ROLES = Object.freeze(Object.values(TEAM_ROLE));

/** Membership lifecycle for invited team members. */
export const MEMBER_STATUS = Object.freeze({
  INVITED: 'Invited',
  ACTIVE: 'Active',
});

export const MEMBER_STATUSES = Object.freeze(Object.values(MEMBER_STATUS));

/** Editorial tone options — mirrors Setting.jsx `tones`. */
export const TONES = Object.freeze(['Academic', 'Minimalist', 'Persuasive', 'Technical']);

export const DEFAULT_TONE = 'Academic';

/** AI Writer length presets — mirrors pages/AIWriter.jsx. */
export const AI_LENGTHS = Object.freeze(['Short', 'Medium', 'Long']);

export const DEFAULT_AI_LENGTH = 'Medium';

/** Supported OAuth identity providers. */
export const AUTH_PROVIDER = Object.freeze({
  LOCAL: 'local',
  GOOGLE: 'google',
  GITHUB: 'github',
});

export const OAUTH_PROVIDERS = Object.freeze([AUTH_PROVIDER.GOOGLE, AUTH_PROVIDER.GITHUB]);

/** Short-lived token purposes stored as hashes on the user document. */
export const TOKEN_PURPOSE = Object.freeze({
  EMAIL_VERIFICATION: 'emailVerification',
  PASSWORD_RESET: 'passwordReset',
});

/** Cookie names shared with the frontend. */
export const COOKIE = Object.freeze({
  ACCESS_TOKEN: 'inkflow_access_token',
  REFRESH_TOKEN: 'inkflow_refresh_token',
});

/** Traffic source buckets used by the Analytics dashboard. */
export const TRAFFIC_SOURCE = Object.freeze({
  DIRECT: 'Direct',
  SEARCH: 'Search',
  SOCIAL: 'Social',
  REFERRAL: 'Referral',
});

export const TRAFFIC_SOURCES = Object.freeze(Object.values(TRAFFIC_SOURCE));

/** Reader-type labels surfaced on article cards. */
export const READER_TYPES = Object.freeze([
  'Research Paper',
  'Tutorial',
  'Opinion',
  'Guide',
  'Analysis',
]);

/** Average adult reading speed, used to derive `readingTime`. */
export const WORDS_PER_MINUTE = 200;

/** Pagination defaults applied by the pagination helper. */
export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 12,
  MAX_LIMIT: 100,
});

/** Upload constraints enforced by the multer middleware. */
export const UPLOAD = Object.freeze({
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
  ]),
});
