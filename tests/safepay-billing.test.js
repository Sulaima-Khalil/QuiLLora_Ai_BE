import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  API,
  app,
  asUser,
  planToken,
  postWebhook,
  registerUser,
  request,
  safepayEvent,
  signSafepay,
  stubSafepayNetwork,
  subscriptionData,
} from './helpers.js';
import { User, WebhookEvent } from '../src/models/index.js';
import config from '../src/config/env.js';
import safepayService from '../src/services/safepay.service.js';
import { SAFEPAY_EVENT } from '../src/constants/index.js';

/**
 * The Safepay integration, from the only angle that matters: what does it
 * take to get a paid plan out of this server?
 *
 * The answer these tests hold it to is "an event Safepay signed, and nothing
 * else". Not a request body. Not a URL someone landed on. Not another user's
 * payment. Not the same payment twice.
 */

const HOUR = 60 * 60 * 1000;
const future = (ms = 30 * 24 * HOUR) => new Date(Date.now() + ms);

let safepay;

beforeEach(() => {
  safepay = stubSafepayNetwork();
});

afterEach(() => {
  safepay.restore();
});

/** Registers a user and opens a real checkout for them. */
const withCheckout = async ({ planId = 'pro', cycle = 'monthly' } = {}) => {
  const account = await registerUser();

  const response = await asUser(account.accessToken)
    .post(`${API}/billing/checkout`)
    .send({ planId, cycle })
    .expect(201);

  return { ...account, checkout: response.body.data };
};

/** The plan a user is actually on, read straight from the database. */
const planOf = async (userId) => (await User.findById(userId)).subscription;

/* ===========================================================================
 * POST /billing/checkout
 * ======================================================================== */

