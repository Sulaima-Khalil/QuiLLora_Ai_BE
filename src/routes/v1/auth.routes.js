import { Router } from 'express';
import authController from '../../controllers/auth.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authLimiter, emailLimiter } from '../../middlewares/rateLimit.middleware.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  setPasswordSchema,
  verifyResetCodeSchema,
  verifyEmailSchema,
} from '../../validators/auth.validator.js';

const router = Router();

/* ---------------------------------------------------------------------------
 * Public
 * ------------------------------------------------------------------------ */

router.get('/config', authController.authConfig);

// `authLimiter` throttles credential guessing; `emailLimiter` caps outbound mail.
router.post('/register', authLimiter, emailLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);

router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authController.logout);

router.post('/verify-email', validate(verifyEmailSchema), authController.verifyEmail);
router.post(
  '/resend-verification',
  emailLimiter,
  validate(resendVerificationSchema),
  authController.resendVerification,
);

router.post('/forgot-password', emailLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
// authLimiter caps guessing against the small 6-digit space; the service also
// burns the code after five wrong attempts.
router.post('/verify-reset-code', authLimiter, validate(verifyResetCodeSchema), authController.verifyResetCode);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), authController.resetPassword);

/* ---------------------------------------------------------------------------
 * Authenticated
 * ------------------------------------------------------------------------ */

router.use(authenticate);

router.get('/me', authController.me);
router.get('/sessions', authController.listSessions);
router.post('/logout-all', authController.logoutAll);
router.post('/change-password', validate(changePasswordSchema), authController.changePassword);
router.post('/set-password', validate(setPasswordSchema), authController.setPassword);

export default router;
