import ApiError from '../utils/ApiError.js';

/**
 * Validates `req.body`, `req.query` and `req.params` against Zod schemas and
 * replaces each with the parsed result, so controllers receive coerced,
 * trimmed, allow-listed data and never touch raw input.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  const details = [];

  for (const source of ['params', 'query', 'body']) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source]);

    if (!result.success) {
      details.push(
        ...result.error.issues.map((issue) => ({
          field: [source, ...issue.path].join('.'),
          message: issue.message,
        })),
      );
      continue;
    }

    if (source === 'query') {
      // Express 5 exposes req.query as a getter-only property, so the parsed
      // value is published under a separate key instead of assigned.
      Object.defineProperty(req, 'validatedQuery', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data;
    }
  }

  if (details.length > 0) {
    return next(ApiError.unprocessable('Validation failed', { details }));
  }

  return next();
};

export default validate;
