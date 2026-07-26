import { z } from 'zod';
import { BILLING_CYCLE, BILLING_CYCLES, PLAN_IDS } from '../constants/index.js';

/**
 * Billing schemas.
 *
 * Note what a client is allowed to send: a plan id from a fixed set and a
 * billing cycle. No price, no amount, no currency, no trial length. Those come
 * from the server catalogue, so a tampered request can ask for Business but
 * cannot ask for Business at $0.
 *
 * Zod strips unknown keys by default, so a smuggled `price` never reaches the
 * service in the first place.
 */
export const requestUpgradeSchema = {
  body: z.object({
    planId: z.enum(PLAN_IDS),
    cycle: z.enum(BILLING_CYCLES).default(BILLING_CYCLE.MONTHLY),
  }),
};

/**
 * Opening a Safepay checkout. Same two fields, for the same reason.
 *
 * Notably absent, and absent on purpose: `amount`, `price`, `currency`,
 * `planToken`, `providerCustomerId`, `providerSubscriptionId`. Zod strips
 * unknown keys, so any of those in a body is gone before the service runs —
 * and even reaching the service would change nothing, because the amount is
 * written on the Safepay plan and the provider ids come from signed events.
 *
 * `starter` is accepted by the schema and refused by the service, which knows
 * why the answer is 400 and can say so.
 */
export const createCheckoutSchema = {
  body: z.object({
    planId: z.enum(PLAN_IDS),
    cycle: z.enum(BILLING_CYCLES).default(BILLING_CYCLE.MONTHLY),
  }),
};

export default { requestUpgradeSchema, createCheckoutSchema };
