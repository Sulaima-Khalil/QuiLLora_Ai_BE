import config from '../config/env.js';
import logger from '../utils/logger.js';
import { getTransporter } from './transporter.js';
import {
  passwordChangedTemplate,
  passwordResetTemplate,
  teamInviteTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from './templates.js';

const from = `"${config.mail.fromName}" <${config.mail.fromAddress}>`;

/**
 * Sends one message.
 *
 * Failures are logged and swallowed: a flaky SMTP server must never turn a
 * successful registration into a 500. Callers that need delivery guarantees
 * can inspect the returned `sent` flag.
 */
const send = async ({ to, subject, html, text }) => {
  try {
    const info = await getTransporter().sendMail({ from, to, subject, html, text });

    if (!config.mail.configured) {
      // jsonTransport: surface the payload so links are usable in development.
      logger.info(`[email preview] to=${to} subject="${subject}"`);
      logger.debug(`[email preview] body:\n${text}`);
    } else {
      logger.info(`Email sent to ${to}: ${subject}`);
    }

    return { sent: true, messageId: info?.messageId ?? null };
  } catch (error) {
    logger.error(`Failed to send "${subject}" to ${to}: ${error.message}`);
    return { sent: false, error: error.message };
  }
};

/** Builds a frontend URL, e.g. `https://app/verify-email?token=…`. */
const clientUrl = (path, params = {}) => {
  const url = new URL(path, `${config.client.url}/`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

export const sendVerificationEmail = ({ to, name, token }) => {
  const url = clientUrl('verify-email', { token });
  const expiresInHours = Math.round(config.tokens.emailVerificationTtlMs / (60 * 60 * 1000));

  return send({ to, ...verifyEmailTemplate({ name, url, expiresInHours }) });
};

export const sendPasswordResetEmail = ({ to, name, token, code }) => {
  const url = clientUrl('reset-password', { token });
  const expiresInMinutes = Math.round(config.tokens.passwordResetTtlMs / (60 * 1000));

  return send({ to, ...passwordResetTemplate({ name, url, code, expiresInMinutes }) });
};

export const sendPasswordChangedEmail = ({ to, name }) =>
  send({ to, ...passwordChangedTemplate({ name }) });

export const sendWelcomeEmail = ({ to, name }) =>
  send({ to, ...welcomeTemplate({ name, url: clientUrl('dashboard') }) });

export const sendTeamInviteEmail = ({ to, name, inviterName, workspaceName, role }) =>
  send({
    to,
    ...teamInviteTemplate({
      name,
      inviterName,
      workspaceName,
      role,
      url: clientUrl('register', { email: to }),
    }),
  });

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
  sendTeamInviteEmail,
};
