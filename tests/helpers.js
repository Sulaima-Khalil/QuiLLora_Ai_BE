import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import config from '../src/config/env.js';
import billingService from '../src/services/billing.service.js';
import safepayService from '../src/services/safepay.service.js';
import { PAYMENT_WEBHOOK_PATH, SAFEPAY_SIGNATURE_HEADER } from '../src/constants/index.js';

export const API = '/api/v1';

/**
 * Fixture credentials, generated per run.
 *
 * Deliberately not literals: a hardcoded password in a committed test is
 * indistinguishable from a real leaked one to a secret scanner, and the
 * resulting false positives train people to ignore the scanner. Generating
 * them also guarantees no test accidentally depends on a specific string.
 */
const suffix = randomBytes(6).toString('hex');

export const PASSWORDS = Object.freeze({
  /** What `buildUser` registers with. */
  initial: `Fx-init-${suffix}`,
  /** A valid replacement, for change-password and reset flows. */
  replacement: `Fx-next-${suffix}`,
  /** A second replacement, where a test resets twice. */
  alternate: `Fx-alt-${suffix}`,
  /** Never registered anywhere — used to assert rejection. */
  wrong: `Fx-wrong-${suffix}`,
  /** Deliberately mismatched against `initial` for confirm-password checks. */
  mismatched: `Fx-mismatch-${suffix}`,
  /** Below the 8-character minimum, to trigger validation. */
  tooShort: 'Fx-1',
});

/** Six-digit reset codes, planted directly on the user document by tests. */
export const CODES = Object.freeze({
  valid: String(randomInt(100_000, 1_000_000)),
  other: String(randomInt(100_000, 1_000_000)),
  wrong: '000000',
});

/** Default registration payload; override any field per test. */
export const buildUser = (overrides = {}) => ({
  name: 'Test Writer',
  email: `writer_${randomBytes(5).toString('hex')}@inkflow.ai`,
  password: PASSWORDS.initial,
  ...overrides,
});

/**
 * Registers a user and returns everything a test needs to act as them.
 *
 * The cookie jar is returned alongside the bearer token so both auth
 * transports can be exercised.
 */
export const registerUser = async (overrides = {}) => {
  const payload = buildUser(overrides);

  const response = await request(app).post(`${API}/auth/register`).send(payload).expect(201);

  return {
    payload,
    user: response.body.data.user,
    accessToken: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
    cookies: response.headers['set-cookie'],
  };
};

/**
 * Puts a fixture user on a paid plan.
 *
 * Plan limits are enforced server-side, and Starter allows one seat and three
 * articles. Tests that exercise team invites or bulk article creation need an
 * account whose plan permits it — the same way a real user would.
 */
export const grantPlan = (userId, planId = 'business', cycle = 'monthly') =>
  billingService.confirmUpgrade(userId, { planId, cycle });

/** Supertest agent with the Authorization header pre-applied. */
export const asUser = (token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

/* ---------------------------------------------------------------------------
 * Safepay fixtures
 * ------------------------------------------------------------------------ */

/** Safepay's `{ seconds, nanos }` timestamp shape. */
export const sfpyTime = (date = new Date()) => ({
  seconds: Math.floor(date.getTime() / 1000),
  nanos: 0,
});

/** The plan tokens tests/setup.js configured, by plan and cycle. */
export const planToken = (planId, cycle) => config.payments.safepay.planIds[planId][cycle];

/**
 * A Safepay event envelope, shaped exactly like the documented payloads:
 * `token` is the event id, `data` is what the signature covers.
 */
export const safepayEvent = ({ type, data, token = `evt_${randomUUID()}`, createdAt }) => ({
  token,
  version: '2.0.0',
  merchant_api_key: config.payments.safepay.apiKey,
  type,
  endpoint: 'https://example.test/api/v1/billing/webhook',
  data,
  created_at: sfpyTime(createdAt),
});

/** A subscription `data` object, with the fields the handler actually reads. */
export const subscriptionData = ({
  id = `sub_${randomUUID()}`,
  planId = 'pro',
  cycle = 'monthly',
  email,
  status = 'ACTIVE',
  periodEnd,
  updatedAt = new Date(),
  createdAt = new Date(),
} = {}) => ({
  id,
  plan_id: planToken(planId, cycle),
  customer_email: email,
  status,
  amount: 100000,
  currency: 'PKR',
  balance: '0',
  ...(periodEnd ? { current_period_end_date: sfpyTime(periodEnd) } : {}),
  updated_at: sfpyTime(updatedAt),
  created_at: sfpyTime(createdAt),
});

/** HMAC-SHA512 of an event's `data`, hex — what Safepay puts in the header. */
export const signSafepay = (data) =>
  createHmac('sha512', config.payments.safepay.webhookSecret)
    .update(Buffer.from(JSON.stringify(data)))
    .digest('hex');

/**
 * Posts an event to the webhook.
 *
 * The body is serialised here rather than handed to supertest as an object,
 * so the bytes on the wire are exactly the bytes that were signed — the same
 * property the raw-body parser exists to preserve.
 *
 * @param {object} event
 * @param {{ signature?: string|null, body?: string }} [options] Override the
 *   signature, or the body itself, to exercise a rejection.
 */
export const postWebhook = (event, { signature, body } = {}) => {
  const payload = body ?? JSON.stringify(event);
  const header = signature === undefined ? signSafepay(event.data) : signature;

  const req = request(app).post(PAYMENT_WEBHOOK_PATH).set('Content-Type', 'application/json');
  if (header !== null) req.set(SAFEPAY_SIGNATURE_HEADER, header);

  return req.send(payload);
};

/**
 * Replaces the two Safepay calls that would leave the machine.
 *
 * Returns a restore function and a record of what was asked for, so a test
 * can assert that a checkout was opened against the right plan token without
 * anything being sent anywhere.
 */
export const stubSafepayNetwork = () => {
  const original = {
    createSubscriptionCheckout: safepayService.createSubscriptionCheckout,
    cancelSubscription: safepayService.cancelSubscription,
  };

  const calls = { checkouts: [], cancellations: [] };

  safepayService.createSubscriptionCheckout = async (args) => {
    calls.checkouts.push(args);
    return `https://sandbox.api.getsafepay.com/checkout/subscribe?plan_id=${args.planToken}&reference=${args.reference}`;
  };

  safepayService.cancelSubscription = async (id) => {
    calls.cancellations.push(id);
    return { token: id, status: 'CANCELED' };
  };

  return {
    calls,
    restore: () => Object.assign(safepayService, original),
  };
};

/** Creates an article owned by `token`'s user. */
export const createArticle = async (token, overrides = {}) => {
  const response = await asUser(token)
    .post(`${API}/articles`)
    .send({
      title: 'A Test Article About Systems',
      content: '<p>The opening paragraph carries the promise of the piece.</p><p>Supporting detail follows.</p>',
      category: 'Engineering',
      tags: ['Testing'],
      ...overrides,
    })
    .expect(201);

  return response.body.data.article;
};

export { app, request };
