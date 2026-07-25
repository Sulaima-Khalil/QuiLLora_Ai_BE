import config from '../config/env.js';
import { COOKIE } from '../constants/index.js';
import { tokenRepository } from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { hashToken, randomId } from '../helpers/crypto.helper.js';
import {
  getTokenExpiry,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';

/**
 * Cookie attributes shared by both auth cookies.
 *
 * `httpOnly` keeps tokens out of reach of JavaScript, which is what makes an
 * XSS bug non-fatal for sessions.
 */
const baseCookieOptions = () => ({
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  domain: config.cookie.domain,
  path: '/',
});

/** Issues an access/refresh pair and persists the refresh token's digest. */
export const issueTokenPair = async (user, { userAgent = '', ipAddress = '' } = {}) => {
  const accessToken = signAccessToken({
    sub: String(user._id),
    email: user.email,
    // Checked on every request; a stale value means the password has changed.
    tv: user.tokenVersion ?? 0,
  });

  // `jti` makes every refresh token unique. Without it, two sessions created
  // for the same user within the same second would sign byte-identical JWTs
  // (same sub/iat/exp) and collide on the unique tokenHash index.
  const refreshToken = signRefreshToken({ sub: String(user._id), jti: randomId(16) });
  const expiresAt = getTokenExpiry(refreshToken);

  await tokenRepository.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent: String(userAgent).slice(0, 300),
    ipAddress: String(ipAddress).slice(0, 60),
  });

  return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
};

/**
 * Rotates a refresh token: the presented token is revoked and a new pair
 * issued.
 *
 * If a token that was *already* revoked is presented, it has either been
 * replayed or stolen — every session for that user is revoked in response.
 */
export const rotateRefreshToken = async (presentedToken, { userAgent, ipAddress } = {}) => {
  const payload = verifyRefreshToken(presentedToken);
  const tokenHash = hashToken(presentedToken);

  const stored = await tokenRepository.findByHash(tokenHash);

  if (!stored) {
    throw ApiError.unauthorized('Session not recognised. Please sign in again', {
      code: 'REFRESH_TOKEN_UNKNOWN',
    });
  }

  if (stored.revokedAt) {
    logger.warn(`Refresh token reuse detected for user ${stored.user}. Revoking all sessions.`);
    await tokenRepository.revokeAllForUser(stored.user);
    throw ApiError.unauthorized('Session was revoked. Please sign in again', {
      code: 'REFRESH_TOKEN_REUSED',
    });
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Session has expired. Please sign in again', {
      code: 'REFRESH_TOKEN_EXPIRED',
    });
  }

  return { userId: payload.sub, previousTokenHash: tokenHash, userAgent, ipAddress };
};

/** Revokes the presented refresh token. Safe to call with a junk value. */
export const revokeRefreshToken = async (presentedToken) => {
  if (!presentedToken) return;
  await tokenRepository.revokeByHash(hashToken(presentedToken)).catch(() => {});
};

export const revokeAllSessions = (userId) => tokenRepository.revokeAllForUser(userId);

/** Marks the old token as replaced, preserving the rotation chain. */
export const markRotated = (previousTokenHash, newToken) =>
  tokenRepository.revokeByHash(previousTokenHash, hashToken(newToken));

/**
 * Writes both auth cookies.
 *
 * The access cookie's `maxAge` intentionally matches the refresh window: the
 * JWT's own `exp` governs validity, and a longer-lived cookie lets the client
 * detect an expired token and refresh, rather than appearing signed out.
 */
export const setAuthCookies = (res, { accessToken, refreshToken, refreshTokenExpiresAt }) => {
  const options = baseCookieOptions();
  const maxAge = refreshTokenExpiresAt
    ? Math.max(0, refreshTokenExpiresAt.getTime() - Date.now())
    : undefined;

  res.cookie(COOKIE.ACCESS_TOKEN, accessToken, { ...options, maxAge });
  res.cookie(COOKIE.REFRESH_TOKEN, refreshToken, { ...options, maxAge });
};

export const clearAuthCookies = (res) => {
  const options = baseCookieOptions();
  res.clearCookie(COOKIE.ACCESS_TOKEN, options);
  res.clearCookie(COOKIE.REFRESH_TOKEN, options);
};

/** Reads the refresh token from its cookie, falling back to the body. */
export const extractRefreshToken = (req) =>
  req.cookies?.[COOKIE.REFRESH_TOKEN] || req.body?.refreshToken || null;

export default {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  markRotated,
  setAuthCookies,
  clearAuthCookies,
  extractRefreshToken,
};
