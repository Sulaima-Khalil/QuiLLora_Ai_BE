import { describe, expect, it } from '@jest/globals';
import { API, app, asUser, registerUser, request } from './helpers.js';
import { User } from '../src/models/index.js';
import billingService from '../src/services/billing.service.js';

/**
 * Subscription state.
 *
 * The property under test throughout: the server decides what plan someone is
 * on. A client may ask, and may cancel, but may not grant itself anything —
 * not by naming a price, not by naming another user, not by asking twice.
 */

const sub = (body) => body.data.subscription;

describe('GET /billing/plans', () => {
  it('is readable signed-out — the pricing page is public', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);

    expect(response.body.data.plans.map((p) => p.id)).toEqual(['starter', 'pro', 'business']);
  });

  it('is the only source of prices', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);
    const pro = response.body.data.plans.find((p) => p.id === 'pro');

    expect(pro.price).toEqual({ monthly: 19, yearly: 15 });
  });

  it('reports whether payment can be taken, and nothing about how', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);

    expect(response.body.data.paymentConfigured).toBe(true);
    expect(response.body.data).not.toHaveProperty('provider');
  });

  it('leaks no provider secrets', async () => {
    const response = await request(app).get(`${API}/billing/plans`).expect(200);
    const body = JSON.stringify(response.body);

    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/webhook/i);
    expect(body).not.toMatch(/sk_/);
  });
});

describe('GET /billing/subscription', () => {
  it('rejects an unauthenticated caller', async () => {
    await request(app).get(`${API}/billing/subscription`).expect(401);
  });

  it('starts every new account on the free plan', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);

    expect(sub(response.body)).toMatchObject({
      planId: 'starter',
      status: 'active',
      pendingPlanId: null,
    });
  });

  it('never returns provider customer or subscription ids', async () => {
    const { accessToken, user } = await registerUser();

    await User.findByIdAndUpdate(user.id, {
      'subscription.providerCustomerId': 'cus_secret_123',
      'subscription.providerSubscriptionId': 'sub_secret_456',
    });

    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('cus_secret_123');
    expect(body).not.toContain('sub_secret_456');
    expect(sub(response.body)).not.toHaveProperty('providerCustomerId');
  });

  it('shows one user nothing about another', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    await billingService.confirmUpgrade(alice.user.id, { planId: 'business', cycle: 'yearly' });

    const response = await asUser(bob.accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(sub(response.body).planId).toBe('starter');
  });
});

describe('POST /billing/subscription/request', () => {
  it('rejects an unauthenticated caller', async () => {
    await request(app)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(401);
  });

  it('records the request without granting the plan', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(202);

    // Asked for, not given.
    expect(sub(response.body.data ? { data: response.body.data } : response.body)).toMatchObject({
      planId: 'starter',
      pendingPlanId: 'pro',
    });
    expect(response.body.data.paymentConfigured).toBe(true);
  });

  it('survives a refresh — the pending request is server state', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'yearly' })
      .expect(202);

    const after = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);

    expect(sub(after.body)).toMatchObject({
      planId: 'starter',
      pendingPlanId: 'business',
      pendingCycle: 'yearly',
    });
  });

  it('prices the request from the server catalogue', async () => {
    const { accessToken } = await registerUser();

    const monthly = await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(202);
    expect(monthly.body.data.amountDue).toBe(19);

    const yearly = await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'yearly' })
      .expect(202);
    expect(yearly.body.data.amountDue).toBe(39 * 12);
  });

  it('ignores a price supplied by the client', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'monthly', price: 0, amountDue: 0, currency: 'XXX' })
      .expect(202);

    // The catalogue wins; the smuggled figures are simply not read.
    expect(response.body.data.amountDue).toBe(49);
    expect(response.body.data.currency).toBe('USD');
  });

  it('rejects a plan that is not in the catalogue', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'enterprise-unlimited', cycle: 'monthly' })
      .expect(422);
  });

  it('rejects an unknown billing cycle', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'decade' })
      .expect(422);
  });

  it('refuses to "upgrade" to the free plan', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'starter', cycle: 'monthly' })
      .expect(400);
  });

  it('refuses a plan the user already holds', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(409);
  });

  it('leaves the plan untouched when the request fails', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'not-a-plan', cycle: 'monthly' })
      .expect(422);

    const after = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(sub(after.body)).toMatchObject({ planId: 'starter', pendingPlanId: null });
  });
});

describe('POST /billing/subscription/cancel', () => {
  it('rejects an unauthenticated caller', async () => {
    await request(app).post(`${API}/billing/subscription/cancel`).expect(401);
  });

  it('returns a paid user to the free plan', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'monthly' });

    const response = await asUser(accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    expect(sub(response.body)).toMatchObject({
      planId: 'starter',
      status: 'cancelled',
      currentPeriodEnd: null,
    });
  });

  it('clears a pending upgrade request', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'pro', cycle: 'monthly' })
      .expect(202);

    const response = await asUser(accessToken).post(`${API}/billing/subscription/cancel`).expect(200);
    expect(sub(response.body).pendingPlanId).toBeNull();
  });

  it('cancels only the caller’s own subscription', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    await billingService.confirmUpgrade(alice.user.id, { planId: 'pro', cycle: 'monthly' });
    await asUser(bob.accessToken).post(`${API}/billing/subscription/cancel`).expect(200);

    const stillPaid = await asUser(alice.accessToken).get(`${API}/billing/subscription`).expect(200);
    expect(sub(stillPaid.body).planId).toBe('pro');
  });
});

describe('Granting a paid plan', () => {
  it('has no public route — nothing a browser can reach grants a plan', async () => {
    const { accessToken, user } = await registerUser();

    // No activation route exists at all.
    for (const path of [
      '/billing/subscription',
      '/billing/subscription/confirm',
      '/billing/subscription/activate',
    ]) {
      const response = await asUser(accessToken)
        .post(`${API}${path}`)
        .send({ planId: 'business', cycle: 'yearly', status: 'active' });

      expect(response.status).toBe(404);
    }

    /*
     * The webhook is live now, so the assertion is on the outcome rather than
     * the absence of a route. An unsigned POST — even a signed-in one, even
     * one that names a plan and a status outright — is refused before its
     * contents are read, and grants nothing.
     */
    const webhook = await asUser(accessToken)
      .post(`${API}/billing/webhook`)
      .send({ planId: 'business', cycle: 'yearly', status: 'active' });

    expect(webhook.status).toBe(400);
    expect(webhook.body.code).toBe('INVALID_WEBHOOK');
    expect((await User.findById(user.id)).subscription.planId).toBe('starter');
  });

  it('is reflected everywhere once the server confirms it', async () => {
    const { accessToken, user } = await registerUser();

    await billingService.confirmUpgrade(user.id, {
      planId: 'business',
      cycle: 'yearly',
      provider: 'test-provider',
      providerSubscriptionId: 'sub_confirmed',
    });

    // A second "device": a fresh request carrying only the session.
    const response = await asUser(accessToken).get(`${API}/billing/subscription`).expect(200);

    expect(sub(response.body)).toMatchObject({
      planId: 'business',
      cycle: 'yearly',
      status: 'active',
      provider: 'test-provider',
    });
    expect(new Date(sub(response.body).currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(response.body)).not.toContain('sub_confirmed');
  });
});
