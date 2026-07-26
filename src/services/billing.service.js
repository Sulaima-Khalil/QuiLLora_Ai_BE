import {
  ARTICLE_STATUS,
  BILLING_CYCLE,
  CHECKOUT_INTENT_TTL_MS,
  DEFAULT_PLAN_ID,
  ENFORCED_CAPABILITIES,
  PAID_PLAN_IDS,
  PAYMENT_PROVIDER,
  PLANS,
  SAFEPAY_EVENT,
  isCapabilityEnforced,
  SUBSCRIPTION_STATUS,
  WEBHOOK_EVENT_STATUS,
} from '../constants/index.js';
import {
  aiUsageRepository,
  articleRepository,
  teamRepository,
  userRepository,
  webhookEventRepository,
} from '../repositories/index.js';
import safepayService from './safepay.service.js';
import ApiError from '../utils/ApiError.js';
import { serializeSubscription } from '../utils/serializers.js';

/**
 * Plans and subscriptions.
 *
 * The rule this module exists to enforce: a plan is something the server
 * grants, never something a client asserts. Requests name a plan by id; the
 * money comes from the Safepay plan that id maps to, and a paid plan is only
 * ever set by an event Safepay signed.
 *
 * Two paths write to `subscription.planId`, and only two:
 *
 *   - `handleProviderEvent`, from a webhook whose HMAC verified; and
 *   - `cancelSubscription`, which only ever takes entitlements away.
 *
 * `createCheckout` deliberately writes none of it. Opening a checkout is not
 * paying, so it records the intent and leaves the user exactly where they
 * were.
 */

/** Whether a payment provider is wired up. */
export const isPaymentConfigured = () => safepayService.isConfigured();

export const findPlan = (planId) => PLANS.find((plan) => plan.id === planId) ?? null;

/** Public plan catalogue. Prices come from here and nowhere else. */
export const listPlans = () =>
  PLANS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    price: { ...plan.price },
    trialDays: plan.trialDays,
    limits: { ...plan.limits },
  }));

/** What one billing period costs, derived server-side from the catalogue. */
export const chargeFor = (plan, cycle) =>
  cycle === BILLING_CYCLE.YEARLY ? plan.price.yearly * 12 : plan.price.monthly;

const addCycle = (from, cycle) => {
  const date = new Date(from);
  if (cycle === BILLING_CYCLE.YEARLY) date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return date;
};

/**
 * The provider-facing fields, all `select: false`.
 *
 * Loaded only where they are needed — a checkout, a webhook, a cancellation —
 * so an ordinary read of a user cannot carry a provider subscription id into
 * a response by accident.
 */
const PROVIDER_FIELDS = [
  '+subscription.providerSubscriptionId',
  '+subscription.providerCustomerId',
  '+subscription.pendingReference',
  '+subscription.pendingProviderPlanId',
  '+subscription.providerUpdatedAt',
].join(' ');

/** Drops a subscription back to the free plan. Never grants anything. */
const downgrade = (subscription, { status }) => {
  subscription.planId = DEFAULT_PLAN_ID;
  subscription.cycle = BILLING_CYCLE.MONTHLY;
  subscription.status = status;
  subscription.currentPeriodEnd = null;
  subscription.cancelAtPeriodEnd = false;
  clearPendingIntent(subscription);
};

/**
 * Forgets a checkout that is no longer in play.
 *
 * The reference and provider plan token go with it: a stale intent is exactly
 * what the webhook claim rule looks for, so leaving one behind would keep an
 * account claimable long after it stopped waiting for anything.
 */
function clearPendingIntent(subscription) {
  subscription.pendingPlanId = null;
  subscription.pendingCycle = null;
  subscription.pendingSince = null;
  subscription.pendingReference = null;
  subscription.pendingProviderPlanId = null;
}

