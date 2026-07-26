import { Router } from 'express';
import userController from '../../controllers/user.controller.js';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { uploadAvatar } from '../../middlewares/upload.middleware.js';
import {
  deleteAccountSchema,
  publicProfileSchema,
  searchUsersSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '../../validators/user.validator.js';

const router = Router();

/* ---------------------------------------------------------------------------
 * The signed-in user
 *
 * Declared before `/:identifier` so "me" and "settings" are not treated as
 * usernames.
 * ------------------------------------------------------------------------ */

router.get('/me', authenticate, userController.getProfile);

router.patch(
  '/me',
  authenticate,
  uploadAvatar.single('avatar'),
  validate(updateProfileSchema),
  userController.updateProfile,
);

router.put(
  '/me',
  authenticate,
  uploadAvatar.single('avatar'),
  validate(updateProfileSchema),
  userController.updateProfile,
);

router.delete('/me', authenticate, validate(deleteAccountSchema), userController.deleteAccount);

router.get('/me/settings', authenticate, userController.getSettings);
router.patch('/me/settings', authenticate, validate(updateSettingsSchema), userController.updateSettings);
router.put('/me/settings', authenticate, validate(updateSettingsSchema), userController.updateSettings);

/* ---------------------------------------------------------------------------
 * Public author profiles
 *
 * `/search` is declared before `/:identifier` so it is not read as a username.
 * ------------------------------------------------------------------------ */

router.get(
  '/search',
  optionalAuthenticate,
  validate(searchUsersSchema),
  userController.searchUsers,
);

router.get(
  '/:identifier',
  optionalAuthenticate,
  validate(publicProfileSchema),
  userController.getPublicProfile,
);

export default router;
