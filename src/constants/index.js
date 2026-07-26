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

/* ---------------------------------------------------------------------------
 * Plans and subscriptions
 *
 * The catalogue lives here, on the server, because it is the only copy that
 * may be trusted. A client says which plan it wants by id and nothing else —
 * never a price — so an edited request cannot buy Business for $0.
 *
 * `limits` describes each plan's intended entitlements; ENFORCED_CAPABILITIES
 * below says which of them the API actually refuses work over.
 * ------------------------------------------------------------------------ */

export const PLAN_ID = Object.freeze({
  STARTER: 'starter',
  PRO: 'pro',
  BUSINESS: 'business',
});

export const BILLING_CYCLE = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
});

export const BILLING_CYCLES = Object.freeze(Object.values(BILLING_CYCLE));

/**
 * Subscription lifecycle.
 *
 * `pending_payment` is the honest resting state for an upgrade requested while
 * no payment provider is configured: the intent is recorded, the plan is not
 * granted.
 */
export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING_PAYMENT: 'pending_payment',
  /**
   * A renewal charge failed while the plan is still legitimately held.
   *
   * Declared now because the three states above cannot express it, and without
   * it a failed renewal would force a choice between wrongly revoking access
   * and wrongly reporting "active". Nothing sets it yet — no provider reports
   * payment failures — and no entitlement consults it, so a `past_due` user
   * keeps their plan until a real lifecycle handler decides otherwise.
   */
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
});

export const SUBSCRIPTION_STATUSES = Object.freeze(Object.values(SUBSCRIPTION_STATUS));

/** Prices are whole US dollars per month; `yearly` is the per-month rate. */
export const PLANS = Object.freeze([
  Object.freeze({
    id: PLAN_ID.STARTER,
    name: 'Starter',
    price: Object.freeze({ monthly: 0, yearly: 0 }),
    trialDays: 0,
    limits: Object.freeze({ publishedArticles: 3, aiGenerationsPerDay: 5, teamMembers: 1 }),
  }),
  Object.freeze({
    id: PLAN_ID.PRO,
    name: 'Pro',
    price: Object.freeze({ monthly: 19, yearly: 15 }),
    trialDays: 7,
    limits: Object.freeze({ publishedArticles: null, aiGenerationsPerDay: null, teamMembers: 5 }),
  }),
  Object.freeze({
    id: PLAN_ID.BUSINESS,
    name: 'Business',
    price: Object.freeze({ monthly: 49, yearly: 39 }),
    trialDays: 7,
    limits: Object.freeze({ publishedArticles: null, aiGenerationsPerDay: null, teamMembers: null }),
  }),
]);

export const PLAN_IDS = Object.freeze(PLANS.map((plan) => plan.id));

export const DEFAULT_PLAN_ID = PLAN_ID.STARTER;

/** Plans a user may hold only by paying for them. */
export const PAID_PLAN_IDS = Object.freeze(PLAN_IDS.filter((id) => id !== DEFAULT_PLAN_ID));

/**
 * Which plan limits the API actually refuses work over.
 *
 * Enforcement is per capability, not global, because the three limits are not
 * equally knowable. `publishedArticles` and `teamMembers` are countable from
 * documents we already store, so they are enforced at the service layer.
 *
 * The key is `publishedArticles`, not `articles`, because that is what the
 * plan actually promises: "3 published articles". Drafts are not rationed —
 * naming the limit after what it counts keeps the API from implying they are.
 *
 * `aiGenerationsPerDay` is metered per user per UTC day in the `AiUsage`
 * collection, and claimed atomically so concurrent requests cannot overshoot.
 * It is distinct from the per-minute limiter on the AI routes, which remains
 * an abuse guard and has nothing to do with the plan.
 */
export const ENFORCED_CAPABILITIES = Object.freeze([
  'publishedArticles',
  'teamMembers',
  'aiGenerationsPerDay',
]);

export const isCapabilityEnforced = (capability) => ENFORCED_CAPABILITIES.includes(capability);

