import userService from '../services/user.service.js';
import tokenService from '../services/token.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendPaginated, sendSuccess } from '../utils/ApiResponse.js';
import { toPublicUrl } from '../middlewares/upload.middleware.js';

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await userService.getProfile(req.user._id);
  return sendSuccess(res, { message: 'Your profile', data: { profile } });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const file = req.file ? { publicUrl: toPublicUrl(req.file, 'avatars') } : null;
  const profile = await userService.updateProfile(req.user._id, req.body, file);

  return sendSuccess(res, { message: 'Profile updated', data: { profile } });
});

export const getSettings = asyncHandler(async (req, res) => {
  const profile = await userService.getProfile(req.user._id);
  return sendSuccess(res, { message: 'Your settings', data: { settings: profile.settings } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await userService.updateSettings(req.user._id, req.body);
  return sendSuccess(res, { message: 'Settings updated', data: { settings } });
});

/** GET /users/search — people results for the global search bar. */
export const searchUsers = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.validatedQuery ?? req.query ?? {};
  const result = await userService.searchUsers(search, { page, limit });

  return sendPaginated(res, {
    message: 'People',
    data: result.people,
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/** GET /users/:identifier — public author page (id or username). */
export const getPublicProfile = asyncHandler(async (req, res) => {
  const result = await userService.getPublicProfile(
    req.params.identifier,
    req.user?._id ?? null,
  );

  return sendSuccess(res, { message: 'Profile', data: result });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const result = await userService.deleteAccount(req.user._id, req.body?.password);

  // The account is gone; the browser must not keep presenting its cookies.
  tokenService.clearAuthCookies(res);

  return sendSuccess(res, { message: result.message });
});

export default {
  getProfile,
  updateProfile,
  getSettings,
  updateSettings,
  getPublicProfile,
  searchUsers,
  deleteAccount,
};