/**
 * Ends a plan whose paid-up period has run out.
 *
 * Only ever applies to a subscription Safepay already told us was cancelled —
 * `cancelAtPeriodEnd` is the flag that says "this is the last period". A plan
 * that is merely mid-renewal is left alone: a webhook running a few seconds
 * behind must not read as a lapse and revoke someone's access.
 *
 * @returns {boolean} Whether anything changed and needs saving.
 */
const applyLapse = (user) => {
  const subscription = user.subscription;

  if (!subscription?.cancelAtPeriodEnd) return false;
  if (!PAID_PLAN_IDS.includes(subscription.planId)) return false;
  if (!subscription.currentPeriodEnd) return false;
  if (subscription.currentPeriodEnd.getTime() > Date.now()) return false;

  downgrade(subscription, { status: SUBSCRIPTION_STATUS.CANCELLED });
  return true;
};

const loadUser = async (userId, { withProvider = false } = {}) => {
  const user = await userRepository.findById(
    userId,
    withProvider ? { select: PROVIDER_FIELDS } : undefined,
  );
  if (!user) throw ApiError.notFound('User not found');

  // Checked on read rather than by a scheduled sweep: entitlements are only
  // ever consulted through here, so this is the last moment before an expired
  // plan could be honoured, and there is no window in which it is.
  if (applyLapse(user)) await user.save();

  return user;
};

/** The caller's own subscription. Ownership is the authenticated id. */
export const getSubscription = async (userId) => {
  const user = await loadUser(userId);
  return serializeSubscription(user.subscription);
};

/**
 * Records a request to move onto a paid plan.
 *
 * Deliberately does not change `planId`. Clicking Upgrade is not paying, and
 * with no provider configured there is nothing that could confirm otherwise.
 * The response says so plainly rather than implying success.
 */
export const requestUpgrade = async (userId, { planId, cycle }) => {
  const plan = findPlan(planId);
  if (!plan) throw ApiError.badRequest('Unknown plan');

  if (!PAID_PLAN_IDS.includes(plan.id)) {
    throw ApiError.badRequest('That plan is free — use cancel to move back to it');
  }

  const user = await loadUser(userId);

  if (user.subscription.planId === plan.id && user.subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
    throw ApiError.conflict(`You are already on ${plan.name}`);
  }

  user.subscription.pendingPlanId = plan.id;
  user.subscription.pendingCycle = cycle;
  user.subscription.pendingSince = new Date();
  await user.save();

  return {
    subscription: serializeSubscription(user.subscription),
    // The client renders this; it must never read as a completed purchase.
    paymentConfigured: isPaymentConfigured(),
    // Priced here so the summary a user sees is the server's figure.
    amountDue: chargeFor(plan, cycle),
    currency: 'USD',
    message: isPaymentConfigured()
      ? 'Continue to payment to activate this plan.'
      : 'Payment is not available yet. Your request has been recorded and no charge was made.',
  };
};

/* ---------------------------------------------------------------------------
 * Checkout
 * ------------------------------------------------------------------------ */

const paymentUnavailable = () =>
  new ApiError(503, 'Card payment is not available right now. Please try again later.', {
    code: 'PAYMENT_NOT_CONFIGURED',
  });

/**
 * Opens a Safepay-hosted subscription checkout for the authenticated caller.
 *
 * The request carries a plan id and a cycle. Everything with a price on it is
 * resolved here: the pair maps to a Safepay plan token, and the amount and
 * currency are written on that plan at Safepay. A body that also contained
 * `amount`, `price` or `providerSubscriptionId` would change nothing — the
 * validator strips unknown keys, and nothing downstream reads them.
 *
 * Grants nothing. The user comes back from Safepay on exactly the plan they
 * left on, and stays there until a signed `subscription.payment.succeeded`
 * says otherwise.
 */
