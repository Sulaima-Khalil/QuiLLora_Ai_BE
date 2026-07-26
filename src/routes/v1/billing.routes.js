import { Router } from 'express';
import billingController from '../../controllers/billing.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { webhookLimiter } from '../../middlewares/rateLimit.middleware.js';
import { PAYMENT_WEBHOOK_ROUTE } from '../../constants/index.js';
import { createCheckoutSchema, requestUpgradeSchema } from '../../validators/billing.validator.js';

const router = Router();

/* ---------------------------------------------------------------------------
 * Public
 * ------------------------------------------------------------------------ */

// The pricing page is on the landing site, so the catalogue is readable
// signed-out. It contains prices and limits only — nothing account-specific.
router.get('/plans', billingController.listPlans);

/*
 * Safepay's event callback.
 *
 * Declared here, above `router.use(authenticate)`, because Safepay calls it
 * server-to-server with no session; authenticating it would reject every real
 * event. Its own limiter replaces the general one, which skips this path.
 *
 * What takes the place of authentication is the HMAC-SHA512 signature on
 * `X-SFPY-SIGNATURE`, verified against the raw bytes app.js preserved for
 * this one route before anything in the payload is trusted. Idempotency is
 * enforced on Safepay's own event id.
 */
router.post(PAYMENT_WEBHOOK_ROUTE, webhookLimiter, billingController.handleWebhook);

/* ---------------------------------------------------------------------------
 * The signed-in user's own subscription
 *
 * Every route below acts on `req.user._id`. There is no route that takes a
 * user id from the caller, so one account cannot read or change another's
 * plan.
 * ------------------------------------------------------------------------ */

router.use(authenticate);

router.get('/subscription', billingController.getSubscription);
router.get('/entitlements', billingController.getEntitlements);

router.post(
  '/subscription/request',
  validate(requestUpgradeSchema),
  billingController.requestUpgrade,
);

/*
 * The paid path. Creates a Safepay checkout for the caller and returns its
 * URL; it cannot activate anything, and there is still no route anywhere that
 * can. Only a signed webhook grants a plan.
 */
router.post('/checkout', validate(createCheckoutSchema), billingController.createCheckout);

router.post('/subscription/cancel', billingController.cancelSubscription);

export default router;
