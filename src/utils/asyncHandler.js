/**
 * Wraps an async route handler so rejected promises reach Express's error
 * middleware instead of surfacing as unhandled rejections.
 *
 * Express 5 forwards rejected promises automatically, but wrapping keeps the
 * behaviour explicit and identical under Express 4 if the app is downgraded.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