export const createCheckout = async (userId, { planId, cycle }) => {
  const plan = findPlan(planId);
  if (!plan) throw ApiError.badRequest('Unknown plan');

  if (!PAID_PLAN_IDS.includes(plan.id)) {
    throw ApiError.badRequest('That plan is free — there is nothing to pay for');
  }

  if (!safepayService.isConfigured()) throw paymentUnavailable();

  // A missing token means this plan and cycle were never set up at Safepay.
  // Better a clean 503 than a checkout URL naming a plan that does not exist.
  const planToken = safepayService.planTokenFor(plan.id, cycle);
  if (!planToken) throw paymentUnavailable();

  const user = await loadUser(userId, { withProvider: true });
  const current = user.subscription;

  /*
   * Refuse to start a second subscription over a live one.
   *
   * Safepay publishes no plan-change API, so "upgrade from Pro to Business"
   * cannot be done as one atomic switch — attempting it would leave the
   * account paying for both. Cancelling first is the only supported route,
   * and saying so is better than quietly double-billing.
   */
  if (
    PAID_PLAN_IDS.includes(current.planId) &&
    [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE].includes(current.status)
  ) {
    throw ApiError.conflict(
      current.planId === plan.id
        ? `You are already on ${plan.name}`
        : `You are on ${findPlan(current.planId)?.name ?? current.planId}. Cancel it before starting a new subscription, so you are never billed for both.`,
    );
  }

  const reference = safepayService.newCheckoutReference();

  /*
   * Safepay first, then our own record.
   *
   * If the provider call fails there is nothing to clean up. Persisting the
   * intent first and failing afterwards would leave a claimable intent behind
   * with no checkout attached to it — an account waiting to be activated by
   * somebody else's event.
   */
  const checkoutUrl = await safepayService.createSubscriptionCheckout({ planToken, reference });

  current.pendingPlanId = plan.id;
  current.pendingCycle = cycle;
  current.pendingSince = new Date();
  current.pendingReference = reference;
  current.pendingProviderPlanId = planToken;
  await user.save();

  // The URL and the caller's own plan choice. No reference, no plan token, no
  // provider ids, no amount this server made up.
  return {
    checkoutUrl,
    planId: plan.id,
    cycle,
    subscription: serializeSubscription(current),
  };
};

/**
 * Grants a paid plan. The seam a payment provider's verified webhook calls.
 *
 * Not exposed through any route: nothing a browser can reach may invoke it, or
 * the whole model collapses back to "the client says it paid".
 */
export const confirmUpgrade = async (userId, { planId, cycle, provider, providerSubscriptionId }) => {
  const plan = findPlan(planId);
  if (!plan) throw ApiError.badRequest('Unknown plan');

  const user = await loadUser(userId);
  const now = new Date();

  user.subscription.planId = plan.id;
  user.subscription.cycle = cycle;
  user.subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
  user.subscription.startedAt = now;
  user.subscription.currentPeriodEnd = addCycle(now, cycle);
  clearPendingIntent(user.subscription);
  if (provider) user.subscription.provider = provider;
  if (providerSubscriptionId) user.subscription.providerSubscriptionId = providerSubscriptionId;

  await user.save();

  return serializeSubscription(user.subscription);
};

/**
 * Cancels back to the free plan, at Safepay and here.
 *
 * Safepay offers merchants no shopper-facing customer portal, so this is the
 * whole of subscription management: the account holder asks us, and we call
 * `POST /client/subscriptions/v1/{id}/cancel` on their behalf. There is no
 * portal URL to hand out, and inventing one would be worse than saying so.
 *
 * Order matters. The provider is cancelled first and a failure there stops
 * everything: downgrading locally while Safepay carries on billing is the one
 * outcome a cancel button must never produce. Rebilling is the harm here —
 * losing access for another minute is not.
 */
