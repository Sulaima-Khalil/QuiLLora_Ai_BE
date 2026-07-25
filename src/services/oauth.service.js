import config from '../config/env.js';
import { AUTH_PROVIDER, MEMBER_STATUS } from '../constants/index.js';
import { teamRepository, userRepository } from '../repositories/index.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { serializeUser } from '../utils/serializers.js';
import { randomId } from '../helpers/crypto.helper.js';
import tokenService from './token.service.js';

/**
 * OAuth 2.0 authorization-code flow for Google and GitHub.
 *
 * Implemented directly against the providers' HTTP endpoints using the global
 * `fetch` in Node 20 — Passport would add a session dependency this stateless,
 * cookie-JWT API does not otherwise need.
 *
 * Both providers stay dormant until their client id/secret are configured;
 * the routes then report 503 rather than failing obscurely.
 */

const PROVIDERS = {
  [AUTH_PROVIDER.GOOGLE]: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    settings: () => config.oauth.google,
    /** @param {any} raw */
    normalize: (raw) => ({
      providerAccountId: raw.sub,
      email: raw.email?.toLowerCase(),
      emailVerified: Boolean(raw.email_verified),
      name: raw.name || raw.email?.split('@')[0],
      avatar: raw.picture || '',
    }),
  },

  [AUTH_PROVIDER.GITHUB]: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    emailsUrl: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
    settings: () => config.oauth.github,
    normalize: (raw) => ({
      providerAccountId: String(raw.id),
      email: raw.email?.toLowerCase(),
      emailVerified: Boolean(raw.emailVerified),
      name: raw.name || raw.login,
      avatar: raw.avatar_url || '',
      username: raw.login,
    }),
  },
};

const getProvider = (name) => {
  const provider = PROVIDERS[name];
  if (!provider) throw ApiError.badRequest(`Unsupported OAuth provider '${name}'`);

  const settings = provider.settings();
  if (!settings.configured) {
    throw new ApiError(503, `${name} sign-in is not configured on this server`, {
      code: 'OAUTH_NOT_CONFIGURED',
    });
  }

  return { provider, settings };
};

export const isProviderConfigured = (name) => Boolean(PROVIDERS[name]?.settings().configured);

/** Providers the client should render buttons for. */
export const listAvailableProviders = () =>
  Object.keys(PROVIDERS).filter((name) => isProviderConfigured(name));

const callbackUrl = (name, settings) =>
  settings.callbackUrl || `${config.client.url}/auth/${name}/callback`;

/**
 * Builds the provider's consent URL.
 *
 * `state` is an unguessable value the caller stores in a short-lived cookie
 * and re-checks on the callback — this is the CSRF defence for OAuth.
 */
export const buildAuthorizationUrl = (name, { redirectTo } = {}) => {
  const { provider, settings } = getProvider(name);

  const state = randomId(24);
  const url = new URL(provider.authorizeUrl);

  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(name, settings));
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');

  if (name === AUTH_PROVIDER.GOOGLE) {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');
  }

  return { url: url.toString(), state, redirectTo: redirectTo || `${config.client.url}/dashboard` };
};

/** Exchanges the authorization code for an access token. */
const exchangeCode = async (name, code) => {
  const { provider, settings } = getProvider(name);

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: callbackUrl(name, settings),
      grant_type: 'authorization_code',
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error || !payload.access_token) {
    logger.error(`${name} token exchange failed: ${payload.error_description || payload.error || response.status}`);
    throw ApiError.unauthorized(`Could not complete ${name} sign-in`, { code: 'OAUTH_EXCHANGE_FAILED' });
  }

  return payload.access_token;
};

