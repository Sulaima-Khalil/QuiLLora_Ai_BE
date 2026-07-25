import bcrypt from 'bcryptjs';
import config from '../config/env.js';

/** Hashes a plaintext password with the configured cost factor. */
export const hashPassword = (plainPassword) =>
  bcrypt.hash(plainPassword, config.security.bcryptSaltRounds);

/**
 * Constant-time password comparison.
 *
 * Returns false (rather than throwing) when the account has no password —
 * OAuth-only users legitimately have none.
 */
export const verifyPassword = async (plainPassword, passwordHash) => {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
};

export default { hashPassword, verifyPassword };