export const cancelSubscription = async (userId) => {
  const user = await loadUser(userId, { withProvider: true });

  const wasPaid = PAID_PLAN_IDS.includes(user.subscription.planId);
  const providerSubscriptionId = user.subscription.providerSubscriptionId;

  if (wasPaid && providerSubscriptionId && safepayService.isConfigured()) {
    await safepayService.cancelSubscription(providerSubscriptionId);
  }

  downgrade(user.subscription, {
    status: wasPaid ? SUBSCRIPTION_STATUS.CANCELLED : SUBSCRIPTION_STATUS.ACTIVE,
  });

  /*
   * `providerSubscriptionId` is deliberately kept.
   *
   * Safepay echoes this cancellation back as a `subscription.canceled`
   * webhook, and the id is how that event finds its way to this account. With
   * it cleared the event would arrive unclaimable and be logged as an
   * orphan — noise that looks exactly like a real problem.
   */
  await user.save();

  return serializeSubscription(user.subscription);
};

/* ---------------------------------------------------------------------------
 * Provider lifecycle
 *
 * Everything below runs only after `safepayService.verifyWebhook` has checked
 * the HMAC, so `data` is Safepay's word rather than a caller's. Nothing here
 * reads a user id, a plan id, an amount or a price out of the payload:
 *
 *   - which account   comes from `providerSubscriptionId`, or from a pending
 *                     checkout this account opened while signed in;
 *   - which plan      comes from reversing `data.plan_id` through the
 *                     server-side plan-token map;
 *   - what it costs   is Safepay's business, settled before the event fired.
 * ------------------------------------------------------------------------ */

/**
 * Finds the account a subscription event belongs to when nothing is bound yet.
 *
 * This is the delicate one. A Safepay subscription webhook carries no
 * reference to the checkout that opened it — the payloads are documented, and
 * `reference` is not among their fields — so the first event for a new
 * subscription has only `plan_id` and `customer_email` to go on, and an email
 * on its own is not authority to grant anything.
 *
 * So an email alone is not what this matches. All four must hold:
 *
 *   1. the account has a pending checkout intent, which only that account,
 *      signed in, could have created;
 *   2. it was opened against this exact Safepay plan token;
 *   3. it was opened within the last day;
 *   4. the payer's email is the account's own verified address.
 *
 * (1) is the load-bearing one: an attacker cannot manufacture a pending
 * intent on someone else's account, so paying with a stranger's email
 * activates nothing. Emails are unique per account, so at most one row can
 * ever match and the claim is deterministic.
 *
 * No match is a safe outcome — the event is recorded as unclaimed, and the
 * user stays on the plan they were already on.
 */
const claimPendingCheckout = async ({ planToken, customerEmail }) => {
  if (!planToken || typeof customerEmail !== 'string' || customerEmail.length === 0) return null;

  const user = await userRepository.findClaimablePendingCheckout({
    providerPlanId: planToken,
    email: customerEmail,
    since: new Date(Date.now() - CHECKOUT_INTENT_TTL_MS),
    select: PROVIDER_FIELDS,
  });

  if (!user) return null;

  // Belt and braces: never re-point an account that is already bound to a
  // different provider subscription.
  if (user.subscription.providerSubscriptionId) return null;

  return user;
};

