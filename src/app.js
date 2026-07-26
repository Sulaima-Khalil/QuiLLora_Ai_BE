import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import config from './config/env.js';
import corsOptions from './config/cors.js';
import routes from './routes/index.js';
import { PAYMENT_WEBHOOK_PATH } from './constants/index.js';
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
import { mongoSanitize } from './middlewares/sanitize.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import logger from './utils/logger.js';

const app = express();

/* ---------------------------------------------------------------------------
 * Platform
 * ------------------------------------------------------------------------ */

// Required behind a reverse proxy (Render, Railway, Nginx) so `req.ip` is the
// real client address rather than the proxy's — rate limiting depends on it.
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------------------------------------------------------------------------
 * Security
 * ------------------------------------------------------------------------ */

app.use(
  helmet({
    // The API serves JSON and uploaded images, never HTML, so the default
    // CSP would only restrict resources this origin does not deliver.
    contentSecurityPolicy: false,
    // Lets the frontend on a different origin embed uploaded images.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

app.use(cors(corsOptions));

/* ---------------------------------------------------------------------------
 * Parsing
 *
 * The webhook path is parsed FIRST, and as raw bytes.
 *
 * Payment providers sign the exact bytes they sent. `express.json()` parses
 * and discards them, and re-serialising the object afterwards reorders keys
 * and drops whitespace, so every signature check would fail. Mounting the raw
 * parser ahead of the JSON one leaves `req.body` as a Buffer for that one path.
 *
 * body-parser sets `req._body` once it has consumed the stream, and every
 * later parser returns early when it sees that flag — so `express.json()`
 * below skips this path without needing to know it exists. Ordering is the
 * whole mechanism: moving this line after the JSON parser silently breaks
 * signature verification.
 *
 * Safepay signs the JSON of the event's `data` object with HMAC-SHA512, and
 * safepay.service.js parses these bytes itself to reproduce it — so what is
 * hashed is what actually arrived, not something a body parser rebuilt.
 */
app.use(PAYMENT_WEBHOOK_PATH, express.raw({ type: '*/*', limit: '1mb' }));

// 2MB accommodates long TipTap documents while still bounding memory per request.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(compression());

// Strips `$`-prefixed and dotted keys before any query reaches Mongoose.
app.use(
  mongoSanitize({
    onSanitize: ({ path: requestPath, keys }) => {
      logger.warn(`Blocked suspicious keys on ${requestPath}: ${keys.join(', ')}`);
    },
  }),
);

/* ---------------------------------------------------------------------------
 * Observability
 * ------------------------------------------------------------------------ */

if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

/* ---------------------------------------------------------------------------
 * Static uploads
 * ------------------------------------------------------------------------ */

if (config.uploads.serve) {
  app.use(
    config.uploads.publicPath,
    express.static(config.uploads.dir, {
      maxAge: '7d',
      // Filenames are server-generated; never fall back to directory listings
      // or index files inside the upload tree.
      index: false,
      redirect: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );
}

/* ---------------------------------------------------------------------------
 * API
 * ------------------------------------------------------------------------ */

/*
 * The general limiter deliberately skips the webhook path — see the `skip` in
 * rateLimit.middleware.js. A provider retrying a burst of events must not be
 * throttled into a stuck subscription. The path is not left unlimited: the
 * route itself carries `webhookLimiter`, which is generous but finite.
 */
app.use('/api', apiLimiter, routes);

/** Root banner, so hitting the bare host is informative rather than a 404. */
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'InkFlow AI API',
    data: { docs: '/api', health: `${config.apiPrefix}/health`, version: 'v1' },
  });
});

/* ---------------------------------------------------------------------------
 * Errors — must be registered last
 * ------------------------------------------------------------------------ */

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
