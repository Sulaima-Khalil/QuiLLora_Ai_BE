import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config/env.js';
import { PAYMENT_WEBHOOK_PATH } from '../constants/index.js';
import ApiError from '../utils/ApiError.js';

/** Shared 429 response so limiters match the global error envelope. */
const handler = (_req, _res, next) => {
  next(ApiError.tooManyRequests());
};

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  // Rate limiting is per-test noise and breaks fast integration suites.
  skip: () => config.isTest,
};

/** True for the payment webhook, which carries its own limiter instead. */
const isPaymentWebhook = (req) =>
  (req.originalUrl || '').split('?')[0] === PAYMENT_WEBHOOK_PATH;

/**
 * Broad limiter applied to every API route except the payment webhook.
 *
 * Providers retry aggressively after a failure, and a burst of retries hitting
 * the general per-IP budget would throttle exactly the events needed to fix a
 * subscription. The exemption is narrow — one exact path — and that path is
 * covered by `webhookLimiter` below, so it is never unlimited.
 */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  skip: (req) => base.skip() || isPaymentWebhook(req),
});

/**
 * Generous limiter for the payment webhook.
 *
 * Sized for a provider replaying a backlog, not for a browser. Still bounded,
 * so an unauthenticated public path cannot be used to exhaust the process —
 * signature verification will reject the contents anyway, but that costs CPU.
 */
export const webhookLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 300,
});

/**
 * Tight limiter for credential endpoints, throttling brute-force and
 * credential-stuffing attempts.
 *
 * Keyed on email + IP so one attacker cannot lock out a legitimate user by
 * spamming their address, while still capping attempts per account.
 * `ipKeyGenerator` normalises IPv6 addresses to their /64 prefix.
 */
export const authLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.authMax,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    return `${ipKeyGenerator(req.ip)}:${email}`;
  },
  skipSuccessfulRequests: true,
});

/**
 * Strict limiter for endpoints that send email, which cost money and can be
 * abused to spam a third party.
 */
export const emailLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    return email || ipKeyGenerator(req.ip);
  },
});

/** Limiter for the comparatively expensive AI generation endpoint. */
export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
});

export default apiLimiter;
