import { z } from 'zod';
import { TONES } from '../constants/index.js';
import { booleanish, objectId } from './common.validator.js';

/** Profile and settings schemas — fields match Profile.jsx and Setting.jsx. */

export const updateProfileSchema = {
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Username must be at least 3 characters')
      .max(30)
      .regex(/^[a-z0-9_.]+$/, 'Username may contain only letters, numbers, dots and underscores')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    role: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(500).optional(),
    country: z.string().trim().max(60).optional(),
    avatar: z.string().trim().max(500).optional(),
    newsletterOptIn: booleanish.optional(),
  }),
};

export const updateSettingsSchema = {
  // Partial by design: the Settings page saves one toggle at a time.
  body: z
    .object({
      tone: z.enum(TONES).optional(),
      creativeInference: booleanish.optional(),
      autoCitations: booleanish.optional(),
      twoFactor: booleanish.optional(),
      editorialUpdates: booleanish.optional(),
      analyticsReports: booleanish.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Provide at least one setting to update',
    }),
};

export const publicProfileSchema = {
  // Accepts either an ObjectId or a username, matching the frontend's links.
  params: z.object({ identifier: z.string().trim().min(1).max(60) }),
};

export const deleteAccountSchema = {
  body: z
    .object({ password: z.string().max(128).optional() })
    .optional()
    .default({}),
};

export const userIdSchema = { params: z.object({ id: objectId('id') }) };

export default {
  updateProfileSchema,
  updateSettingsSchema,
  publicProfileSchema,
  deleteAccountSchema,
  userIdSchema,
};
