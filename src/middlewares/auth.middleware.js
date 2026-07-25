import { COOKIE, TEAM_ROLE } from '../constants/index.js';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Reads the access token from the HTTP-only cookie, falling back to the
 * `Authorization: Bearer` header for non-browser clients (mobile apps, curl).
 */
const extractToken = (req) => {
  const cookieToken = req.cookies?.[COOKIE.ACCESS_TOKEN];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  return null;
};

/**
 * Loads the token's user and re-validates account state on every request, so
 * a deactivated user cannot keep operating on an unexpired token.
 */
const resolveUser = async (token) => {
  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('The account for this token no longer exists');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  if (user.isTokenVersionStale(payload.tv)) {
    throw ApiError.unauthorized('Password was changed recently. Please sign in again', {
      code: 'PASSWORD_CHANGED',
    });
  }

  return user;
};

/** Rejects the request unless a valid access token is present. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  req.user = await resolveUser(token);
  next();
});

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Used by public endpoints that personalise output (e.g. Discover marking
 * which articles the current reader has bookmarked).
 */
export const optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = await resolveUser(token);
  } catch {
    // An invalid token on a public route is treated as "not signed in".
    req.user = undefined;
  }

  return next();
});

/** Requires a verified email address. */
export const requireVerifiedEmail = (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (!req.user.isEmailVerified) {
    return next(ApiError.forbidden('Please verify your email address to continue', {
      code: 'EMAIL_NOT_VERIFIED',
    }));
  }
  return next();
};

/**
 * Restricts a route to the given workspace roles.
 *
 * The workspace owner is implicitly an Admin: they hold no TeamMember row of
 * their own, so an explicit check is required.
 */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));

    const role = req.membership?.role ?? TEAM_ROLE.ADMIN;
    if (!roles.includes(role)) {
      return next(ApiError.forbidden(`This action requires one of: ${roles.join(', ')}`));
    }

    return next();
  };

export default authenticate;
