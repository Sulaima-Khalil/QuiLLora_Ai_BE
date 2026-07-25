import config from '../config/env.js';
import oauthService from '../services/oauth.service.js';
import tokenService from '../services/token.service.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';

/**
 * Short-lived cookie holding the OAuth `state` value.
 *
 * The callback compares the value the provider echoes back against this
 * cookie; a mismatch means the request did not originate here, which is how
 * OAuth CSRF (login-as-attacker) is prevented.
 */
const STATE_COOKIE = 'inkflow_oauth_state';
const REDIRECT_COOKIE = 'inkflow_oauth_redirect';

const stateCookieOptions = () => ({
  httpOnly: true,
  secure: config.cookie.secure,
  // `lax` is required: the provider redirect is a cross-site GET, and `strict`
  // would withhold the cookie exactly when it is needed.
  sameSite: config.cookie.sameSite === 'none' ? 'none' : 'lax',
  domain: config.cookie.domain,
  path: '/',
  maxAge: 10 * 60 * 1000,
});

/** Starts the flow by redirecting the browser to the provider. */
export const startOAuth = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { url, state, redirectTo } = oauthService.buildAuthorizationUrl(provider, {
    redirectTo: req.validatedQuery?.redirectTo ?? req.query?.redirectTo,
  });

  res.cookie(STATE_COOKIE, state, stateCookieOptions());
  res.cookie(REDIRECT_COOKIE, redirectTo, stateCookieOptions());

  return res.redirect(url);
});

/** Same as `startOAuth`, but returns the URL for clients that redirect themselves. */
export const getAuthorizationUrl = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { url, state, redirectTo } = oauthService.buildAuthorizationUrl(provider, {
    redirectTo: req.validatedQuery?.redirectTo ?? req.query?.redirectTo,
  });

  res.cookie(STATE_COOKIE, state, stateCookieOptions());
  res.cookie(REDIRECT_COOKIE, redirectTo, stateCookieOptions());

  return sendSuccess(res, { message: 'Authorization URL', data: { url, provider } });
});

const clearStateCookies = (res) => {
  const options = { ...stateCookieOptions(), maxAge: undefined };
  res.clearCookie(STATE_COOKIE, options);
  res.clearCookie(REDIRECT_COOKIE, options);
};

/**
 * Handles the provider redirect, then bounces the browser back to the
 * frontend with the session cookies already set.
 */
export const oauthCallback = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { code, state, error } = req.validatedQuery ?? req.query;

  const fallbackRedirect = `${config.client.url}/login`;
  const redirectTo = req.cookies?.[REDIRECT_COOKIE] || `${config.client.url}/dashboard`;

  const failureRedirect = (reason) => {
    clearStateCookies(res);
    const url = new URL(fallbackRedirect);
    url.searchParams.set('error', reason);
    return res.redirect(url.toString());
  };

  if (error) {
    logger.warn(`${provider} OAuth denied: ${error}`);
    return failureRedirect('access_denied');
  }

  const expectedState = req.cookies?.[STATE_COOKIE];
  if (!expectedState || expectedState !== state) {
    logger.warn(`${provider} OAuth state mismatch`);
    return failureRedirect('invalid_state');
  }

  try {
    const result = await oauthService.handleCallback(provider, code, {
      userAgent: req.get('user-agent') ?? '',
      ipAddress: req.ip ?? '',
    });

    clearStateCookies(res);
    tokenService.setAuthCookies(res, result.tokens);

    return res.redirect(redirectTo);
  } catch (caught) {
    logger.error(`${provider} OAuth callback failed: ${caught.message}`);
    return failureRedirect(caught.code ?? 'oauth_failed');
  }
});

/**
 * JSON variant of the callback, for clients that complete the exchange
 * themselves (mobile apps, popup flows) rather than following a redirect.
 */
export const exchangeCode = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { code } = req.body;

  if (!code) throw ApiError.badRequest('Authorization code is required');

  const result = await oauthService.handleCallback(provider, code, {
    userAgent: req.get('user-agent') ?? '',
    ipAddress: req.ip ?? '',
  });

  tokenService.setAuthCookies(res, result.tokens);

  return sendSuccess(res, {
    message: `Signed in with ${provider}`,
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      created: result.created,
    },
  });
});

export const unlinkProvider = asyncHandler(async (req, res) => {
  const result = await oauthService.unlinkProvider(req.user._id, req.params.provider);

  return sendSuccess(res, {
    message: `${req.params.provider} account unlinked`,
    data: result,
  });
});

export const listProviders = asyncHandler(async (_req, res) =>
  sendSuccess(res, {
    message: 'Configured providers',
    data: { providers: oauthService.listAvailableProviders() },
  }),
);

export default {
  startOAuth,
  getAuthorizationUrl,
  oauthCallback,
  exchangeCode,
  unlinkProvider,
  listProviders,
};
