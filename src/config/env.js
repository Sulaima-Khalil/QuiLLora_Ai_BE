import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { PAYMENT_PROVIDER as PROVIDER_SAFEPAY } from '../constants/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — used to resolve `.env` and the uploads directory. */
export const ROOT_DIR = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

/**
 * Comma-separated list -> trimmed string array.
 * Accepts `a, b ,c` and ignores empty segments.
 */
const csv = () =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );

/** Accepts `true/1/yes` (case-insensitive) as true. */
const boolish = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === ''
        ? defaultValue
        : ['true', '1', 'yes', 'on'].includes(value.toLowerCase()),
    );

const intish = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? defaultValue : Number(value)))
    .pipe(z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intish(4000),
  API_PREFIX: z.string().default('/api/v1'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  BCRYPT_SALT_ROUNDS: intish(12),

  CLIENT_URL: z.string().trim().url().default('http://localhost:5173'),
  CORS_ORIGINS: csv(),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: boolish(false),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  RATE_LIMIT_WINDOW_MINUTES: intish(15),
  RATE_LIMIT_MAX: intish(300),
  AUTH_RATE_LIMIT_MAX: intish(20),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: intish(587),
  SMTP_SECURE: boolish(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('InkFlow AI'),
  MAIL_FROM_ADDRESS: z.string().default('no-reply@inkflow.ai'),

  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: intish(24),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: intish(60),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().optional(),

  /*
   * Safepay — the payment provider.
   *
   * All four credentials are required together before billing switches on;
   * any one missing leaves the API reporting "payment not configured" rather
   * than half-attempting a charge. They are read here and never leave the
   * server: no route serialises them, and the checkout response carries a URL
   * and nothing else.
   *
   * Names match Safepay's own vocabulary (`@sfpy/node-sdk` takes exactly
   * `environment`, `apiKey`, `v1Secret` and `webhookSecret`).
   */
  SAFEPAY_ENVIRONMENT: z.enum(['sandbox', 'production', 'development']).optional(),
  /** Merchant API key, `sec_…`, from Dashboard > Developers > API Keys. */
  SAFEPAY_API_KEY: z.string().optional(),
  /** Merchant secret, sent as `X-SFPY-MERCHANT-SECRET` on server-to-server calls. */
  SAFEPAY_V1_SECRET: z.string().optional(),
  /** Shared secret for the HMAC-SHA512 webhook signature, from Developers > Endpoints. */
  SAFEPAY_WEBHOOK_SECRET: z.string().optional(),

  /*
   * Safepay recurring plan tokens (`plan_…`), one per plan and cycle.
   *
   * The amount and currency of a subscription live on the Safepay plan, not
   * here and certainly not in a request body: a checkout names a plan token
   * and Safepay charges whatever that plan says. That is the strongest form
   * of "the client cannot control the price" available — this server cannot
   * control it either.
   *
   * Left unset by default. Inventing placeholders would let a checkout be
   * attempted against plans that do not exist.
   */
  SAFEPAY_PLAN_PRO_MONTHLY: z.string().optional(),
  SAFEPAY_PLAN_PRO_YEARLY: z.string().optional(),
  SAFEPAY_PLAN_BUSINESS_MONTHLY: z.string().optional(),
  SAFEPAY_PLAN_BUSINESS_YEARLY: z.string().optional(),

  UPLOAD_DIR: z.string().default('uploads'),
  SERVE_UPLOADS: boolish(true),

  ENABLE_CRON: boolish(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  // Fail fast and loudly: a half-configured process is worse than no process.
  throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example for the full list.`);
}

const raw = parsed.data;

const isProduction = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

/**
 * Origins allowed by CORS. CLIENT_URL is always trusted so a minimal `.env`
 * (just CLIENT_URL) works without also filling in CORS_ORIGINS.
 */
const corsOrigins = [...new Set([raw.CLIENT_URL, ...raw.CORS_ORIGINS])];

const smtpConfigured = Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASSWORD);

const clientUrl = raw.CLIENT_URL.replace(/\/$/, '');

/**
 * Safepay is on only when every credential is present.
 *
 * All four are load-bearing and none substitutes for another: the API key
 * identifies the merchant on the event envelope, the v1 secret authenticates
 * server-to-server calls, and the webhook secret is the only thing standing
 * between a forged POST and a free Business plan. Three out of four is not a
 * working integration, so it is treated as none.
 */
const safepayConfigured = Boolean(
  raw.SAFEPAY_ENVIRONMENT &&
    raw.SAFEPAY_API_KEY &&
    raw.SAFEPAY_V1_SECRET &&
    raw.SAFEPAY_WEBHOOK_SECRET,
);

export const config = Object.freeze({
  env: raw.NODE_ENV,
  isProduction,
  isDevelopment: raw.NODE_ENV === 'development',
  isTest,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  logLevel: raw.LOG_LEVEL,

  db: Object.freeze({
    uri: raw.MONGO_URI,
  }),

  jwt: Object.freeze({
    accessSecret: raw.JWT_ACCESS_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    accessExpiresIn: raw.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: raw.JWT_REFRESH_EXPIRES_IN,
  }),

  security: Object.freeze({
    bcryptSaltRounds: raw.BCRYPT_SALT_ROUNDS,
  }),

  client: Object.freeze({
    url: clientUrl,
    corsOrigins,
  }),

  cookie: Object.freeze({
    domain: raw.COOKIE_DOMAIN || undefined,
    // SameSite=None is meaningless (and rejected by browsers) without Secure.
    secure: raw.COOKIE_SECURE || raw.COOKIE_SAME_SITE === 'none',
    sameSite: raw.COOKIE_SAME_SITE,
  }),

  rateLimit: Object.freeze({
    windowMs: raw.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max: raw.RATE_LIMIT_MAX,
    authMax: raw.AUTH_RATE_LIMIT_MAX,
  }),

  mail: Object.freeze({
    configured: smtpConfigured,
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    secure: raw.SMTP_SECURE,
    user: raw.SMTP_USER,
    password: raw.SMTP_PASSWORD,
    fromName: raw.MAIL_FROM_NAME,
    fromAddress: raw.MAIL_FROM_ADDRESS,
  }),

  tokens: Object.freeze({
    emailVerificationTtlMs: raw.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    passwordResetTtlMs: raw.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000,
  }),

  oauth: Object.freeze({
    google: Object.freeze({
      configured: Boolean(raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET),
      clientId: raw.GOOGLE_CLIENT_ID,
      clientSecret: raw.GOOGLE_CLIENT_SECRET,
      callbackUrl: raw.GOOGLE_CALLBACK_URL,
    }),
    groq: Object.freeze({
      apiKey: raw.GROQ_API_KEY ?? null,
      configured: Boolean(raw.GROQ_API_KEY),
    }),
    github: Object.freeze({
      configured: Boolean(raw.GITHUB_CLIENT_ID && raw.GITHUB_CLIENT_SECRET),
      clientId: raw.GITHUB_CLIENT_ID,
      clientSecret: raw.GITHUB_CLIENT_SECRET,
      callbackUrl: raw.GITHUB_CALLBACK_URL,
    }),
  }),

  /**
   * Billing. `provider` being null is what makes the API answer "payment is
   * not available"; the secrets stay on this object and are never serialized
   * to a client.
   */
  payments: Object.freeze({
    provider: safepayConfigured ? PROVIDER_SAFEPAY : null,
    configured: safepayConfigured,

    safepay: Object.freeze({
      configured: safepayConfigured,
      environment: raw.SAFEPAY_ENVIRONMENT ?? null,
      apiKey: raw.SAFEPAY_API_KEY ?? null,
      v1Secret: raw.SAFEPAY_V1_SECRET ?? null,
      webhookSecret: raw.SAFEPAY_WEBHOOK_SECRET ?? null,

      /**
       * `{ [planId]: { monthly, yearly } }`, values null until configured.
       *
       * A missing token is a visible null rather than an undefined lookup, so
       * "Pro yearly is not set up" is a clean 503 instead of a checkout URL
       * pointing at a plan that does not exist. The free plan is absent by
       * design: it is never bought.
       */
      planIds: Object.freeze({
        pro: Object.freeze({
          monthly: raw.SAFEPAY_PLAN_PRO_MONTHLY ?? null,
          yearly: raw.SAFEPAY_PLAN_PRO_YEARLY ?? null,
        }),
        business: Object.freeze({
          monthly: raw.SAFEPAY_PLAN_BUSINESS_MONTHLY ?? null,
          yearly: raw.SAFEPAY_PLAN_BUSINESS_YEARLY ?? null,
        }),
      }),

      /**
       * Where Safepay returns the shopper's browser.
       *
       * Derived from CLIENT_URL rather than configured separately: two URLs
       * that must agree with the frontend's routes are two URLs that can drift
       * from them. Neither destination grants anything — the success page only
       * re-reads the server's answer.
       */
      redirectUrl: `${clientUrl}/dashboard/upgrade/success`,
      cancelUrl: `${clientUrl}/dashboard/upgrade?checkout=cancelled`,
    }),
  }),

  uploads: Object.freeze({
    dir: path.isAbsolute(raw.UPLOAD_DIR) ? raw.UPLOAD_DIR : path.join(ROOT_DIR, raw.UPLOAD_DIR),
    publicPath: '/uploads',
    serve: raw.SERVE_UPLOADS,
  }),

  jobs: Object.freeze({
    // Background timers keep the Jest process alive, so never schedule in tests.
    enabled: raw.ENABLE_CRON && !isTest,
  }),
});

export default config;
