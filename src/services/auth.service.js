import config from '../config/env.js';
import { AUTH_PROVIDER, MEMBER_STATUS, TEAM_ROLE } from '../constants/index.js';
import { teamRepository, tokenRepository, userRepository } from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { serializeUser } from '../utils/serializers.js';
import { generateNumericCode, generateSecureToken, hashToken } from '../helpers/crypto.helper.js';
import { hashPassword } from '../helpers/password.helper.js';
import mailer from '../emails/mailer.js';
import tokenService from './token.service.js';

/** Fresh email-verification token, stored hashed on the user document. */
const attachVerificationToken = (user) => {
  const { raw, hashed } = generateSecureToken();
  user.emailVerificationToken = hashed;
  user.emailVerificationExpires = new Date(Date.now() + config.tokens.emailVerificationTtlMs);
  return raw;
};

/**
 * Registers a new account.
 *
 * The user is signed in immediately (matching the frontend, which navigates
 * straight to /verify-email with an active session) while the verification
 * email is dispatched in the background.
 */
export const register = async ({ name, username, email, password, country, newsletter }, context = {}) => {
  if (await userRepository.existsByEmail(email)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  if (username && (await userRepository.existsByUsername(username))) {
    throw ApiError.conflict('That username is already taken');
  }

  // The model's pre-save hook hashes the password.
  const user = await userRepository.create({
    name,
    username: username || undefined,
    email,
    password,
    country: country ?? '',
    newsletterOptIn: Boolean(newsletter),
    authProvider: AUTH_PROVIDER.LOCAL,
  });

  const rawToken = attachVerificationToken(user);
  await user.save();

  // A pending invite for this address becomes an active membership.
  await teamRepository
    .claimInvitesForUser(user._id, user.email, MEMBER_STATUS.ACTIVE)
    .catch((error) => logger.warn(`Failed to claim invites for ${user.email}: ${error.message}`));

  await mailer.sendVerificationEmail({ to: user.email, name: user.name, token: rawToken });

  const tokens = await tokenService.issueTokenPair(user, context);

  return { user: serializeUser(user), tokens };
};

/** Authenticates with email + password. */
export const login = async ({ email, password }, context = {}) => {
  const user = await userRepository.findByEmailWithPassword(email);

  // One generic message for both branches — revealing which failed would let
  // an attacker enumerate registered addresses.
  const invalid = ApiError.unauthorized('Invalid email or password');

  if (!user) throw invalid;

  if (!user.password) {
    const providers = user.oauthAccounts.map((account) => account.provider).join(' or ');
    throw ApiError.badRequest(
      `This account was created with ${providers || 'a social provider'}. Sign in with ${providers || 'it'}, or use "Forgot password" to set one.`,
      { code: 'NO_PASSWORD_SET' },
    );
  }

  if (!(await user.comparePassword(password))) throw invalid;

  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const tokens = await tokenService.issueTokenPair(user, context);

  return { user: serializeUser(user), tokens };
};

/** Revokes the presented refresh token. */
export const logout = async (refreshToken) => {
  await tokenService.revokeRefreshToken(refreshToken);
  return { message: 'Logged out successfully' };
};

/** Revokes every session for the user. */
export const logoutAll = async (userId) => {
  await tokenService.revokeAllSessions(userId);
  return { message: 'Signed out of all devices' };
};

/** Exchanges a valid refresh token for a fresh pair (with rotation). */
export const refresh = async (presentedToken, context = {}) => {
  if (!presentedToken) throw ApiError.unauthorized('No refresh token provided');

  const { userId, previousTokenHash } = await tokenService.rotateRefreshToken(presentedToken, context);

  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.unauthorized('The account for this session no longer exists');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  const tokens = await tokenService.issueTokenPair(user, context);
  await tokenService.markRotated(previousTokenHash, tokens.refreshToken);

  return { user: serializeUser(user), tokens };
};

/** Confirms an email address using the token from the verification link. */
export const verifyEmail = async (rawToken) => {
  const user = await userRepository.findByActiveToken(
    'emailVerificationToken',
    'emailVerificationExpires',
    hashToken(rawToken),
  );

  if (!user) {
    throw ApiError.badRequest('This verification link is invalid or has expired', {
      code: 'VERIFICATION_TOKEN_INVALID',
    });
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  await mailer.sendWelcomeEmail({ to: user.email, name: user.name });

  return { user: serializeUser(user) };
};

/** Re-sends the verification email. */
export const resendVerification = async (email) => {
  const user = await userRepository.findByEmail(email);
  const genericResponse = { message: 'If that account exists and is unverified, a new link has been sent' };

  if (!user || user.isEmailVerified) return genericResponse;

  const rawToken = attachVerificationToken(user);
  await user.save({ validateBeforeSave: false });

  await mailer.sendVerificationEmail({ to: user.email, name: user.name, token: rawToken });

  return genericResponse;
};

/**
 * Starts the password reset flow.
 *
 * Always reports success regardless of whether the address exists, so the
 * endpoint cannot be used to enumerate accounts.
 */
export const forgotPassword = async (email) => {
  const user = await userRepository.findByEmail(email);
  const genericResponse = { message: 'If an account exists for that email, a reset code has been sent' };

  if (!user || !user.isActive) return genericResponse;

  // Two credentials for one reset: a high-entropy token for the emailed link,
  // and a 6-digit code for people who prefer to type it. Issuing both means
  // either entry point works without weakening the link.
  const { raw: rawToken, hashed: hashedToken } = generateSecureToken();
  const { raw: rawCode, hashed: hashedCode } = generateNumericCode(6);

  user.passwordResetToken = hashedToken;
  user.passwordResetCode = hashedCode;
  user.passwordResetCodeAttempts = 0;
  user.passwordResetExpires = new Date(Date.now() + config.tokens.passwordResetTtlMs);
  await user.save({ validateBeforeSave: false });

  await mailer.sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token: rawToken,
    code: rawCode,
  });

  return genericResponse;
};