/** Applies one verified `subscription.*` event. */
const applySubscriptionEvent = async (type, data) => {
  const subscriptionId = typeof data.id === 'string' ? data.id : null;
  if (!subscriptionId) return { applied: false, reason: 'missing_subscription_id' };

  const planToken = typeof data.plan_id === 'string' ? data.plan_id : null;

  let user = await userRepository.findBySubscriptionId(subscriptionId, {
    provider: PAYMENT_PROVIDER,
    select: PROVIDER_FIELDS,
  });

  if (!user) {
    user = await claimPendingCheckout({ planToken, customerEmail: data.customer_email });
  }

  if (!user) return { applied: false, reason: 'unclaimed' };

  const subscription = user.subscription;
  const updatedAt = safepayService.toDate(data.updated_at);

  // Out-of-order delivery: an event older than what we have already applied
  // describes a past that has been overtaken.
  if (
    updatedAt &&
    subscription.providerUpdatedAt &&
    updatedAt.getTime() < subscription.providerUpdatedAt.getTime()
  ) {
    return { applied: false, reason: 'stale' };
  }

  subscription.provider = PAYMENT_PROVIDER;
  subscription.providerSubscriptionId = subscriptionId;

  const periodEnd = safepayService.toDate(data.current_period_end_date);
  const holdsPaidPlan = PAID_PLAN_IDS.includes(subscription.planId);

  switch (type) {
    /*
     * The shopper committed, but Safepay reports INCOMPLETE until the first
     * charge settles. Binds the ids and nothing else — this is the event a
     * naive integration would mistake for "they paid".
     */
    case SAFEPAY_EVENT.SUBSCRIPTION_CREATED: {
      if (!holdsPaidPlan) subscription.status = SUBSCRIPTION_STATUS.PENDING_PAYMENT;
      break;
    }

    /*
     * Money actually moved — the only event that grants a plan, on the first
     * cycle and on every renewal alike.
     */
    case SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED: {
      const resolved = safepayService.planForToken(planToken);

      // An unrecognised plan token is a plan this deployment does not sell.
      // Refusing to guess is the whole point of resolving it server-side.
      if (!resolved) return { applied: false, reason: 'unknown_plan' };

      subscription.planId = resolved.planId;
      subscription.cycle = resolved.cycle;
      subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
      subscription.cancelAtPeriodEnd = false;
      subscription.startedAt =
        safepayService.toDate(data.created_at) ?? subscription.startedAt ?? new Date();
      subscription.currentPeriodEnd = periodEnd ?? addCycle(new Date(), resolved.cycle);
      clearPendingIntent(subscription);
      break;
    }

    /*
     * A charge failed. Safepay retries, so a plan already paid for is held at
     * `past_due` rather than revoked. A subscription that never activated is
     * simply still waiting — a failed first payment grants nothing.
     */
    case SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_FAILED: {
      subscription.status = holdsPaidPlan
        ? SUBSCRIPTION_STATUS.PAST_DUE
        : SUBSCRIPTION_STATUS.PENDING_PAYMENT;
      break;
    }

    /* Collection stopped. Treated like a missed renewal, not a cancellation. */
    case SAFEPAY_EVENT.SUBSCRIPTION_PAUSED: {
      if (holdsPaidPlan) subscription.status = SUBSCRIPTION_STATUS.PAST_DUE;
      break;
    }

    case SAFEPAY_EVENT.SUBSCRIPTION_RESUMED: {
      if (holdsPaidPlan) {
        subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
        if (periodEnd) subscription.currentPeriodEnd = periodEnd;
      }
      break;
    }

    /*
     * Cancelled. If Safepay has already collected for a period that has not
     * run out, the plan is paid for and stays — `cancelAtPeriodEnd` marks it
     * as the last one and `applyLapse` ends it on the day. Otherwise there is
     * nothing left to honour and the downgrade is immediate.
     */
    case SAFEPAY_EVENT.SUBSCRIPTION_CANCELED: {
      const paidThrough =
        subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() > Date.now();

      if (holdsPaidPlan && paidThrough) {
        subscription.cancelAtPeriodEnd = true;
        subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
        clearPendingIntent(subscription);
      } else {
        downgrade(subscription, { status: SUBSCRIPTION_STATUS.CANCELLED });
      }
      break;
    }

    /* Every billing cycle has been paid; the subscription is over. */
    case SAFEPAY_EVENT.SUBSCRIPTION_ENDED: {
      downgrade(subscription, { status: SUBSCRIPTION_STATUS.CANCELLED });
      break;
    }

    default:
      return { applied: false, reason: 'unhandled_type' };
  }

  subscription.providerUpdatedAt = updatedAt ?? new Date();
  await user.save();

  return { applied: true, reason: type };
};

/**
 * Records and applies one verified provider event.
 *
 * Idempotency is the database's job, not a read-then-write check that races
 * under the concurrent redelivery providers are prone to: the insert either
 * wins or trips the unique index on `(provider, eventId)`. A duplicate is a
 * success — Safepay is retrying because it did not hear us the first time,
 * and the answer is the same 200.
 *
 * An event that was recorded but then failed to apply is the exception: that
 * row is allowed a second attempt, or a transient database error would bury
 * a real payment behind a permanent "already seen".
 *
 * @param {object} event Verified Safepay event envelope.
 */
