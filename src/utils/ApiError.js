/**
 * Operational error carrying an HTTP status code.
 *
 * `isOperational` distinguishes errors we raised deliberately (safe to show the
 * client) from unexpected crashes (masked as a generic 500 in production).
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to return.
   * @param {string} message Client-safe message.
   * @param {object} [options]
   * @param {Array<{field: string, message: string}>} [options.details] Field-level errors.
   * @param {string} [options.code] Stable machine-readable error code.
   * @param {Error} [options.cause] Underlying error, preserved for logging.
   */
  constructor(statusCode, message, { details, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code ?? statusToCode(statusCode);
    if (details) this.details = details;

    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Resource not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Resource already exists', options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message = 'Validation failed', options) {
    return new ApiError(422, message, options);
  }

  static tooManyRequests(message = 'Too many requests, please try again later', options) {
    return new ApiError(429, message, options);
  }

  static internal(message = 'Internal server error', options) {
    return new ApiError(500, message, options);
  }
}

const CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

function statusToCode(statusCode) {
  return CODE_BY_STATUS[statusCode] ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

export default ApiError;
