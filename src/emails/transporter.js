import nodemailer from 'nodemailer';
import config from '../config/env.js';
import logger from '../utils/logger.js';

let cachedTransporter = null;

/**
 * Development/test fallback.
 *
 * `jsonTransport` renders the message and resolves without a network call, so
 * the whole auth flow (verification links, password resets) is exercisable
 * with no SMTP credentials configured.
 */
const createPreviewTransport = () =>
  nodemailer.createTransport({ jsonTransport: true });

const createSmtpTransport = () =>
  nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.password },
    pool: true,
    maxConnections: 3,
  });

/** Lazily built, then cached, so the pool is shared across requests. */
export const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = config.mail.configured ? createSmtpTransport() : createPreviewTransport();

  if (!config.mail.configured) {
    logger.warn(
      'SMTP is not configured — emails will be logged instead of sent. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to deliver mail.',
    );
  }

  return cachedTransporter;
};

/** Verifies SMTP credentials at boot. Never throws — mail is non-critical. */
export const verifyTransporter = async () => {
  if (!config.mail.configured) return false;

  try {
    await getTransporter().verify();
    logger.info('SMTP transport verified');
    return true;
  } catch (error) {
    logger.error(`SMTP verification failed: ${error.message}`);
    return false;
  }
};

export const closeTransporter = () => {
  cachedTransporter?.close?.();
  cachedTransporter = null;
};

export default getTransporter;