/** Maximum wrong guesses before the code is discarded. */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Loads the user behind an unexpired reset credential.
 *
 * Accepts either the emailed link token or the `email` + 6-digit `code` pair.
 * A wrong code increments a counter and burns the code once the limit is hit,
 * so the small numeric space cannot be walked even if rate limits are evaded.
 */
const resolveResetTarget = async ({ token, code, email }) => {
  if (token) {
    const user = await userRepository.findByActiveToken(
      'passwordResetToken',
      'passwordResetExpires',
      hashToken(token),
    );
    if (user) return user;
  }

  if (!code || !email) return null;

  const user = await userRepository.findByEmailWithResetCode(email);

  if (!user || !user.passwordResetCode) return null;
  if (!user.passwordResetExpires || user.passwordResetExpires.getTime() <= Date.now()) return null;

  if (user.passwordResetCode !== hashToken(code)) {
    user.passwordResetCodeAttempts = (user.passwordResetCodeAttempts ?? 0) + 1;

    if (user.passwordResetCodeAttempts >= MAX_CODE_ATTEMPTS) {
      user.passwordResetCode = undefined;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
    }

    await user.save({ validateBeforeSave: false });
    return null;
  }

  return user;
};

/**
 * Checks a 6-digit code without consuming it, so step 2 of the recovery flow
 * can advance to the password form before the reset is actually performed.
 */
export const verifyResetCode = async ({ email, code }) => {
  const user = await resolveResetTarget({ code, email });

  if (!user) {
    throw ApiError.badRequest('That code is incorrect or has expired', {
      code: 'RESET_CODE_INVALID',
    });
  }

  return { verified: true, email: user.email };
};

/**
 * Completes a password reset and invalidates every existing session.
 * Accepts either the emailed link token or the `email` + `code` pair.
 */
export const resetPassword = async ({ token, code, email, password }) => {
  const user = await resolveResetTarget({ token, code, email });

  if (!user) {
    throw ApiError.badRequest(
      token
        ? 'This reset link is invalid or has expired'
        : 'That code is incorrect or has expired',
      { code: token ? 'RESET_TOKEN_INVALID' : 'RESET_CODE_INVALID' },
    );
  }

  user.password = password; // Hashed by the pre-save hook.

  // Both credentials are single-use, so clear them together.
  user.passwordResetToken = undefined;
  user.passwordResetCode = undefined;
  user.passwordResetCodeAttempts = 0;
  user.passwordResetExpires = undefined;
  await user.save();

  // A reset is a security event: assume the old sessions are compromised.
  await tokenRepository.revokeAllForUser(user._id);
  await mailer.sendPasswordChangedEmail({ to: user.email, name: user.name });

  return { message: 'Password has been reset. Please sign in with your new password' };
};

/** Changes the password of an already-authenticated user. */
export const changePassword = async (userId, { currentPassword, newPassword }, context = {}) => {
  const user = await userRepository.findById(userId, { select: '+password +passwordChangedAt' });
  if (!user) throw ApiError.notFound('User not found');

  if (user.password) {
    if (!currentPassword) throw ApiError.badRequest('Your current password is required');
    if (!(await user.comparePassword(currentPassword))) {
      throw ApiError.unauthorized('Your current password is incorrect');
    }
    if (await user.comparePassword(newPassword)) {
      throw ApiError.badRequest('Your new password must differ from the current one');
    }
  }

  user.password = newPassword;
  await user.save();

  // Every other device is signed out, then this one is re-issued a pair so
  // the caller is not logged out of the session they initiated the change from.
  await tokenRepository.revokeAllForUser(user._id);
  const tokens = await tokenService.issueTokenPair(user, context);

  await mailer.sendPasswordChangedEmail({ to: user.email, name: user.name });

  return { user: serializeUser(user), tokens, message: 'Password updated successfully' };
};

/** Sets an initial password for an OAuth-only account. */
export const setInitialPassword = async (userId, newPassword) => {
  const user = await userRepository.findById(userId, { select: '+password' });
  if (!user) throw ApiError.notFound('User not found');
  if (user.password) throw ApiError.badRequest('This account already has a password. Use change-password instead');

  user.password = await hashPassword(newPassword);
  user.markModified('password');
  await user.save({ validateBeforeSave: false });

  return { message: 'Password set successfully' };
};

/** Active sessions, for the Security panel on the Settings page. */
export const listSessions = async (userId, currentRefreshToken) => {
  const tokens = await tokenRepository.listActiveForUser(userId);
  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  return tokens.map((token) => ({
    id: String(token._id),
    userAgent: token.userAgent || 'Unknown device',
    ipAddress: token.ipAddress || '',
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    current: token.tokenHash === currentHash,
  }));
};

/** The caller's role in their own workspace, plus workspaces they joined. */
export const resolveMemberships = async (user) => {
  const memberships = await teamRepository.findMembershipsForUser(user._id, user.email);

  return {
    ownWorkspaceRole: TEAM_ROLE.ADMIN,
    memberships: memberships.map((member) => ({
      workspaceOwner: String(member.workspaceOwner),
      role: member.role,
      status: member.status,
    })),
  };
};

export default {
  register,
  login,
  logout,
  logoutAll,
  refresh,
  verifyEmail,
  resendVerification,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
  setInitialPassword,
  listSessions,
  resolveMemberships,
};
