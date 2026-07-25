/**
 * Uniform success envelope.
 *
 * Every 2xx body is `{ success: true, message, data, ...extra }` so the
 * frontend can unwrap `response.data.data` without special-casing endpoints.
 */
export const sendSuccess = (res, { statusCode = 200, message = 'OK', data = null, ...extra } = {}) =>
  res.status(statusCode).json({ success: true, message, data, ...extra });

/** 201 helper for resource creation. */
export const sendCreated = (res, { message = 'Created', data = null, ...extra } = {}) =>
  sendSuccess(res, { statusCode: 201, message, data, ...extra });

/** 204 helper — no body by definition. */
export const sendNoContent = (res) => res.status(204).send();

/**
 * Paginated list envelope. `meta` carries the cursor information the
 * dashboard's infinite lists need.
 */
export const sendPaginated = (res, { message = 'OK', data = [], page, limit, total }) => {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
};

export default { sendSuccess, sendCreated, sendNoContent, sendPaginated };
