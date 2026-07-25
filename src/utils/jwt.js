import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import ApiError from './ApiError.js';

const ISSUER = 'inkflow-ai';
const AUDIENCE = 'inkflow-ai-client';

/**
 * Short-lived access token.
 * `tokenType` is asserted on verification so a refresh token can never be
 * replayed as an access token (and vice versa), even if the secrets were
 * ever misconfigured to the same value.
 */
export const signAccessToken = (payload) =>
  jwt.sign({ ...payload, tokenType: 'access' }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });

/**
 * Long-lived refresh token.
 * @param {object} payload
 * @param {string} payload.sub User id.
 * @param {string} payload.jti Refresh-token document id, enabling revocation.
 */
export const signRefreshToken = (payload) =>
  jwt.sign({ ...payload, tokenType: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });

const verify = (token, secret, expectedType) => {
  let decoded;

  try {
    decoded = jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Token has expired', { code: 'TOKEN_EXPIRED', cause: error });
    }
    throw ApiError.unauthorized('Invalid token', { code: 'TOKEN_INVALID', cause: error });
  }

  if (decoded.tokenType !== expectedType) {
    throw ApiError.unauthorized(`Expected a ${expectedType} token`, { code: 'TOKEN_INVALID' });
  }

  return decoded;
};

export const verifyAccessToken = (token) => verify(token, config.jwt.accessSecret, 'access');

export const verifyRefreshToken = (token) => verify(token, config.jwt.refreshSecret, 'refresh');

/** Expiry as a Date, used to set the refresh-token document's TTL. */
export const getTokenExpiry = (token) => {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000) : null;
};

export default {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getTokenExpiry,
};
