/**
 * NoSQL injection guard.
 *
 * Strips keys beginning with `$` (query operators such as `$ne`, `$gt`,
 * `$where`) and keys containing `.` (dotted-path traversal) from request
 * payloads. Without this, a body of `{"email": {"$ne": null}}` would match an
 * arbitrary user in a `findOne` lookup.
 *
 * Replaces `express-mongo-sanitize`, which is incompatible with Express 5:
 * that package assigns to `req.query`, now a getter-only property.
 */

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Recursively removes dangerous keys. Returns a new value; never mutates. */
const scrub = (value, removedKeys, depth = 0) => {
  // Bounds the recursion so a deeply nested payload cannot blow the stack.
  if (depth > 20) return undefined;

  if (Array.isArray(value)) {
    return value.map((entry) => scrub(entry, removedKeys, depth + 1));
  }

  if (!isPlainObject(value)) return value;

  const result = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      removedKeys.push(key);
      continue;
    }

    // Block prototype-pollution vectors.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      removedKeys.push(key);
      continue;
    }

    result[key] = scrub(entry, removedKeys, depth + 1);
  }

  return result;
};

/**
 * @param {{ onSanitize?: (info: { path: string, keys: string[] }) => void }} [options]
 */
export const mongoSanitize = (options = {}) => (req, _res, next) => {
  const removedKeys = [];

  if (req.body !== undefined) {
    req.body = scrub(req.body, removedKeys);
  }

  if (req.params !== undefined) {
    req.params = scrub(req.params, removedKeys);
  }

  // req.query is getter-only in Express 5: mutate the existing object in place
  // rather than reassigning it.
  if (req.query && isPlainObject(req.query)) {
    const cleaned = scrub(req.query, removedKeys);
    for (const key of Object.keys(req.query)) {
      if (!(key in cleaned)) delete req.query[key];
    }
    Object.assign(req.query, cleaned);
  }

  if (removedKeys.length > 0) {
    options.onSanitize?.({ path: req.originalUrl, keys: removedKeys });
  }

  next();
};

export default mongoSanitize;