export const handleProviderEvent = async (event) => {
  const eventId = event.token;
  const type = event.type;

  const record = await webhookEventRepository.record({
    provider: PAYMENT_PROVIDER,
    eventId,
    type,
    occurredAt: safepayService.toDate(event.created_at),
  });

  if (!record.isNew && record.event?.status !== WEBHOOK_EVENT_STATUS.FAILED) {
    return { duplicate: true, applied: false, reason: 'duplicate' };
  }

  try {
    const outcome = String(type).startsWith('subscription.')
      ? await applySubscriptionEvent(type, event.data ?? {})
      : /*
         * `payment.*`, `authorization.*` and `void.*` belong to Safepay's
         * one-off order flow. This server never opens one — every checkout it
         * creates is a subscription — so such an event is somebody else's
         * traffic on a shared endpoint. Recorded, never acted on.
         */
        { applied: false, reason: 'not_a_subscription_event' };

    await webhookEventRepository.markSettled({
      provider: PAYMENT_PROVIDER,
      eventId,
      status: outcome.applied ? WEBHOOK_EVENT_STATUS.PROCESSED : WEBHOOK_EVENT_STATUS.IGNORED,
      reason: outcome.applied ? null : outcome.reason,
    });

    return { duplicate: false, ...outcome };
  } catch (error) {
    // Left `failed` so the retry Safepay is about to send is allowed through
    // rather than dismissed as a duplicate.
    await webhookEventRepository.markSettled({
      provider: PAYMENT_PROVIDER,
      eventId,
      status: WEBHOOK_EVENT_STATUS.FAILED,
      reason: error.message,
    });

    throw error;
  }
};

/* ---------------------------------------------------------------------------
 * Entitlements
 *
 * A limit is only meaningful if we can count the thing it limits. These are
 * the capabilities with a real metric behind them.
 *
 * `teamMembers` counts seats, and the workspace owner holds one: a Starter
 * limit of 1 means "just you". Outstanding invitations count too — a seat that
 * has been offered is a seat that is spoken for, and not counting them would
 * let an owner invite past the limit and only discover it when people accept.
 * ------------------------------------------------------------------------ */

const USAGE_COUNTERS = {
  // Published only. Drafts and archived articles are not rationed, so counting
  // them here would make the number mean something the plan never promised.
  publishedArticles: (userId) =>
    articleRepository.countByAuthor(userId, { status: ARTICLE_STATUS.PUBLISHED }),
  teamMembers: async (userId) => (await teamRepository.countByWorkspace(userId)) + 1,
  // Successful generations so far today, UTC. Resets with the calendar day.
  aiGenerationsPerDay: (userId) => aiUsageRepository.countForDay(userId),
};

/** The plan a user is actually on, defaulting to free if it is somehow unset. */
const planForUser = (user) => findPlan(user.subscription?.planId) ?? findPlan(DEFAULT_PLAN_ID);

const remainingFor = (limit, usage) =>
  limit === null || limit === undefined ? null : Math.max(0, limit - usage);

/**
 * One capability's state: what the plan allows, what has been used, what is
 * left, and whether exceeding it is actually refused.
 */
const describeCapability = async (capability, limit, userId) => {
  const counter = USAGE_COUNTERS[capability];
  const enforced = isCapabilityEnforced(capability);
  const usage = counter ? await counter(userId) : null;
  const remaining = usage === null ? null : remainingFor(limit, usage);

  return {
    limit: limit ?? null,
    usage,
    remaining,
    enforced,
    // Only ever true where a limit exists, usage is known and it is enforced.
    reached: Boolean(enforced && limit !== null && limit !== undefined && usage >= limit),
  };
};

