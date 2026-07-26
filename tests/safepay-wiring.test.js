import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import config from '../src/config/env.js';
import safepayService from '../src/services/safepay.service.js';
import { BILLING_CYCLES, PLAN_ID, SAFEPAY_SIGNATURE_HEADER } from '../src/constants/index.js';
import { signSafepay, subscriptionData } from './helpers.js';

/**
 * Provider wiring, as opposed to provider behaviour.
 *
 * safepay-billing.test.js exercises the flow with the two outbound calls
 * stubbed, which is right for testing what the server does with an event but
 * leaves the URL assembly itself unexercised. These tests let the real
 * `createSubscriptionCheckout` run against a faked `fetch`, so the thing under
 * test is the checkout URL Safepay would actually receive.
 *
 * No plan token, key or secret is written as a literal anywhere here. Every
 * expectation is derived from `config`, so the suite passes against sandbox
 * credentials, against production ones, and against the throwaway values
 * tests/setup.js generates — and a real token never lands in the repository.
 */

/** Every (plan, cycle) pair the catalogue sells. */
const PAID_COMBINATIONS = [PLAN_ID.PRO, PLAN_ID.BUSINESS].flatMap((planId) =>
  BILLING_CYCLES.map((cycle) => ({ planId, cycle })),
);

describe('Plan token configuration', () => {
  it('loads a distinct token for all four paid plan and cycle pairs', () => {
    const tokens = PAID_COMBINATIONS.map(({ planId, cycle }) =>
      safepayService.planTokenFor(planId, cycle),
    );

    expect(tokens).toHaveLength(4);
    for (const token of tokens) expect(typeof token).toBe('string');
    // A copy-paste slip in the env file is the likeliest way this breaks, and
    // it would silently bill one plan's price for another.
    expect(new Set(tokens).size).toBe(4);
  });

  it('maps each pair to the token configured for that exact pair', () => {
    const { planIds } = config.payments.safepay;

    for (const { planId, cycle } of PAID_COMBINATIONS) {
      expect(safepayService.planTokenFor(planId, cycle)).toBe(planIds[planId][cycle]);
    }
  });

  it('resolves a token back to the plan and cycle it was configured for', () => {
    // The webhook path depends on this: the plan granted is derived by
    // reversing the signed `plan_id`, never read from the payload.
    for (const { planId, cycle } of PAID_COMBINATIONS) {
      const token = safepayService.planTokenFor(planId, cycle);
      expect(safepayService.planForToken(token)).toEqual({ planId, cycle });
    }
  });

  it('resolves nothing for a token this deployment does not sell', () => {
    expect(safepayService.planForToken('plan_not-configured-here')).toBeNull();
    expect(safepayService.planForToken('')).toBeNull();
    expect(safepayService.planForToken(undefined)).toBeNull();
  });

  it('sells no token for the free plan', () => {
    for (const cycle of BILLING_CYCLES) {
      expect(safepayService.planTokenFor(PLAN_ID.STARTER, cycle)).toBeNull();
    }
  });
});

