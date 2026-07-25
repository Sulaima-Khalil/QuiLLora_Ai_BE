import { z } from 'zod';
import { OAUTH_PROVIDERS } from '../constants/index.js';
import { booleanish, email, password, trimmedString } from './common.validator.js';

/**
 * Auth request schemas.
 *
 * Field names mirror the frontend forms exactly (pages/Register.jsx,
 * pages/Login.jsx) so no client-side renaming is required.
 */

export const registerSchema = {
  body: z
    .object({
      name: trimmedString({ min: 2, max: 80, label: 'Name' }),
      username: z
        .string()
        .trim()
        .toLowerCase()
        .min(3, 'Username must be at least 3 characters')
        .max(30, 'Username must be at most 30 characters')
        .regex(/^[a-z0-9_.]+$/, 'Username may contain only letters, numbers, dots and underscores')
        .optional()
        .or(z.literal('').transform(() => undefined)),
      email,
      password,
      confirmPassword: z.string().optional(),
      country: z.string().trim().max(60).optional().default(''),
      newsletter: booleanish.optional().default(false),
      agree: booleanish.optional(),
    })
    // The register form sends both; reject early rather than creating an
    // account the user cannot sign in to.
    .refine((data) => !data.confirmPassword || data.confirmPassword === data.password, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
};

export const loginSchema = {
  body: z.object({
    email,
    // Not `password` — the policy applies at registration, and rejecting a
    // short login attempt on length alone leaks that it cannot be valid.
    password: z.string().min(1, 'Password is required').max(128),
  }),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1).optional() }).optional().default({}),
};

export const verifyEmailSchema = {
  body: z.object({ token: z.string().trim().min(1, 'Verification token is required') }),
};

export const verifyEmailQuerySchema = {
  query: z.object({ token: z.string().trim().min(1, 'Verification token is required') }),
};

export const resendVerificationSchema = {
  body: z.object({ email }),
};

export const forgotPasswordSchema = {
  body: z.object({ email }),
};

/** The 6-digit code emailed for the "type the code" recovery flow. */
const resetCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

export const verifyResetCodeSchema = {
  body: z.object({ email, code: resetCode }),
};

export const resetPasswordSchema = {
  body: z
    .object({
      // Either entry point is accepted: the emailed link's token, or the
      // email + code pair verified on the previous step.
      token: z.string().trim().min(1).optional(),
      code: resetCode.optional(),
      email: email.optional(),
      password,
      confirmPassword: z.string().optional(),
    })
    .refine((data) => Boolean(data.token) || Boolean(data.code && data.email), {
      message: 'Provide either a reset token or your email and the 6-digit code',
      path: ['token'],
    })
    .refine((data) => !data.confirmPassword || data.confirmPassword === data.password, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1).max(128).optional(),
      newPassword: password,
      confirmPassword: z.string().optional(),
    })
    .refine((data) => !data.confirmPassword || data.confirmPassword === data.newPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
};

export const setPasswordSchema = {
  body: z.object({ password }),
};

export const oauthProviderSchema = {
  params: z.object({ provider: z.enum(OAUTH_PROVIDERS) }),
};

export const oauthCallbackSchema = {
  params: z.object({ provider: z.enum(OAUTH_PROVIDERS) }),
  query: z.object({
    code: z.string().trim().min(1, 'Authorization code is required'),
    state: z.string().trim().min(1, 'State is required'),
    error: z.string().optional(),
  }),
};

export default {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  verifyEmailQuerySchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  changePasswordSchema,
  setPasswordSchema,
  oauthProviderSchema,
  oauthCallbackSchema,
};