/* ---------------------------------------------------------------------------
 * Payment provider — Safepay
 *
 * Safepay is a Pakistani PSP, which is the whole reason it was chosen: the
 * business banks in Pakistan, and Stripe and its peers require a company and
 * bank account in a country we do not have one in.
 *
 * Every literal below is copied from Safepay's official developer
 * documentation and from the official `@sfpy/node-sdk` source, not inferred.
 * See src/services/safepay.service.js for the per-value citations.
 * ------------------------------------------------------------------------ */

export const PAYMENT_PROVIDER = 'safepay';

/** Safepay environments, as the API and checkout hosts are keyed by. */
export const SAFEPAY_ENVIRONMENT = Object.freeze({
  PRODUCTION: 'production',
  SANDBOX: 'sandbox',
  DEVELOPMENT: 'development',
});

export const SAFEPAY_ENVIRONMENTS = Object.freeze(Object.values(SAFEPAY_ENVIRONMENT));

/**
 * Every event type Safepay publishes.
 *
 * The `payment.*`, `authorization.*` and `void.*` events belong to the
 * one-off order flow. This server never creates an order — it only ever opens
 * a subscription checkout — so those arrive only if the same endpoint is
 * shared with another integration, and are recorded and ignored rather than
 * silently dropped.
 */
export const SAFEPAY_EVENT = Object.freeze({
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  AUTHORIZATION_SUCCEEDED: 'authorization.succeeded',
  AUTHORIZATION_REVERSED: 'authorization.reversed',
  VOID_SUCCEEDED: 'void.succeeded',

  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  SUBSCRIPTION_ENDED: 'subscription.ended',
  SUBSCRIPTION_PAUSED: 'subscription.paused',
  SUBSCRIPTION_RESUMED: 'subscription.resumed',
  SUBSCRIPTION_PAYMENT_SUCCEEDED: 'subscription.payment.succeeded',
  SUBSCRIPTION_PAYMENT_FAILED: 'subscription.payment.failed',
});

export const SAFEPAY_EVENTS = Object.freeze(Object.values(SAFEPAY_EVENT));

/** Subscription states Safepay reports in `data.status`. */
export const SAFEPAY_SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  UNPAID: 'UNPAID',
  CANCELED: 'CANCELED',
  INCOMPLETE: 'INCOMPLETE',
  INCOMPLETE_EXPIRED: 'INCOMPLETE_EXPIRED',
  TRAILING: 'TRAILING',
  ENDED: 'ENDED',
  PAUSED: 'PAUSED',
});

/** Header carrying the HMAC-SHA512 digest of the event's `data` object. */
export const SAFEPAY_SIGNATURE_HEADER = 'x-sfpy-signature';

/**
 * How long a checkout intent may sit before a provider event may claim it.
 *
 * A subscription webhook carries no reference back to the intent that started
 * it (see safepay.service.js), so the intent itself is the evidence that this
 * account asked to buy this plan. Evidence that never expires is a standing
 * invitation, so it does not survive a day.
 */
export const CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------------------
 * Payment webhook
 *
 * One shared constant so three places cannot drift apart: the raw-body parser
 * in app.js, the rate limiter's exemption, and the route itself. If any of the
 * three disagreed, signature verification would fail in a way that looks like
 * a provider problem rather than a routing one.
 *
 * Written out in full because the mount points in app.js and routes/index.js
 * are literals (`/api` then `/v1`), not derived from `config.apiPrefix`.
 * ------------------------------------------------------------------------ */

export const PAYMENT_WEBHOOK_PATH = '/api/v1/billing/webhook';

/** Lifecycle of a recorded provider event. */
export const WEBHOOK_EVENT_STATUS = Object.freeze({
  RECEIVED: 'received',
  PROCESSED: 'processed',
  FAILED: 'failed',
  IGNORED: 'ignored',
});

export const WEBHOOK_EVENT_STATUSES = Object.freeze(Object.values(WEBHOOK_EVENT_STATUS));

/** Path as the billing router sees it, after `/api/v1/billing` is stripped. */
export const PAYMENT_WEBHOOK_ROUTE = '/webhook';

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
