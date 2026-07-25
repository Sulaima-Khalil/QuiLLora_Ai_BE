import config from '../config/env.js';
import authService from '../services/auth.service.js';
import tokenService from '../services/token.service.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendCreated, sendSuccess } from '../utils/ApiResponse.js';
import { serializeUser } from '../utils/serializers.js';

/** Request metadata recorded against each issued session. */
const sessionContext = (req) => ({
  userAgent: req.get('user-agent') ?? '',
  ipAddress: req.ip ?? '',
});

/**
 * Writes the auth cookies and returns the body.
 *
 * The tokens are also included in the JSON payload so non-browser clients
 * (and the frontend's `Authorization` header fallback) can use them.
 */
const respondWithSession = (res, { user, tokens }, { statusCode = 200, message }) => {
  tokenService.setAuthCookies(res, tokens);

  return sendSuccess(res, {
    statusCode,
    message,
    data: {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.refreshTokenExpiresAt,
    },
  });
};

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, sessionContext(req));

  tokenService.setAuthCookies(res, result.tokens);

  return sendCreated(res, {
    message: 'Account created. Check your inbox to verify your email address.',
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.refreshTokenExpiresAt,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, sessionContext(req));
  return respondWithSession(res, result, { message: 'Signed in successfully' });
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = tokenService.extractRefreshToken(req);

  const result = await authService.logout(refreshToken);
  tokenService.clearAuthCookies(res);

  return sendSuccess(res, { message: result.message });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAll(req.user._id);
  tokenService.clearAuthCookies(res);

  return sendSuccess(res, { message: result.message });
});

export const refresh = asyncHandler(async (req, res) => {
  const presentedToken = tokenService.extractRefreshToken(req);

  try {
    const result = await authService.refresh(presentedToken, sessionContext(req));
    return respondWithSession(res, result, { message: 'Session refreshed' });
  } catch (error) {
    // A dead session must not leave stale cookies behind, or the client will
    // retry with the same rejected token forever.
    tokenService.clearAuthCookies(res);
    throw error;
  }
});

/** The signed-in user — used by the frontend to restore session on load. */
export const me = asyncHandler(async (req, res) =>
  sendSuccess(res, { message: 'Current user', data: { user: serializeUser(req.user) } }),
);

export const verifyEmail = asyncHandler(async (req, res) => {
  // Accepts the token from a POST body or a GET link's query string.
  const token = req.body?.token ?? req.validatedQuery?.token;
  const result = await authService.verifyEmail(token);

  return sendSuccess(res, { message: 'Email verified successfully', data: result });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email);
  return sendSuccess(res, { message: result.message });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  return sendSuccess(res, { message: result.message });
});

/** Step 2 of the code recovery flow: validate without consuming the code. */
export const verifyResetCode = asyncHandler(async (req, res) => {
  const result = await authService.verifyResetCode(req.body);
  return sendSuccess(res, { message: 'Code verified', data: result });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);

  // Every session was revoked, so any cookies this client holds are dead.
  tokenService.clearAuthCookies(res);

  return sendSuccess(res, { message: result.message });
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.user._id, req.body, sessionContext(req));

  return respondWithSession(
    res,
    { user: result.user, tokens: result.tokens },
    { message: result.message },
  );
});

export const setPassword = asyncHandler(async (req, res) => {
  const result = await authService.setInitialPassword(req.user._id, req.body.password);
  return sendSuccess(res, { message: result.message });
});

export const listSessions = asyncHandler(async (req, res) => {
  const refreshToken = tokenService.extractRefreshToken(req);
  const sessions = await authService.listSessions(req.user._id, refreshToken);

  return sendSuccess(res, { message: 'Active sessions', data: { sessions } });
});

/** Reports which OAuth providers are configured, so the UI can hide the rest. */
export const authConfig = asyncHandler(async (_req, res) => {
  const { listAvailableProviders } = await import('../services/oauth.service.js');

  return sendSuccess(res, {
    message: 'Auth configuration',
    data: {
      providers: listAvailableProviders(),
      emailVerificationRequired: false,
      clientUrl: config.client.url,
    },
  });
});

/** Guards against a missing body on endpoints that require one. */
export const requireBody = (req, _res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return next(ApiError.badRequest('Request body is required'));
  }
  return next();
};

export default {
  register,
  login,
  logout,
  logoutAll,
  refresh,
  me,
  verifyEmail,
  resendVerification,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
  setPassword,
  listSessions,
  authConfig,
};