/** Fetches the provider's profile for the authenticated user. */
const fetchProfile = async (name, accessToken) => {
  const { provider } = getProvider(name);

  const response = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'inkflow-ai-backend',
    },
  });

  if (!response.ok) {
    throw ApiError.unauthorized(`Could not read your ${name} profile`, { code: 'OAUTH_PROFILE_FAILED' });
  }

  const raw = await response.json();

  // GitHub omits the email from /user when the user has it set to private,
  // so the verified primary address is fetched separately.
  if (name === AUTH_PROVIDER.GITHUB && !raw.email && provider.emailsUrl) {
    const emailsResponse = await fetch(provider.emailsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'inkflow-ai-backend',
      },
    });

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json();
      const primary = emails.find((entry) => entry.primary && entry.verified) || emails.find((entry) => entry.verified);
      raw.email = primary?.email;
      raw.emailVerified = Boolean(primary?.verified);
    }
  }

  const profile = provider.normalize(raw);

  if (!profile.email) {
    throw ApiError.badRequest(
      `Your ${name} account has no accessible email address. Add a verified email there, or register with email and password.`,
      { code: 'OAUTH_NO_EMAIL' },
    );
  }

  return profile;
};

/**
 * Finds or provisions the local account for an OAuth identity.
 *
 * Linking by email is only safe because the providers we support assert the
 * address is verified; an unverified provider email is rejected rather than
 * silently linked, which would otherwise be an account-takeover vector.
 */
const findOrCreateUser = async (name, profile) => {
  const existingByProvider = await userRepository.findByOAuthAccount(name, profile.providerAccountId);
  if (existingByProvider) return { user: existingByProvider, created: false };

  const existingByEmail = await userRepository.findByEmail(profile.email);

  if (existingByEmail) {
    if (!profile.emailVerified) {
      throw ApiError.conflict(
        `An account already exists for ${profile.email}. Sign in with your password to link ${name}.`,
        { code: 'OAUTH_EMAIL_UNVERIFIED' },
      );
    }

    existingByEmail.oauthAccounts.push({
      provider: name,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
    });

    if (!existingByEmail.avatar && profile.avatar) existingByEmail.avatar = profile.avatar;
    existingByEmail.isEmailVerified = true;

    await existingByEmail.save({ validateBeforeSave: false });
    return { user: existingByEmail, created: false };
  }

  // Only claim the provider's username when it is not already taken locally.
  const username =
    profile.username && !(await userRepository.existsByUsername(profile.username))
      ? profile.username
      : undefined;

  const user = await userRepository.create({
    name: profile.name,
    email: profile.email,
    username,
    avatar: profile.avatar,
    isEmailVerified: Boolean(profile.emailVerified),
    authProvider: name,
    oauthAccounts: [
      { provider: name, providerAccountId: profile.providerAccountId, email: profile.email },
    ],
  });

  await teamRepository
    .claimInvitesForUser(user._id, user.email, MEMBER_STATUS.ACTIVE)
    .catch((error) => logger.warn(`Failed to claim invites for ${user.email}: ${error.message}`));

  return { user, created: true };
};

/** Completes the callback: code -> profile -> local session. */
export const handleCallback = async (name, code, context = {}) => {
  const accessToken = await exchangeCode(name, code);
  const profile = await fetchProfile(name, accessToken);
  const { user, created } = await findOrCreateUser(name, profile);

  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const tokens = await tokenService.issueTokenPair(user, context);

  return { user: serializeUser(user), tokens, created };
};

/** Unlinks a provider, refusing to strip the account's only sign-in method. */
export const unlinkProvider = async (userId, name) => {
  const user = await userRepository.findById(userId, { select: '+password' });
  if (!user) throw ApiError.notFound('User not found');

  const remaining = user.oauthAccounts.filter((account) => account.provider !== name);

  if (remaining.length === user.oauthAccounts.length) {
    throw ApiError.badRequest(`No linked ${name} account was found`);
  }

  if (remaining.length === 0 && !user.password) {
    throw ApiError.badRequest(
      'Set a password before unlinking your last sign-in provider, or you will be locked out',
      { code: 'LAST_AUTH_METHOD' },
    );
  }

  user.oauthAccounts = remaining;
  if (user.authProvider === name) {
    user.authProvider = remaining[0]?.provider ?? AUTH_PROVIDER.LOCAL;
  }

  await user.save({ validateBeforeSave: false });

  return { user: serializeUser(user) };
};

export default {
  isProviderConfigured,
  listAvailableProviders,
  buildAuthorizationUrl,
  handleCallback,
  unlinkProvider,
};
