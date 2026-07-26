import billingService from '../services/billing.service.js';
import safepayService from '../services/safepay.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import logger from '../utils/logger.js';

/** GET /billing/plans — the public catalogue the pricing page renders. */
export const listPlans = asyncHandler(async (_req, res) =>
  sendSuccess(res, {
    message: 'Plans',
    data: {
      plans: billingService.listPlans(),
      paymentConfigured: billingService.isPaymentConfigured(),
    },
  }),
);

/** GET /billing/subscription — the caller's own plan. */
export const getSubscription = asyncHandler(async (req, res) => {
  const subscription = await billingService.getSubscription(req.user._id);

  return sendSuccess(res, {
    message: 'Subscription',
    data: { subscription, paymentConfigured: billingService.isPaymentConfigured() },
  });
});

/** GET /billing/entitlements — the caller's limits, and whether they bite. */
export const getEntitlements = asyncHandler(async (req, res) => {
  const entitlements = await billingService.getEntitlements(req.user._id);
  return sendSuccess(res, { message: 'Entitlements', data: { entitlements } });
});

/**
 * POST /billing/subscription/request — asks to move onto a paid plan.
 *
 * 202, not 200: the request has been recorded, nothing has been granted.
 */
export const requestUpgrade = asyncHandler(async (req, res) => {
  const result = await billingService.requestUpgrade(req.user._id, req.body);
  return res.status(202).json({ success: true, message: result.message, data: result });
});

/**
 * POST /billing/checkout — opens a Safepay-hosted subscription checkout.
 *
 * Answers with a URL and the caller's own plan choice, and nothing else. No
 * reference, no Safepay plan token, no provider ids, no secret — the browser
 * needs one thing to do its job, which is somewhere to navigate to.
 *
 * 201, not 200: a checkout session was created at the provider. It is
 * emphatically not an activation, and the body says so.
 */
export const createCheckout = asyncHandler(async (req, res) => {
  const result = await billingService.createCheckout(req.user._id, req.body);

  return res.status(201).json({
    success: true,
    message: 'Continue to Safepay to complete your payment.',
    data: {
      checkoutUrl: result.checkoutUrl,
      planId: result.planId,
      cycle: result.cycle,
      subscription: result.subscription,
      // Stated outright so no client can read this response as a purchase.
      activated: false,
    },
  });
});

/** POST /billing/subscription/cancel — returns the caller to the free plan. */
export const cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await billingService.cancelSubscription(req.user._id);
  return sendSuccess(res, { message: 'Subscription cancelled', data: { subscription } });
});

/**
 * POST /billing/webhook — Safepay's event callback.
 *
 * Unauthenticated by necessity: Safepay calls it server-to-server with no
 * session. The HMAC on `X-SFPY-SIGNATURE` is what stands in for a session,
 * and it is checked before the payload is looked at for any purpose beyond
 * parsing it.
 *
 * Responses are deliberately bare. A 400 tells an unauthenticated caller only
 * that the request was refused — never which check failed, never any part of
 * what they sent — because a body echoed back to whoever posted it is an
 * oracle for guessing at the secret, and any real payload here would contain
 * a customer's email and payment identifiers.
 *
 * A 200 means "recorded"; it does not mean a plan changed. Safepay retries a
 * non-2xx, so answering 200 to a duplicate or an event we deliberately ignore
 * is what stops an endless redelivery loop over nothing.
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  /*
   * Nothing to verify against, so nothing may be accepted. 503 rather than
   * 400: the request may well be genuine, and Safepay retrying after the
   * secret is configured is the outcome we want.
   */
  if (!safepayService.isConfigured()) {
    logger.warn('Rejected Safepay webhook: payments are not configured');

    return res.status(503).json({
      success: false,
      code: 'PAYMENT_NOT_CONFIGURED',
      message: 'Payments are not configured.',
    });
  }

  const verification = safepayService.verifyWebhook(req.body, req.headers);

  if (!verification.ok) {
    // The reason, and nothing that arrived with the request.
    logger.warn(`Rejected Safepay webhook: ${verification.reason}`);

    return res.status(400).json({
      success: false,
      code: 'INVALID_WEBHOOK',
      message: 'Invalid webhook.',
    });
  }

  const outcome = await billingService.handleProviderEvent(verification.event);

  // Event type and outcome only — safe to log, and the two things worth
  // knowing when a subscription did not turn out the way someone expected.
  logger.info(
    `Safepay webhook ${verification.event.type}: ${outcome.duplicate ? 'duplicate' : outcome.reason}`,
  );

  return res.status(200).json({ success: true, received: true });
});

export default {
  listPlans,
  handleWebhook,
  getSubscription,
  getEntitlements,
  requestUpgrade,
  createCheckout,
  cancelSubscription,
};
