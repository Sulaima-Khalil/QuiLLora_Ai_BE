import config from './env.js';
import ApiError from '../utils/ApiError.js';

/**
 * CORS policy.
 *
 * Credentials are enabled because auth tokens travel in HTTP-only cookies,
 * which forbids the `*` origin — every caller must be on the allow-list.
 * Requests with no `Origin` header (curl, health checks, same-origin
 * server-side calls) are permitted.
 */
/**
 * Checks whether an origin is allowed by explicit match, wildcard pattern, or Vercel deployment subdomains.
 */
export const isOriginAllowed = (origin) => {
  if (!origin) return true;

  if (config.client.corsOrigins.includes(origin)) return true;

  for (const allowed of config.client.corsOrigins) {
    if (allowed.includes('*')) {
      const regexPattern = '^' + allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      if (new RegExp(regexPattern, 'i').test(origin)) {
        return true;
      }
    }
  }

  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    // Ignore invalid URL
  }

  return false;
};

/**
 * CORS policy.
 *
 * Credentials are enabled because auth tokens travel in HTTP-only cookies,
 * which forbids the `*` origin — every caller must be on the allow-list.
 * Requests with no `Origin` header (curl, health checks, same-origin
 * server-side calls) are permitted.
 */
export const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(ApiError.forbidden(`Origin '${origin}' is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400,
};

export default corsOptions;
