import app from '../src/app.js';

/**
 * Vercel serverless entry point.
 *
 * `src/app.js` only builds and exports the Express app — it never calls
 * `app.listen()`. Vercel's Node runtime invokes this default export directly
 * as a `(req, res)` handler, the same signature `http.createServer(app)`
 * uses locally, so no adapter is needed. `src/server.js` (which does call
 * `app.listen()`, connects to MongoDB on boot, and starts cron jobs) is
 * untouched and still runs `npm start` for local development and any
 * non-serverless host.
 */
export default app;