/** Every capability on the caller's plan, with usage where it is countable. */
export const getEntitlements = async (userId) => {
  const user = await loadUser(userId);
  const plan = planForUser(user);

  const entries = await Promise.all(
    Object.entries(plan.limits).map(async ([capability, limit]) => [
      capability,
      await describeCapability(capability, limit, userId),
    ]),
  );

  return {
    planId: plan.id,
    capabilities: Object.fromEntries(entries),
    enforcedCapabilities: [...ENFORCED_CAPABILITIES],
  };
};

/**
 * Refuses an action that would take the caller past their plan's limit.
 *
 * Called by the services that own the write, before anything is persisted, so
 * a rejection leaves nothing behind. The plan is read from the user document —
 * never from the request — so no payload or browser value can raise it.
 *
 * @throws {ApiError} 403 `PLAN_LIMIT_REACHED`
 */
export const assertWithinLimit = async (userId, capability) => {
  if (!isCapabilityEnforced(capability)) return;

  const user = await loadUser(userId);
  const plan = planForUser(user);
  const limit = plan.limits?.[capability];

  // Null means unlimited on this plan; undefined means the plan does not
  // describe this capability at all. Neither is a ceiling.
  if (limit === null || limit === undefined) return;

  const usage = await USAGE_COUNTERS[capability](userId);
  if (usage < limit) return;

  throw new ApiError(403, LIMIT_MESSAGES[capability]?.(plan, limit) ?? 'Plan limit reached', {
    code: 'PLAN_LIMIT_REACHED',
    details: [{ field: capability, message: `Limit of ${limit} reached on the ${plan.name} plan` }],
  });
};

/**
 * Claims one AI generation against today's allowance.
 *
 * The check and the increment are a single atomic update, so two requests
 * arriving together at 4 of 5 cannot both become the fifth. The caller must
 * `releaseAiGeneration` if the work then fails, so a generation that produced
 * nothing does not spend the day.
 *
 * @throws {ApiError} 403 `PLAN_LIMIT_REACHED` when today's allowance is gone.
 */
export const consumeAiGeneration = async (userId) => {
  const user = await loadUser(userId);
  const plan = planForUser(user);
  const limit = plan.limits?.aiGenerationsPerDay ?? null;

  const { allowed, count } = await aiUsageRepository.reserve({ user: userId, limit });

  if (!allowed) {
    throw new ApiError(403, LIMIT_MESSAGES.aiGenerationsPerDay(plan, limit), {
      code: 'PLAN_LIMIT_REACHED',
      details: [
        {
          field: 'aiGenerationsPerDay',
          message: `Daily limit of ${limit} reached on the ${plan.name} plan`,
        },
      ],
    });
  }

  return { count, limit };
};

/** Returns a claimed generation to the pool after the work failed. */
export const releaseAiGeneration = (userId) => aiUsageRepository.release({ user: userId });

const LIMIT_MESSAGES = {
  publishedArticles: (plan, limit) =>
    `The ${plan.name} plan includes ${limit} published article${limit === 1 ? '' : 's'}. ` +
    'Unpublish or archive one, or upgrade to publish more. Your drafts are unaffected.',
  aiGenerationsPerDay: (plan, limit) =>
    `The ${plan.name} plan includes ${limit} AI generation${limit === 1 ? '' : 's'} per day. ` +
    'Your allowance resets at midnight UTC, or upgrade for unlimited generations.',
  teamMembers: (plan, limit) =>
    limit === 1
      ? `The ${plan.name} plan is for a single user. Upgrade to invite your team.`
      : `The ${plan.name} plan includes ${limit} seats, including you. Upgrade to invite more.`,
};

export default {
  isPaymentConfigured,
  findPlan,
  listPlans,
  chargeFor,
  getSubscription,
  requestUpgrade,
  createCheckout,
  confirmUpgrade,
  handleProviderEvent,
  cancelSubscription,
  getEntitlements,
  assertWithinLimit,
  consumeAiGeneration,
  releaseAiGeneration,
};
