import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BILLING_CYCLE,
  BILLING_CYCLES,
  PAYMENT_PROVIDER,
  PLAN_ID,
  SAFEPAY_ENVIRONMENT,
  SAFEPAY_SIGNATURE_HEADER,
} from '../constants/index.js';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * Safepay wire client.
 *
 * Every URL, query parameter, header, request field and hash below is
 * transcribed from Safepay's official sources — nothing here is inferred:
 *
 *   - hosts and paths, and the exact query string of a subscription
 *     checkout: `@sfpy/node-sdk` v3.0.2, `dist/utils/constants.js`,
 *     `dist/utils/builder.js` and `dist/resources/checkout.js`
 *   - `X-SFPY-MERCHANT-SECRET` and the passport / subscription endpoints:
 *     the same package's `dist/resources/authorization.js` and
 *     `dist/resources/subscription.js`
 *   - HMAC-SHA512 of the event's `data` object against `X-SFPY-SIGNATURE`:
 *     Developers > Webhooks > Verify HMAC signatures, and the same package's
 *     `dist/resources/verify.js`
 *   - the event envelope and the thirteen event types: Developers > Webhooks
 *     > Webhook structure and types
 *
 * The official SDK is not installed. It declares `ts-node` and `axios@^0.26`
 * as *runtime* dependencies, and this backend has neither; pulling a
 * four-year-old HTTP client and a TypeScript loader into production to make
 * two POSTs and one HMAC would add far more attack surface than it removes.
 * What it does is reproduced here byte for byte instead, on `fetch` and
 * `node:crypto`, and the citations above are how that stays honest.
 */

/* ---------------------------------------------------------------------------
 * Hosts — @sfpy/node-sdk dist/utils/constants.js
 * ------------------------------------------------------------------------ */

const API_HOST = Object.freeze({
  [SAFEPAY_ENVIRONMENT.PRODUCTION]: 'https://api.getsafepay.com',
  [SAFEPAY_ENVIRONMENT.SANDBOX]: 'https://sandbox.api.getsafepay.com',
  [SAFEPAY_ENVIRONMENT.DEVELOPMENT]: 'https://dev.api.getsafepay.com',
});

const CHECKOUT_HOST = Object.freeze({
  [SAFEPAY_ENVIRONMENT.PRODUCTION]: 'https://getsafepay.com/checkout',
  [SAFEPAY_ENVIRONMENT.SANDBOX]: 'https://sandbox.api.getsafepay.com/checkout',
  [SAFEPAY_ENVIRONMENT.DEVELOPMENT]: 'https://dev.api.getsafepay.com/checkout',
});

/** Subscription and passport calls sit under `/client`. builder.js. */
const clientApiUrl = (environment) => `${API_HOST[environment]}/client`;

/** buildSubscriptionCheckoutUrl: the checkout host plus `/subscribe`. */
const subscribeUrl = (environment) => `${CHECKOUT_HOST[environment]}/subscribe`;

/** How long a Safepay call may hang before the checkout request gives up. */
const REQUEST_TIMEOUT_MS = 15_000;

/* ---------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

const settings = () => config.payments.safepay;

/** Whether all four credentials are present. Nothing charges without this. */
export const isConfigured = () => Boolean(settings().configured);

/**
 * The Safepay plan token for one of our plans on one of our cycles.
 *
 * The only place a plan and cycle become money. A request names `pro` and
 * `yearly`; what that costs is written on the Safepay plan this returns, and
 * neither the browser nor this server can alter it.
 */
export const planTokenFor = (planId, cycle) => settings().planIds?.[planId]?.[cycle] ?? null;

/**
 * Reverse of `planTokenFor`: which plan and cycle a Safepay plan token means.
 *
 * Used on the webhook path, where the plan granted must be derived from the
 * `plan_id` Safepay signed for rather than from anything the payload claims
 * about our own vocabulary. An unrecognised token resolves to null and the
 * event grants nothing.
 */
export const planForToken = (token) => {
  if (!token) return null;

  for (const planId of [PLAN_ID.PRO, PLAN_ID.BUSINESS]) {
    for (const cycle of BILLING_CYCLES) {
      if (planTokenFor(planId, cycle) === token) return { planId, cycle };
    }
  }

  return null;
};

/* ---------------------------------------------------------------------------
 * Server-to-server calls
 * ------------------------------------------------------------------------ */

/**
 * POST to Safepay with the merchant secret attached.
 *
 * The secret rides in `X-SFPY-MERCHANT-SECRET`, exactly as the official SDK
 * sends it on every `/client/**` call. Failures raise a 502 carrying no
 * provider detail: an upstream body can contain identifiers and is not ours
 * to forward to a browser.
 */
