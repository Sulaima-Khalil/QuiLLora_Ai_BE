import { describe, expect, it } from '@jest/globals';
import {
  API,
  app,
  asUser,
  postWebhook,
  registerUser,
  request,
  safepayEvent,
  signSafepay,
  subscriptionData,
} from './helpers.js';
import { User, WebhookEvent } from '../src/models/index.js';
import config from '../src/config/env.js';
import {
  PAYMENT_WEBHOOK_PATH,
  SAFEPAY_EVENT,
  SUBSCRIPTION_STATUS,
} from '../src/constants/index.js';
import { serializeSubscription } from '../src/utils/serializers.js';

/**
 * The plumbing the Safepay integration sits on.
 *
 * Signature verification, idempotency and provider-id privacy each depend on
 * something further down that is easy to break by accident and silent when it
 * breaks — a body parser mounted in the wrong order, an index that was never
 * created, a `select: false` that stopped applying. These tests hold those in
 * place; safepay-billing.test.js covers the behaviour built on top.
 */

describe('Raw body preservation', () => {
  it('gives the webhook the exact bytes the signature was computed over', async () => {
    /*
     * The proof is the signature itself. `express.json()` parsing and
     * re-serialising this body would reorder nothing here but reformat
     * everything, and the HMAC would not match — so a 200 means the bytes
     * survived the middleware stack intact.
     */
    const event = safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED,
      data: subscriptionData({ email: 'nobody@example.test', status: 'INCOMPLETE' }),
    });

    const spaced = JSON.stringify(event, null, 2);

    await postWebhook(event, { body: spaced, signature: signSafepay(event.data) }).expect(200);
  });

  it('is not parsed before the handler sees it — malformed JSON reaches the route', async () => {
    /*
     * `express.json()` would have answered 400 with a parse error of its own
     * before any route ran. A 400 carrying the webhook's own code means the
     * raw parser took the body and the handler made the decision.
     */
    const response = await request(app)
      .post(PAYMENT_WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-sfpy-signature', 'a'.repeat(128))
      .send('not-json-at-all-%%%')
      .expect(400);

    expect(response.body.code).toBe('INVALID_WEBHOOK');
  });

  it('survives the NoSQL sanitiser without being rebuilt as a plain object', async () => {
    /*
     * A Buffer is a non-null, non-array object, so a naive scrub walks it and
     * hands back `{"0":123,…}`. The signature is the canary: it only verifies
     * if the bytes are still bytes.
     */
    const event = safepayEvent({
      type: SAFEPAY_EVENT.SUBSCRIPTION_CREATED,
      data: subscriptionData({ email: 'nobody@example.test', status: 'INCOMPLETE' }),
    });

    await postWebhook(event).expect(200);
  });

  it('leaves normal API routes parsed as objects', async () => {
    const { accessToken } = await registerUser();

    // If the raw parser had leaked onto other paths, this body would arrive as
    // a Buffer and validation would reject it.
    const response = await asUser(accessToken)
      .post(`${API}/articles`)
      .send({ title: 'Parsed Normally', content: '<p>Body.</p>', category: 'Engineering' })
      .expect(201);

    expect(response.body.data.article.title).toBe('Parsed Normally');
  });

  it('still rejects malformed JSON on normal routes', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/articles`)
      .set('Content-Type', 'application/json')
      .send('{ broken json')
      .expect(400);
  });

  it('does not echo the payload back to an unauthenticated caller', async () => {
    const secretish = JSON.stringify({ token: 'evt_1', card: 'sensitive-value-here' });

    const response = await request(app)
      .post(PAYMENT_WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-sfpy-signature', 'a'.repeat(128))
      .send(secretish)
      .expect(400);

    expect(JSON.stringify(response.body)).not.toContain('sensitive-value-here');
  });
});

describe('An unsigned webhook is refused', () => {
  it('answers 400 without saying what was wrong', async () => {
    const response = await request(app)
      .post(PAYMENT_WEBHOOK_PATH)
      .send({ token: 'evt_1', type: 'subscription.payment.succeeded', data: {} })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('INVALID_WEBHOOK');
    expect(response.body.message).toBe('Invalid webhook.');
  });

  it('records nothing — no event row is written', async () => {
    await request(app)
      .post(PAYMENT_WEBHOOK_PATH)
      .send({ token: 'evt_should_not_persist', type: 'subscription.payment.succeeded', data: {} })
      .expect(400);

    expect(await WebhookEvent.countDocuments({})).toBe(0);
  });

  it('cannot activate a plan, however convincing the payload', async () => {
    const { accessToken, user } = await registerUser();

    /*
     * Everything an attacker might hope the server reads: a user id, a plan,
     * a cycle, a status, a subscription id. None of it is looked at, because
     * the signature check happens first and there is no signature.
     */
    await request(app)
      .post(PAYMENT_WEBHOOK_PATH)
      .send({
        token: 'evt_forged',
        type: 'subscription.payment.succeeded',
        merchant_api_key: config.payments.safepay.apiKey,
        data: {
          id: 'sub_forged',
          userId: user.id,
          planId: 'business',
          cycle: 'yearly',
          status: 'ACTIVE',
          amount: 0,
        },
      })
      .expect(400);

    const after = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(after.body.data.subscription.planId).toBe('starter');
    expect((await User.findById(user.id)).subscription.planId).toBe('starter');
  });
});

describe('WebhookEvent idempotency store', () => {
  it('accepts a first event', async () => {
    const created = await WebhookEvent.create({ provider: 'test', eventId: 'evt_100' });

    expect(created.status).toBe('received');
    expect(created.receivedAt).toBeInstanceOf(Date);
  });

  it('rejects the same provider and event id twice', async () => {
    await WebhookEvent.create({ provider: 'test', eventId: 'evt_dupe' });

    // The duplicate-key error is the signal a handler uses to skip the event.
    await expect(WebhookEvent.create({ provider: 'test', eventId: 'evt_dupe' })).rejects.toMatchObject({
      code: 11000,
    });

    expect(await WebhookEvent.countDocuments({ eventId: 'evt_dupe' })).toBe(1);
  });

  it('allows the same event id from a different provider', async () => {
    await WebhookEvent.create({ provider: 'provider-a', eventId: 'evt_shared' });
    await WebhookEvent.create({ provider: 'provider-b', eventId: 'evt_shared' });

    expect(await WebhookEvent.countDocuments({ eventId: 'evt_shared' })).toBe(2);
  });

  it('holds ordering and status information for a future handler', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z');
    const event = await WebhookEvent.create({
      provider: 'test',
      eventId: 'evt_ordered',
      type: 'customer.subscription.updated',
      occurredAt,
      status: 'processed',
      processedAt: new Date(),
    });

    expect(event.occurredAt).toEqual(occurredAt);
    expect(event.type).toBe('customer.subscription.updated');
    expect(event.status).toBe('processed');
  });

  it('rejects an unknown status', async () => {
    await expect(
      WebhookEvent.create({ provider: 'test', eventId: 'evt_bad_status', status: 'nonsense' }),
    ).rejects.toThrow();
  });

  it('normalises the provider name so casing cannot split the index', async () => {
    await WebhookEvent.create({ provider: 'Stripe', eventId: 'evt_case' });

    await expect(
      WebhookEvent.create({ provider: 'stripe', eventId: 'evt_case' }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Subscription model preparation', () => {
  it('starts a new account active on the free plan', async () => {
    const { user } = await registerUser();

    expect(SUBSCRIPTION_STATUS.PAST_DUE).toBe('past_due');
    expect((await User.findById(user.id)).subscription.status).toBe('active');
  });

  it('persists past_due when written directly', async () => {
    const { accessToken, user } = await registerUser();

    await User.findByIdAndUpdate(user.id, {
      'subscription.status': SUBSCRIPTION_STATUS.PAST_DUE,
    });

    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(response.body.data.subscription.status).toBe('past_due');
  });

  it('defaults cancelAtPeriodEnd to false and persists a change', async () => {
    const { accessToken, user } = await registerUser();

    const before = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(before.body.data.subscription.cancelAtPeriodEnd).toBe(false);

    await User.findByIdAndUpdate(user.id, { 'subscription.cancelAtPeriodEnd': true });

    const after = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(after.body.data.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('keeps provider ids private even alongside the new fields', async () => {
    const { accessToken, user } = await registerUser();

    await User.findByIdAndUpdate(user.id, {
      'subscription.cancelAtPeriodEnd': true,
      'subscription.status': SUBSCRIPTION_STATUS.PAST_DUE,
      'subscription.providerCustomerId': 'cus_must_stay_private',
      'subscription.providerSubscriptionId': 'sub_must_stay_private',
    });

    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('cus_must_stay_private');
    expect(body).not.toContain('sub_must_stay_private');
    expect(response.body.data.subscription).not.toHaveProperty('providerCustomerId');
    expect(response.body.data.subscription).not.toHaveProperty('providerSubscriptionId');
  });

  it('serializes only the allow-listed fields', () => {
    const serialized = serializeSubscription({
      planId: 'pro',
      status: 'past_due',
      cycle: 'yearly',
      cancelAtPeriodEnd: true,
      providerCustomerId: 'cus_leak',
      providerSubscriptionId: 'sub_leak',
      secretInternalField: 'nope',
    });

    expect(serialized).toMatchObject({ planId: 'pro', status: 'past_due', cancelAtPeriodEnd: true });
    expect(serialized).not.toHaveProperty('providerCustomerId');
    expect(serialized).not.toHaveProperty('providerSubscriptionId');
    expect(serialized).not.toHaveProperty('secretInternalField');
  });

  it('never serialises the fields that tie an account to Safepay', () => {
    const serialized = serializeSubscription({
      planId: 'pro',
      status: 'active',
      pendingReference: 'ref_leak',
      pendingProviderPlanId: 'plan_leak',
      providerUpdatedAt: new Date(),
    });

    expect(serialized).not.toHaveProperty('pendingReference');
    expect(serialized).not.toHaveProperty('pendingProviderPlanId');
    expect(serialized).not.toHaveProperty('providerUpdatedAt');
  });

  it('cancels a plan the user holds without a provider subscription', async () => {
    const { accessToken, user } = await registerUser();
    const billingService = (await import('../src/services/billing.service.js')).default;

    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    const response = await asUser(accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    // An immediate downgrade, and no provider call to make — there is no
    // Safepay subscription behind a plan granted this way.
    expect(response.body.data.subscription).toMatchObject({
      planId: 'starter',
      status: 'cancelled',
      cancelAtPeriodEnd: false,
    });
  });
});

describe('Safepay configuration', () => {
  it('reports Safepay as the provider once every credential is present', () => {
    expect(config.payments.provider).toBe('safepay');
    expect(config.payments.configured).toBe(true);
  });

  it('maps every paid plan and cycle to a Safepay plan token', () => {
    const { planIds } = config.payments.safepay;

    for (const planId of ['pro', 'business']) {
      for (const cycle of ['monthly', 'yearly']) {
        expect(planIds[planId][cycle]).toMatch(/^plan_/);
      }
    }
  });

  it('defines no plan token for the free plan — it is never bought', () => {
    expect(config.payments.safepay.planIds.starter).toBeUndefined();
  });

  it('sends Safepay back to routes the frontend actually serves', () => {
    const { redirectUrl, cancelUrl } = config.payments.safepay;

    expect(redirectUrl).toBe(`${config.client.url}/dashboard/upgrade/success`);
    expect(cancelUrl).toBe(`${config.client.url}/dashboard/upgrade?checkout=cancelled`);
  });

  it('never sends plan tokens or secrets to a client', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);
    const body = JSON.stringify(response.body);

    expect(body).not.toMatch(/priceId|price_id|planToken|plan_|secret|webhook/i);
    expect(response.body.data.paymentConfigured).toBe(true);
  });
});

describe('Only a signed event grants a plan', () => {
  it('has no route a browser can call to activate one', async () => {
    const { accessToken } = await registerUser();

    for (const path of ['/billing/subscription/confirm', '/billing/subscription/activate']) {
      const response = await asUser(accessToken)
        .post(`${API}${path}`)
        .send({ planId: 'business', cycle: 'yearly' });

      expect(response.status).toBe(404);
    }
  });

  it('records an intent and grants nothing, from the legacy request route', async () => {
    const { accessToken, user } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'yearly' })
      .expect(202);

    expect(response.body.data.subscription).toMatchObject({
      planId: 'starter',
      pendingPlanId: 'business',
    });
    expect((await User.findById(user.id)).subscription.planId).toBe('starter');
  });

  it('keeps entitlement enforcement intact', async () => {
    const { accessToken } = await registerUser();

    // Starter is single-seat; the limit still bites.
    await asUser(accessToken)
      .post(`${API}/team`)
      .send({ email: 'someone@example.com' })
      .expect(403);
  });
});