describe('POST /billing/checkout', () => {
  it('rejects an unauthenticated caller', async () => {
    await request(app)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(401);
  });

  it('returns a Safepay checkout URL for Pro', async () => {
    const { checkout } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    expect(checkout.checkoutUrl).toContain('/checkout/subscribe');
    expect(checkout.planId).toBe('pro');
    expect(checkout.activated).toBe(false);
  });

  it('opens the checkout against the configured plan token, not the request', async () => {
    await withCheckout({ planId: 'business', cycle: 'yearly' });

    expect(safepay.calls.checkouts).toHaveLength(1);
    expect(safepay.calls.checkouts[0].planToken).toBe(planToken('business', 'yearly'));
  });

  it('records the pending intent and grants nothing', async () => {
    const { user } = await withCheckout({ planId: 'business', cycle: 'yearly' });
    const subscription = await planOf(user.id);

    expect(subscription.planId).toBe('starter');
    expect(subscription.status).toBe('active');
    expect(subscription.pendingPlanId).toBe('business');
    expect(subscription.pendingCycle).toBe('yearly');
    expect(subscription.pendingSince).toBeInstanceOf(Date);
  });

  it('rejects an unknown plan', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'enterprise-unlimited', cycle: 'monthly' })
      .expect(422);
  });

  it('rejects an unknown billing cycle', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'pro', cycle: 'fortnightly' })
      .expect(422);
  });

  it('refuses to open a paid checkout for Starter', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'starter', cycle: 'monthly' })
      .expect(400);

    expect(response.body.message).toMatch(/free/i);
    expect(safepay.calls.checkouts).toHaveLength(0);
  });

  it('ignores a client-supplied amount, price and currency', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({
        planId: 'business',
        cycle: 'yearly',
        amount: 1,
        price: 0,
        currency: 'XXX',
        amountDue: 0,
      })
      .expect(201);

    // The plan token is the only thing that reached Safepay, and the amount
    // lives on that plan — there is nowhere for a smuggled figure to land.
    expect(safepay.calls.checkouts[0]).toEqual({
      planToken: planToken('business', 'yearly'),
      reference: expect.any(String),
    });
  });

  it('ignores client-supplied provider identifiers', async () => {
    const { accessToken, user } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({
        planId: 'pro',
        cycle: 'monthly',
        providerCustomerId: 'cus_attacker',
        providerSubscriptionId: 'sub_attacker',
        provider: 'not-safepay',
      })
      .expect(201);

    const stored = await User.findById(user.id).select(
      '+subscription.providerCustomerId +subscription.providerSubscriptionId',
    );

    expect(stored.subscription.providerCustomerId).toBeNull();
    expect(stored.subscription.providerSubscriptionId).toBeNull();
    expect(stored.subscription.provider).toBeNull();
  });

  it('ignores a client-supplied plan token', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'pro', cycle: 'monthly', planToken: planToken('business', 'yearly') })
      .expect(201);

    expect(safepay.calls.checkouts[0].planToken).toBe(planToken('pro', 'monthly'));
  });

  it('never returns a secret', async () => {
    const { checkout } = await withCheckout();
    const body = JSON.stringify(checkout);
    const { safepay: settings } = config.payments;

    expect(body).not.toContain(settings.webhookSecret);
    expect(body).not.toContain(settings.v1Secret);
    expect(body).not.toContain(settings.apiKey);
  });

  it('returns a URL and the caller’s own plan choice, and no other field', async () => {
    const { checkout } = await withCheckout();

    /*
     * The plan token and the reference do appear — inside the checkout URL,
     * where Safepay's documented `/checkout/subscribe?plan_id=…&reference=…`
     * format puts them. Neither is a credential: the token names a product,
     * and the reference is write-only here, since a Safepay subscription
     * event carries no reference back and the claim rule never reads it.
     *
     * What matters is that nothing else rides along, so the response cannot
     * become a source of provider state for a client to echo back.
     */
    expect(Object.keys(checkout).sort()).toEqual([
      'activated',
      'checkoutUrl',
      'cycle',
      'planId',
      'subscription',
    ]);

    expect(checkout.subscription).not.toHaveProperty('providerSubscriptionId');
    expect(checkout.subscription).not.toHaveProperty('providerCustomerId');
    expect(checkout.subscription).not.toHaveProperty('pendingReference');
    expect(checkout.subscription.planId).toBe('starter');
  });

  it('refuses a second subscription over a live one', async () => {
    const { accessToken, user } = await registerUser();
    const billingService = (await import('../src/services/billing.service.js')).default;

    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    const response = await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'business', cycle: 'monthly' })
      .expect(409);

    expect(response.body.message).toMatch(/cancel/i);
    expect(safepay.calls.checkouts).toHaveLength(0);
  });

  it('answers 503 when Safepay is not configured, and opens nothing', async () => {
    const original = safepayService.isConfigured;
    safepayService.isConfigured = () => false;

    try {
      const { accessToken, user } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/billing/checkout`)
        .send({ planId: 'pro', cycle: 'monthly' })
        .expect(503);

      expect(response.body.code).toBe('PAYMENT_NOT_CONFIGURED');
      expect(response.body.data?.checkoutUrl).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//);
      expect(safepay.calls.checkouts).toHaveLength(0);
      expect((await planOf(user.id)).planId).toBe('starter');
    } finally {
      safepayService.isConfigured = original;
    }
  });

  it('answers 503 for a plan and cycle with no Safepay plan configured', async () => {
    const original = safepayService.planTokenFor;
    safepayService.planTokenFor = () => null;

    try {
      const { accessToken } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/billing/checkout`)
        .send({ planId: 'pro', cycle: 'yearly' })
        .expect(503);

      expect(response.body.code).toBe('PAYMENT_NOT_CONFIGURED');
      expect(safepay.calls.checkouts).toHaveLength(0);
    } finally {
      safepayService.planTokenFor = original;
    }
  });

  it('leaves no pending intent when Safepay fails to open the checkout', async () => {
    safepayService.createSubscriptionCheckout = async () => {
      throw new Error('provider down');
    };

    const { accessToken, user } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/checkout`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(500);

    const subscription = await planOf(user.id);
    expect(subscription.pendingPlanId).toBeNull();
    expect(subscription.planId).toBe('starter');
  });
});

/* ===========================================================================
 * Webhook authenticity
 * ======================================================================== */

describe('Webhook authenticity', () => {
  const anyEvent = () =>
    safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
      data: subscriptionData({ email: 'nobody@example.test' }),
    });

  it('rejects a callback with no signature', async () => {
    const response = await postWebhook(anyEvent(), { signature: null }).expect(400);

    expect(response.body.code).toBe('INVALID_WEBHOOK');
    expect(await WebhookEvent.countDocuments({})).toBe(0);
  });

  it('rejects a wrong signature', async () => {
    await postWebhook(anyEvent(), { signature: 'a'.repeat(128) }).expect(400);

    expect(await WebhookEvent.countDocuments({})).toBe(0);
  });

  it('rejects a signature computed over the whole envelope instead of `data`', async () => {
    // A plausible near-miss: Safepay signs `data`, not the event.
    const event = anyEvent();
    await postWebhook(event, { signature: signSafepay(event) }).expect(400);

    expect(await WebhookEvent.countDocuments({})).toBe(0);
  });

  it('rejects a body altered after signing', async () => {
    const event = anyEvent();
    const signature = signSafepay(event.data);

    const tampered = { ...event, data: { ...event.data, amount: 1 } };

    await postWebhook(tampered, { signature, body: JSON.stringify(tampered) }).expect(400);
  });

  it('rejects malformed JSON', async () => {
    await postWebhook(anyEvent(), { body: '{ not json at all', signature: 'x'.repeat(128) })
      .expect(400);
  });

  it('rejects an empty body', async () => {
    await postWebhook(anyEvent(), { body: '', signature: 'x'.repeat(128) }).expect(400);
  });

  it('rejects an envelope with no `data`', async () => {
    const event = { token: `evt_${randomUUID()}`, type: 'payment.succeeded', version: '2.0.0' };

    await postWebhook(event, { body: JSON.stringify(event), signature: 'x'.repeat(128) })
      .expect(400);
  });

  it('rejects an envelope with no event id', async () => {
    const data = subscriptionData({ email: 'nobody@example.test' });
    const event = { type: 'subscription.created', version: '2.0.0', data };

    await postWebhook(event, { body: JSON.stringify(event), signature: signSafepay(data) })
      .expect(400);
  });

  it('rejects a correctly signed event addressed to another merchant', async () => {
    const event = { ...anyEvent(), merchant_api_key: 'sec_someone-else' };

    await postWebhook(event).expect(400);
    expect(await WebhookEvent.countDocuments({})).toBe(0);
  });

  it('tells a rejected caller nothing about why, or about what they sent', async () => {
    const event = safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
      data: subscriptionData({ email: 'leak-me@example.test' }),
    });

    const response = await postWebhook(event, { signature: 'a'.repeat(128) }).expect(400);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('leak-me@example.test');
    expect(body).not.toContain(event.token);
    expect(body).not.toContain(config.payments.safepay.webhookSecret);
    expect(body).not.toMatch(/signature|hmac|sha512/i);
  });

  it('accepts a correctly signed event', async () => {
    const response = await postWebhook(anyEvent()).expect(200);

    expect(response.body).toEqual({ success: true, received: true });
  });

  it('answers 503 when Safepay is not configured', async () => {
    const original = safepayService.isConfigured;
    safepayService.isConfigured = () => false;

    try {
      const response = await postWebhook(anyEvent()).expect(503);
      expect(response.body.code).toBe('PAYMENT_NOT_CONFIGURED');
    } finally {
      safepayService.isConfigured = original;
    }
  });
});

/* ===========================================================================
 * Activation
 * ======================================================================== */

describe('Activation by verified payment', () => {
  it('activates the plan the Safepay plan token maps to', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });
    const periodEnd = future();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, periodEnd }),
      }),
    ).expect(200);

    const subscription = await planOf(user.id);

    expect(subscription.planId).toBe('pro');
    expect(subscription.cycle).toBe('monthly');
    expect(subscription.status).toBe('active');
    expect(subscription.provider).toBe('safepay');
    expect(subscription.currentPeriodEnd.getTime()).toBeCloseTo(periodEnd.getTime(), -4);
  });

  it('clears the pending intent and stores the provider ids privately', async () => {
    const { accessToken, user, payload } = await withCheckout({ planId: 'business', cycle: 'yearly' });
    const subscriptionId = `sub_${randomUUID()}`;

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: subscriptionId,
          planId: 'business',
          cycle: 'yearly',
          email: payload.email,
          periodEnd: future(),
        }),
      }),
    ).expect(200);

    const stored = await User.findById(user.id).select(
      '+subscription.providerSubscriptionId +subscription.pendingReference +subscription.pendingProviderPlanId',
    );

    expect(stored.subscription.planId).toBe('business');
    expect(stored.subscription.pendingPlanId).toBeNull();
    expect(stored.subscription.pendingReference).toBeNull();
    expect(stored.subscription.pendingProviderPlanId).toBeNull();
    expect(stored.subscription.providerSubscriptionId).toBe(subscriptionId);

    // ...and none of it is visible over the API.
    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(JSON.stringify(response.body)).not.toContain(subscriptionId);
  });

  it('grants the token’s plan, not the plan the pending intent named', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });
    const subscriptionId = `sub_${randomUUID()}`;

    // Bind the subscription to the account with the plan they checked out on.
    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: subscriptionId,
          planId: 'pro',
          cycle: 'monthly',
          email: payload.email,
          periodEnd: future(),
        }),
      }),
    ).expect(200);

    // Now leave a pending intent for Business lying around, and have Safepay
    // bill the same subscription against Pro yearly.
    await User.findByIdAndUpdate(user.id, {
      'subscription.pendingPlanId': 'business',
      'subscription.pendingCycle': 'yearly',
    });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: subscriptionId,
          planId: 'pro',
          cycle: 'yearly',
          email: payload.email,
          periodEnd: future(),
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    // The signed plan token wins over anything the account had recorded.
    const subscription = await planOf(user.id);
    expect(subscription.planId).toBe('pro');
    expect(subscription.cycle).toBe('yearly');
    expect(subscription.pendingPlanId).toBeNull();
  });

  it('unlocks the entitlements the plan promises', async () => {
    const { accessToken, user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    // Starter is single-seat, so this is refused before the payment.
    await asUser(accessToken).post(`${API}/team`).send({ email: 'colleague@example.test' }).expect(403);

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, periodEnd: future() }),
      }),
    ).expect(200);

    await asUser(accessToken).post(`${API}/team`).send({ email: 'colleague@example.test' }).expect(201);
    expect((await planOf(user.id)).planId).toBe('pro');
  });

  it('does nothing for an unrecognised plan token', async () => {
    const { user, payload } = await withCheckout();

    const data = subscriptionData({ email: payload.email });
    data.plan_id = 'plan_not-one-of-ours';

    await postWebhook(
      safepayEvent({ type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED, data }),
    ).expect(200);

    expect((await planOf(user.id)).planId).toBe('starter');
  });
});

/* ===========================================================================
 * Idempotency
 * ======================================================================== */

describe('Idempotency', () => {
  it('treats a redelivered event as a no-op', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    const event = safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
      data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, periodEnd: future() }),
    });

    await postWebhook(event).expect(200);
    const first = await planOf(user.id);

    await postWebhook(event).expect(200);
    await postWebhook(event).expect(200);

    const after = await planOf(user.id);

    expect(after.planId).toBe('pro');
    expect(after.currentPeriodEnd.getTime()).toBe(first.currentPeriodEnd.getTime());
    expect(await WebhookEvent.countDocuments({ eventId: event.token })).toBe(1);
  });

  it('survives concurrent delivery of the same event', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    const event = safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
      data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, periodEnd: future() }),
    });

    const responses = await Promise.all([postWebhook(event), postWebhook(event), postWebhook(event)]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await WebhookEvent.countDocuments({ eventId: event.token })).toBe(1);
    expect((await planOf(user.id)).planId).toBe('pro');
  });

  it('records every distinct event it accepts', async () => {
    const { payload } = await withCheckout();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED,
        data: subscriptionData({ email: payload.email, status: 'INCOMPLETE' }),
      }),
    ).expect(200);

    const recorded = await WebhookEvent.findOne({ type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED });

    expect(recorded.provider).toBe('safepay');
    expect(recorded.status).toBe('processed');
    expect(recorded.occurredAt).toBeInstanceOf(Date);
  });

  it('never stores the payload alongside the event', async () => {
    const { payload } = await withCheckout();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ email: payload.email, periodEnd: future() }),
      }),
    ).expect(200);

    const rows = JSON.stringify(await WebhookEvent.find({}).lean());

    expect(rows).not.toContain(payload.email);
    expect(rows).not.toContain('PKR');
  });
});

/* ===========================================================================
 * Cross-account safety
 * ======================================================================== */

describe('One account cannot pay for another', () => {
  it('will not activate a stranger’s plan with a stranger’s email', async () => {
    // Bob is waiting on a payment. Alice is not.
    const alice = await registerUser();
    const bob = await withCheckout({ planId: 'business', cycle: 'monthly' });

    // An event naming Alice's address, against the plan Bob is buying.
    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          planId: 'business',
          cycle: 'monthly',
          email: alice.payload.email,
          periodEnd: future(),
        }),
      }),
    ).expect(200);

    // Alice never asked to buy anything, so nothing may be granted to her...
    expect((await planOf(alice.user.id)).planId).toBe('starter');
    // ...and Bob is not activated by an event that is not his.
    expect((await planOf(bob.user.id)).planId).toBe('starter');
  });

  it('will not claim an account that has no pending checkout', async () => {
    const { user, payload } = await registerUser();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ email: payload.email, periodEnd: future() }),
      }),
    ).expect(200);

    expect((await planOf(user.id)).planId).toBe('starter');
    expect((await WebhookEvent.findOne({})).status).toBe('ignored');
  });

  it('will not claim an intent for a different plan', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    // Paid against Business; the intent was opened against Pro monthly.
    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ planId: 'business', cycle: 'yearly', email: payload.email }),
      }),
    ).expect(200);

    expect((await planOf(user.id)).planId).toBe('starter');
  });

  it('will not claim an intent older than a day', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    await User.findByIdAndUpdate(user.id, {
      'subscription.pendingSince': new Date(Date.now() - 25 * HOUR),
    });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email }),
      }),
    ).expect(200);

    expect((await planOf(user.id)).planId).toBe('starter');
  });

  it('routes each account’s events to that account only', async () => {
    const alice = await withCheckout({ planId: 'pro', cycle: 'monthly' });
    const bob = await withCheckout({ planId: 'business', cycle: 'monthly' });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          planId: 'pro',
          cycle: 'monthly',
          email: alice.payload.email,
          periodEnd: future(),
        }),
      }),
    ).expect(200);

    expect((await planOf(alice.user.id)).planId).toBe('pro');
    expect((await planOf(bob.user.id)).planId).toBe('starter');
  });
});

/* ===========================================================================
 * Nothing else grants a plan
 * ======================================================================== */

describe('No other route grants a plan', () => {
  it('landing on the success URL activates nothing', async () => {
    const { accessToken, user } = await withCheckout({ planId: 'business', cycle: 'yearly' });

    // The success page does exactly one thing: re-read the server.
    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);

    expect(response.body.data.subscription.planId).toBe('starter');
    expect(response.body.data.subscription.pendingPlanId).toBe('business');
    expect((await planOf(user.id)).planId).toBe('starter');
  });

  it('a pending upgrade grants no entitlements', async () => {
    const { accessToken } = await withCheckout({ planId: 'business', cycle: 'yearly' });

    // Business is unlimited seats. The intent is not the plan.
    await asUser(accessToken)
      .post(`${API}/team`)
      .send({ email: 'colleague@example.test' })
      .expect(403);

    const entitlements = await asUser(accessToken).get(`${API}/billing/entitlements`).expect(200);
    expect(entitlements.body.data.entitlements.planId).toBe('starter');
  });

  it('a failed first payment grants nothing', async () => {
    const { accessToken, user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_FAILED,
        data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, status: 'UNPAID' }),
      }),
    ).expect(200);

    const subscription = await planOf(user.id);
    expect(subscription.planId).toBe('starter');
    expect(subscription.status).toBe('pending_payment');

    await asUser(accessToken).post(`${API}/team`).send({ email: 'nope@example.test' }).expect(403);
  });

  it('`subscription.created` alone grants nothing — it is not a payment', async () => {
    const { user, payload } = await withCheckout({ planId: 'pro', cycle: 'monthly' });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED,
        data: subscriptionData({ planId: 'pro', cycle: 'monthly', email: payload.email, status: 'INCOMPLETE' }),
      }),
    ).expect(200);

    const subscription = await planOf(user.id);
    expect(subscription.planId).toBe('starter');
    expect(subscription.status).toBe('pending_payment');
  });

  it('a one-off `payment.succeeded` cannot activate a subscription', async () => {
    const { user, payload } = await withCheckout({ planId: 'business', cycle: 'yearly' });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.PAYMENT_SUCCEEDED,
        data: {
          tracker: `track_${randomUUID()}`,
          intent: 'CYBERSOURCE',
          state: 'TRACKER_ENDED',
          customer_email: payload.email,
          amount: 4_500_000,
          currency: 'PKR',
          metadata: { order_id: 'anything', source: 'custom' },
        },
      }),
    ).expect(200);

    expect((await planOf(user.id)).planId).toBe('starter');
    expect((await WebhookEvent.findOne({})).status).toBe('ignored');
  });
});

/* ===========================================================================
 * Lifecycle
 * ======================================================================== */

describe('Subscription lifecycle', () => {
  /** Puts an account on a live Pro subscription via the real webhook path. */
  const activate = async ({ planId = 'pro', cycle = 'monthly', periodEnd = future() } = {}) => {
    const account = await withCheckout({ planId, cycle });
    const subscriptionId = `sub_${randomUUID()}`;

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: subscriptionId,
          planId,
          cycle,
          email: account.payload.email,
          periodEnd,
        }),
      }),
    ).expect(200);

    return { ...account, subscriptionId };
  };

  it('renews on a recurring payment, extending the period', async () => {
    const account = await activate({ periodEnd: future(1 * HOUR) });
    const renewedTo = future(31 * 24 * HOUR);

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          periodEnd: renewedTo,
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    const subscription = await planOf(account.user.id);
    expect(subscription.status).toBe('active');
    expect(subscription.currentPeriodEnd.getTime()).toBeCloseTo(renewedTo.getTime(), -4);
  });

  it('moves a live plan to past_due when a renewal fails, without revoking it', async () => {
    const account = await activate();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_FAILED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'UNPAID',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    const subscription = await planOf(account.user.id);
    expect(subscription.status).toBe('past_due');
    // Still theirs — Safepay retries, and a retryable failure is not a lapse.
    expect(subscription.planId).toBe('pro');
  });

  it('recovers from past_due when the retry succeeds', async () => {
    const account = await activate();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_FAILED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'UNPAID',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          periodEnd: future(),
          updatedAt: new Date(Date.now() + 2000),
        }),
      }),
    ).expect(200);

    expect((await planOf(account.user.id)).status).toBe('active');
  });

  it('pauses to past_due and resumes to active', async () => {
    const account = await activate();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAUSED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'PAUSED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    expect((await planOf(account.user.id)).status).toBe('past_due');

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_RESUMED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          periodEnd: future(),
          updatedAt: new Date(Date.now() + 2000),
        }),
      }),
    ).expect(200);

    expect((await planOf(account.user.id)).status).toBe('active');
  });

  it('keeps a cancelled plan to the end of the period already paid for', async () => {
    const account = await activate({ periodEnd: future(10 * 24 * HOUR) });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CANCELED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'CANCELED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    const subscription = await planOf(account.user.id);
    expect(subscription.planId).toBe('pro');
    expect(subscription.status).toBe('active');
    expect(subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('drops the plan once that period has passed', async () => {
    const account = await activate({ periodEnd: future(10 * 24 * HOUR) });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CANCELED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'CANCELED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    // Wind the clock past the paid-up period.
    await User.findByIdAndUpdate(account.user.id, {
      'subscription.currentPeriodEnd': new Date(Date.now() - 1000),
    });

    const response = await asUser(account.accessToken)
      .get(`${API}/billing/subscription`)
      .expect(200);

    expect(response.body.data.subscription).toMatchObject({
      planId: 'starter',
      status: 'cancelled',
      cancelAtPeriodEnd: false,
    });

    // Persisted, not merely presented.
    expect((await planOf(account.user.id)).planId).toBe('starter');
  });

  it('downgrades immediately when a cancellation leaves nothing paid for', async () => {
    const account = await activate({ periodEnd: future(1000) });

    await User.findByIdAndUpdate(account.user.id, {
      'subscription.currentPeriodEnd': new Date(Date.now() - 1000),
    });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CANCELED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'CANCELED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    const subscription = await planOf(account.user.id);
    expect(subscription.planId).toBe('starter');
    expect(subscription.status).toBe('cancelled');
  });

  it('downgrades when the subscription ends', async () => {
    const account = await activate();

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_ENDED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'ENDED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    const subscription = await planOf(account.user.id);
    expect(subscription.planId).toBe('starter');
    expect(subscription.status).toBe('cancelled');
    expect(subscription.currentPeriodEnd).toBeNull();
  });

  it('ignores an event that arrives out of order', async () => {
    const account = await activate();

    // A `subscription.created` from before the payment, delivered late.
    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'INCOMPLETE',
          updatedAt: new Date(Date.now() - 10 * HOUR),
        }),
      }),
    ).expect(200);

    // The plan survives it.
    expect((await planOf(account.user.id)).status).toBe('active');
  });

  it('affects only the account the subscription belongs to', async () => {
    const alice = await activate();
    const bob = await activate({ planId: 'business', cycle: 'monthly' });

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_ENDED,
        data: subscriptionData({
          id: alice.subscriptionId,
          email: alice.payload.email,
          status: 'ENDED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    expect((await planOf(alice.user.id)).planId).toBe('starter');
    expect((await planOf(bob.user.id)).planId).toBe('business');
  });
});

/* ===========================================================================
 * Cancellation
 * ======================================================================== */

describe('Cancellation', () => {
  const activate = async ({ planId = 'pro', cycle = 'monthly' } = {}) => {
    const account = await withCheckout({ planId, cycle });
    const subscriptionId = `sub_${randomUUID()}`;

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_PAYMENT_SUCCEEDED,
        data: subscriptionData({
          id: subscriptionId,
          planId,
          cycle,
          email: account.payload.email,
          periodEnd: future(),
        }),
      }),
    ).expect(200);

    return { ...account, subscriptionId };
  };

  it('cancels at Safepay as well as here', async () => {
    const account = await activate();

    await asUser(account.accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    expect(safepay.calls.cancellations).toEqual([account.subscriptionId]);
    expect((await planOf(account.user.id)).planId).toBe('starter');
  });

  it('keeps the plan when Safepay refuses the cancellation', async () => {
    const account = await activate();

    safepayService.cancelSubscription = async () => {
      throw new Error('provider down');
    };

    await asUser(account.accessToken).post(`${API}/billing/subscription/cancel`).expect(500);

    // Downgrading here while Safepay carries on billing is the one outcome a
    // cancel button must never produce.
    expect((await planOf(account.user.id)).planId).toBe('pro');
  });

  it('cancels only the caller’s subscription', async () => {
    const alice = await activate();
    const bob = await activate({ planId: 'business', cycle: 'monthly' });

    await asUser(bob.accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    expect(safepay.calls.cancellations).toEqual([bob.subscriptionId]);
    expect((await planOf(alice.user.id)).planId).toBe('pro');
    expect((await planOf(bob.user.id)).planId).toBe('starter');
  });

  it('needs no provider call for an account that never paid', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    expect(safepay.calls.cancellations).toHaveLength(0);
  });

  it('absorbs the cancellation Safepay echoes back', async () => {
    const account = await activate();

    await asUser(account.accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    await postWebhook(
      safepayEvent({
        type: SAFEPAY_EVENT.SUBSCRIPTION_CANCELED,
        data: subscriptionData({
          id: account.subscriptionId,
          email: account.payload.email,
          status: 'CANCELED',
          updatedAt: new Date(Date.now() + 1000),
        }),
      }),
    ).expect(200);

    expect((await planOf(account.user.id)).planId).toBe('starter');
  });
});

/* ===========================================================================
 * Secrets
 * ======================================================================== */

describe('Provider secrets never leave the server', () => {
  const secrets = () => {
    const { safepay: s } = config.payments;
    return [s.apiKey, s.v1Secret, s.webhookSecret, ...Object.values(s.planIds.pro), ...Object.values(s.planIds.business)];
  };

  it('are absent from every billing response', async () => {
    const { accessToken } = await withCheckout();

    const responses = await Promise.all([
      request(app).get(`${API}/billing/plans`),
      asUser(accessToken).get(`${API}/billing/subscription`),
      asUser(accessToken).get(`${API}/billing/entitlements`),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);
      for (const secret of secrets()) expect(body).not.toContain(secret);
    }
  });

  it('are absent from the session user', async () => {
    const { accessToken } = await withCheckout();

    const response = await asUser(accessToken).get(`${API}/auth/me`).expect(200);
    const body = JSON.stringify(response.body);

    for (const secret of secrets()) expect(body).not.toContain(secret);
    expect(body).not.toMatch(/pendingReference|providerSubscriptionId|providerCustomerId/);
  });

  it('reports only that payment is available, never how', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);

    expect(response.body.data.paymentConfigured).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|apiKey|plan_|sec_/i);
  });
});
