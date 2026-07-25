import { z } from 'zod';
import { PAGINATION } from '../constants/index.js';

/** Shared Zod building blocks. */

/** A 24-character hex MongoDB ObjectId. */
export const objectId = (label = 'id') =>
  z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, `${label} must be a valid id`);

export const idParam = z.object({ id: objectId('id') });

export const trimmedString = ({ min = 1, max = 255, label = 'Value' } = {}) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} character${min === 1 ? '' : 's'}`)
    .max(max, `${label} must be at most ${max} characters`);

export const optionalString = (max = 255) => z.string().trim().max(max).optional();

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Please provide a valid email address')
  .max(254);

/**
 * Password policy: length is the dominant factor in resistance to guessing,
 * so an 8-character floor is enforced without arbitrary composition rules
 * that push users toward predictable substitutions.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

/** Accepts real booleans and the "true"/"false" strings multipart forms send. */
export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

/** Accepts an array, a JSON-encoded array, or a comma-separated string. */
export const stringArray = ({ max = 20, itemMax = 40 } = {}) =>
  z
    .union([z.array(z.string()), z.string()])
    .transform((value) => {
      if (Array.isArray(value)) return value;
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          // Fall through to comma-splitting.
        }
      }
      return trimmed ? trimmed.split(',') : [];
    })
    .pipe(z.array(z.string().trim().min(1).max(itemMax)).max(max));

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  sort: z.string().trim().max(40).optional(),
  search: z.string().trim().max(120).optional(),
});

export default {
  objectId,
  idParam,
  trimmedString,
  optionalString,
  email,
  password,
  booleanish,
  stringArray,
  paginationQuery,
};
