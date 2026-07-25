import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config/env.js';
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

/** Broad limiter applied to every API route. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
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