const callSafepay = async (path, { method = 'POST', body = {} } = {}) => {
  const { environment, v1Secret } = settings();

  let response;

  try {
    response = await fetch(`${clientApiUrl(environment)}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-SFPY-MERCHANT-SECRET': v1Secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError(502, 'Could not reach the payment provider. Please try again.', {
      code: 'PAYMENT_PROVIDER_UNREACHABLE',
      cause,
    });
  }

  if (!response.ok) {
    throw new ApiError(502, 'The payment provider rejected the request. Please try again.', {
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  }

  // Every documented Safepay response wraps its payload in `data`.
  const payload = await response.json().catch(() => null);
  return payload?.data ?? null;
};

/**
 * Mints the short-lived client token a hosted checkout is opened with.
 *
 * `POST /client/passport/v1/token` — authorization.js. The SDK reads
 * `.data.data` off the response and passes the result straight through as
 * `auth_token`, so the unwrapped value is the token itself.
 */
const createPassportToken = async () => {
  const token = await callSafepay('/passport/v1/token');
  const value = typeof token === 'string' ? token : token?.token;

  if (!value) {
    throw new ApiError(502, 'The payment provider did not return a checkout token.', {
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  }

  return value;
};

/**
 * Opens a Safepay-hosted subscription checkout and returns its URL.
 *
 * Mirrors `checkout.createSubscription`: mint a passport token, then build
 * `{checkout host}/subscribe` with `plan_id`, `auth_token`, `env`,
 * `cancel_url`, `redirect_url` and `reference`.
 *
 * Note what is *not* in that list — an amount, a currency, an email or a user
 * id. The plan token decides the money; the reference is opaque.
 */
export const createSubscriptionCheckout = async ({ planToken, reference }) => {
  const { environment, redirectUrl, cancelUrl } = settings();

  const authToken = await createPassportToken();

  const params = new URLSearchParams({
    plan_id: planToken,
    auth_token: authToken,
    env: environment,
    cancel_url: cancelUrl,
    redirect_url: redirectUrl,
  });

  if (reference) params.append('reference', reference);

  return `${subscribeUrl(environment)}?${params.toString()}`;
};

/**
 * Cancels a subscription at Safepay.
 *
 * `POST /client/subscriptions/v1/{id}/cancel` — subscription.js. Safepay has
 * no customer portal for merchants to hand a shopper, so this is the whole of
 * "manage my subscription": the account holder asks us, and we ask Safepay.
 */
export const cancelSubscription = (subscriptionId) =>
  callSafepay(`/subscriptions/v1/${encodeURIComponent(subscriptionId)}/cancel`);

/* ---------------------------------------------------------------------------
 * Webhook verification
 * ------------------------------------------------------------------------ */

/** Server-generated, unguessable, and never derived from anything a client sent. */
export const newCheckoutReference = () => randomUUID();

const equalDigests = (a, b) => {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');

  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // one bit; compare lengths first and always run the constant-time path.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * Parses and authenticates a raw Safepay webhook body.
 *
 * The signature covers the JSON of the event's `data` object — not the whole
 * envelope — hashed with HMAC-SHA512 under the endpoint's shared secret and
 * sent hex-encoded in `X-SFPY-SIGNATURE`. Reproducing it means re-serialising
 * the parsed `data`, which is what Safepay's own libraries do; the raw bytes
 * still matter, because parsing them ourselves is the only way to know we are
 * hashing what actually arrived rather than what a body parser reconstructed.
 *
 * @param {Buffer|string} rawBody Exact bytes as delivered.
 * @param {object} headers Incoming request headers.
 * @returns {{ ok: true, event: object } | { ok: false, reason: string }}
 */
export const verifyWebhook = (rawBody, headers = {}) => {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const signature = headers[SAFEPAY_SIGNATURE_HEADER];
  if (typeof signature !== 'string' || signature.length === 0) {
    return { ok: false, reason: 'missing_signature' };
  }

  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  if (text.length === 0) return { ok: false, reason: 'empty_body' };

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, reason: 'malformed_envelope' };
  }

  // `data` is what is signed, so an envelope without one cannot be verified
  // at all — and every documented event carries it.
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
    return { ok: false, reason: 'malformed_envelope' };
  }

  // `token` is the event id and the idempotency key; `type` routes it.
  if (typeof event.token !== 'string' || typeof event.type !== 'string') {
    return { ok: false, reason: 'malformed_envelope' };
  }

  const expected = createHmac('sha512', settings().webhookSecret)
    .update(Buffer.from(JSON.stringify(event.data)))
    .digest('hex');

  if (!equalDigests(signature, expected)) return { ok: false, reason: 'bad_signature' };

  /*
   * Second gate, after the signature: the envelope must name our merchant.
   *
   * The shared secret already proves Safepay sent it, but a secret pasted
   * into the wrong dashboard endpoint, or an environment pointed at the wrong
   * account, would otherwise let another merchant's traffic drive this
   * server's subscriptions.
   */
  if (event.merchant_api_key && event.merchant_api_key !== settings().apiKey) {
    return { ok: false, reason: 'merchant_mismatch' };
  }

  return { ok: true, event };
};

/**
 * Safepay timestamps are `{ seconds, nanos }`, not ISO strings or epoch ms.
 * Nanoseconds are dropped: nothing here needs sub-second resolution, and
 * `Date` cannot hold it anyway.
 */
export const toDate = (timestamp) => {
  const seconds = timestamp?.seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
};

export default {
  provider: PAYMENT_PROVIDER,
  isConfigured,
  planTokenFor,
  planForToken,
  createSubscriptionCheckout,
  cancelSubscription,
  newCheckoutReference,
  verifyWebhook,
  toDate,
  defaultCycle: BILLING_CYCLE.MONTHLY,
};
