import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { UPLOAD } from '../constants/index.js';

/** 404 for unmatched routes — runs after every router. */
export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

/** Extracts the offending field from a duplicate-key error. */
const duplicateKeyField = (error) => {
  const key = Object.keys(error.keyPattern ?? error.keyValue ?? {})[0];
  return key ?? 'field';
};

/** Translates known error shapes into an ApiError. */
const normalizeError = (error) => {
  if (error instanceof ApiError) return error;

  if (error instanceof ZodError) {
    return ApiError.unprocessable('Validation failed', {
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
      cause: error,
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.unprocessable('Validation failed', {
      details: Object.values(error.errors).map((fieldError) => ({
        field: fieldError.path,
        message: fieldError.message,
      })),
      cause: error,
    });
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for '${error.path}'`, { cause: error });
  }

  if (error?.code === 11000) {
    const field = duplicateKeyField(error);
    return ApiError.conflict(`A record with that ${field} already exists`, {
      details: [{ field, message: 'Must be unique' }],
      cause: error,
    });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(UPLOAD.MAX_FILE_SIZE_BYTES / (1024 * 1024));
      return new ApiError(413, `File is too large. Maximum size is ${mb}MB`, { cause: error });
    }
    return ApiError.badRequest(`Upload failed: ${error.message}`, { cause: error });
  }

  // Body parser rejecting malformed JSON.
  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON', { cause: error });
  }

  if (error?.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', { cause: error });
  }

  return null;
};

/**
 * Terminal error handler.
 *
 * Unrecognised errors are logged in full but reported to the client as a bare
 * 500 in production, so stack traces and driver internals never leak.
 */
export const errorHandler = (error, req, res, _next) => {
  const normalized = normalizeError(error);
  const apiError = normalized ?? ApiError.internal(error?.message || 'Internal server error', { cause: error });

  if (!normalized || apiError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${apiError.statusCode}`, error?.stack || error);
  } else if (apiError.statusCode >= 400) {
    logger.debug(`${req.method} ${req.originalUrl} -> ${apiError.statusCode}: ${apiError.message}`);
  }

  const exposeMessage = apiError.statusCode < 500 || !config.isProduction;

  res.status(apiError.statusCode).json({
    success: false,
    code: apiError.code,
    message: exposeMessage ? apiError.message : 'Internal server error',
    ...(apiError.details ? { errors: apiError.details } : {}),
    ...(config.isProduction ? {} : { stack: error?.stack }),
  });
};

export default errorHandler;
