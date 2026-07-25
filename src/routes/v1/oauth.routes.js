import { Router } from 'express';
import oauthController from '../../controllers/oauth.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authLimiter } from '../../middlewares/rateLimit.middleware.js';
import { oauthCallbackSchema, oauthProviderSchema } from '../../validators/auth.validator.js';

const router = Router();

/** Providers with credentials configured, so the UI can hide dead buttons. */
router.get('/providers', oauthController.listProviders);

// Browser redirect flow: /oauth/google -> provider -> /oauth/google/callback.
router.get('/:provider', validate(oauthProviderSchema), oauthController.startOAuth);
router.get('/:provider/url', validate(oauthProviderSchema), oauthController.getAuthorizationUrl);
router.get('/:provider/callback', validate(oauthCallbackSchema), oauthController.oauthCallback);

// JSON flow, for popup or native clients that hold the code themselves.
router.post('/:provider/exchange', authLimiter, validate(oauthProviderSchema), oauthController.exchangeCode);

router.delete('/:provider/unlink', authenticate, validate(oauthProviderSchema), oauthController.unlinkProvider);

export default router;
