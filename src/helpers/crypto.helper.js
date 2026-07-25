import crypto from 'node:crypto';

/**
 * Generates a single-use token pair.
 *
 * Only `hashed` is persisted. A database leak therefore cannot be replayed
 * against the verification or password-reset endpoints, and SHA-256 (rather
 * than bcrypt) is appropriate here because the input already has 256 bits of
 * entropy — brute force is infeasible without a slow KDF.
 *
 * @returns {{ raw: string, hashed: string }} `raw` goes in the email link.
 */
export const generateSecureToken = (bytes = 32) => {
  const raw = crypto.randomBytes(bytes).toString('hex');
  return { raw, hashed: hashToken(raw) };
};

/** SHA-256 hex digest — the form stored in MongoDB. */
export const hashToken = (rawToken) => crypto.createHash('sha256').update(String(rawToken)).digest('hex');

/**
 * Generates a numeric one-time code for the "type the code from your email"
 * recovery flow.
 *
 * Uses `randomInt`, which is rejection-sampled and therefore free of the
 * modulo bias `randomBytes % 10` would introduce. A 6-digit code has only a
 * million possibilities, so it is safe purely because the endpoints that
 * accept it are rate limited and it expires quickly — never lengthen the
 * window without revisiting that.
 *
 * @returns {{ raw: string, hashed: string }} `raw` is zero-padded.
 */
export const generateNumericCode = (digits = 6) => {
  const max = 10 ** digits;
  const raw = String(crypto.randomInt(0, max)).padStart(digits, '0');
  return { raw, hashed: hashToken(raw) };
};

/**
 * Timing-safe string comparison.
 * Length mismatches short-circuit, which leaks only length — not content.
 */
export const safeEqual = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

/** Opaque random identifier, used for OAuth state and refresh-token ids. */
export const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

export default { generateSecureToken, hashToken, safeEqual, randomId };