describe('Checkout URL assembly', () => {
  const PASSPORT_TOKEN = 'tbt_test-passport-token';

  let fetchCalls;
  let originalFetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = global.fetch;

    // Only the passport call is faked. Everything downstream — the host, the
    // path, the query string — is the real implementation.
    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ data: PASSPORT_TOKEN }),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Runs a real checkout and returns the parsed URL. */
  const openCheckout = async ({ planId = PLAN_ID.PRO, cycle = 'monthly' } = {}) => {
    const url = await safepayService.createSubscriptionCheckout({
      planToken: safepayService.planTokenFor(planId, cycle),
      reference: 'ref-under-test',
    });

    return new URL(url);
  };

  it('mints a passport token with the merchant secret, not the API key', async () => {
    await openCheckout();

    expect(fetchCalls).toHaveLength(1);
    const [{ url, options }] = fetchCalls;

    expect(url).toBe('https://sandbox.api.getsafepay.com/client/passport/v1/token');
    expect(options.method).toBe('POST');
    expect(options.headers['X-SFPY-MERCHANT-SECRET']).toBe(config.payments.safepay.v1Secret);
    // The API key identifies the merchant on events; it is not an authenticator.
    expect(JSON.stringify(options.headers)).not.toContain(config.payments.safepay.apiKey);
  });

  it('builds a subscription checkout on the sandbox host', async () => {
    const url = await openCheckout();

    expect(url.origin).toBe('https://sandbox.api.getsafepay.com');
    expect(url.pathname).toBe('/checkout/subscribe');
    expect(url.searchParams.get('env')).toBe('sandbox');
  });

  it('carries the plan token, the passport token and the server reference', async () => {
    const url = await openCheckout({ planId: PLAN_ID.BUSINESS, cycle: 'yearly' });

    expect(url.searchParams.get('plan_id')).toBe(
      safepayService.planTokenFor(PLAN_ID.BUSINESS, 'yearly'),
    );
    expect(url.searchParams.get('auth_token')).toBe(PASSPORT_TOKEN);
    expect(url.searchParams.get('reference')).toBe('ref-under-test');
  });

  it('sends the shopper back to routes derived from CLIENT_URL', async () => {
    const url = await openCheckout();

    expect(url.searchParams.get('redirect_url')).toBe(`${config.client.url}/dashboard/upgrade/success`);
    expect(url.searchParams.get('cancel_url')).toBe(
      `${config.client.url}/dashboard/upgrade?checkout=cancelled`,
    );
  });

  it('names no amount, currency, email or user anywhere in the URL', async () => {
    const url = await openCheckout();

    // The money lives on the Safepay plan. If the URL could carry an amount,
    // something on this side would be deciding the price.
    for (const forbidden of ['amount', 'currency', 'price', 'email', 'user_id', 'customer']) {
      expect(url.searchParams.has(forbidden)).toBe(false);
    }

    expect(url.search).not.toContain(config.payments.safepay.v1Secret);
    expect(url.search).not.toContain(config.payments.safepay.webhookSecret ?? 'unset-secret');
  });

  it('produces a different URL for each of the four pairs', async () => {
    const urls = [];
    for (const combination of PAID_COMBINATIONS) {
      urls.push((await openCheckout(combination)).searchParams.get('plan_id'));
    }

    expect(new Set(urls).size).toBe(4);
  });

  it('raises a 502 rather than a broken URL when Safepay refuses', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));

    await expect(openCheckout()).rejects.toMatchObject({
      statusCode: 502,
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  });

  it('raises a 502 rather than a broken URL when Safepay returns no token', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: null }) }));

    await expect(openCheckout()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe('Signature comparison', () => {
  const headersWith = (signature) => ({ [SAFEPAY_SIGNATURE_HEADER]: signature });
  const event = () => ({
    token: 'evt_length-probe',
    type: 'subscription.created',
    merchant_api_key: config.payments.safepay.apiKey,
    data: subscriptionData({ email: 'nobody@example.test', status: 'INCOMPLETE' }),
  });

  it('rejects a signature of the wrong length without throwing', () => {
    /*
     * `timingSafeEqual` throws on a length mismatch, and a thrown error here
     * would surface as a 500 — which both leaks that the length was wrong and
     * makes Safepay retry a forgery forever.
     */
    const body = JSON.stringify(event());

    for (const signature of ['', 'a', 'a'.repeat(127), 'a'.repeat(129)]) {
      const result = safepayService.verifyWebhook(body, headersWith(signature));
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a correct digest presented in the wrong case', () => {
    const payload = event();
    const body = JSON.stringify(payload);
    const upper = signSafepay(payload.data).toUpperCase();

    // Same length, same bytes-but-for-case: a lenient compare would accept it.
    expect(safepayService.verifyWebhook(body, headersWith(upper)).ok).toBe(false);
  });

  it('accepts the digest Safepay would actually send', () => {
    const payload = event();
    const result = safepayService.verifyWebhook(
      JSON.stringify(payload),
      headersWith(signSafepay(payload.data)),
    );

    expect(result.ok).toBe(true);
    expect(result.event.token).toBe('evt_length-probe');
  });
});
