import app from '../src/app.js';
import config from '../src/config/env.js';
import { connectDatabase } from '../src/database/connect.js';
import logger from '../src/utils/logger.js';

/**
 * Vercel serverless entry point.
 *
 * `src/app.js` only builds and exports the Express app — it never calls
 * `app.listen()`. `src/server.js` (which does listen, connects to MongoDB on
 * boot, and starts cron jobs) is untouched and still backs `npm start` for
 * local development and any long-lived host.
 *
 * Because `server.js` never runs here, this module owns the one thing it used
 * to provide: an open database connection. Everything else — middleware order,
 * the raw-body parser on the webhook path, routes, error handlers — is exactly
 * the app object, delegated to unchanged.
 */

/**
 * Connects on the first request of a cold start and reuses that connection for
 * every later request the same instance serves.
 *
 * `connectDatabase()` caches its own in-flight promise, so concurrent requests
 * on a fresh instance share a single dial rather than opening a pool each.
 * `syncIndexes()` is deliberately NOT called: it is a slow, one-off migration
 * step, not something to repeat on every cold start (see the deployment notes
 * for running it out of band).
 */
const ensureDatabase = async () => {
  await connectDatabase();
};

/**
 * Strips `user:password@` out of anything before it reaches a response body.
 *
 * Driver errors quote the connection string on a malformed URI, so the message
 * cannot be echoed to a caller as-is.
 */
const redact = (message = '') =>
  message.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]*@/gi, '$1<credentials>@');

/**
 * Mirrors the `cors()` allow-list onto a response that never reaches Express.
 *
 * Without these headers a browser cannot read the body at all and reports the
 * request as a network failure — so a database outage would surface in the UI
 * as "can't reach the server" rather than the actual 503 message.
 */
const applyCorsHeaders = (req, res) => {
  const origin = req.headers?.origin;
  if (!origin || !config.client.corsOrigins.includes(origin)) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
};

export default async function handler(req, res) {
  // A preflight asks only what the server permits, so it must be answerable
  // while the database is unreachable. Express' cors() replies on its own.
  if (req.method === 'OPTIONS') {
    app(req, res);
    return;
  }

  try {
    await ensureDatabase();
  } catch (error) {
    // A dead database must not surface as an opaque platform error.
    logger.error(`Serverless database connection failed: ${error.message}`);

    applyCorsHeaders(req, res);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        message: 'Service temporarily unavailable: database connection failed',
        // `error` names the failure mode — MongooseServerSelectionError points
        // at the network path (IP allow-list, paused cluster, stale hostnames),
        // MongoServerError at credentials. Without it every diagnosis is a
        // guess. Drop these two fields once the connection is healthy.
        error: error.name,
        reason: redact(error.message),
      }),
    );
    return;
  }

  // An Express app is itself a `(req, res)` handler, so no adapter is needed.
  app(req, res);
}
