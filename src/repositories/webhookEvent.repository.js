import { WebhookEvent } from '../models/index.js';
import { WEBHOOK_EVENT_STATUS } from '../constants/index.js';

/**
 * Data access for recorded provider events.
 *
 * The idempotency guarantee lives in the unique `(provider, eventId)` index,
 * not in application code: a read-then-write check races under the concurrent
 * redelivery that providers are prone to, and the race is exactly the case
 * that matters — two copies of one payment arriving together.
 */

/**
 * Records an event, or reports that it has been seen before.
 *
 * Insert-first, and let the index arbitrate. A duplicate key is the expected
 * answer to a retry, not an error to escalate, so it is translated into a
 * result the caller can branch on along with the row already stored — a
 * previous attempt that ended `failed` is allowed another go, which is what
 * stops a transient database blip from burying a real payment behind a
 * permanent "already seen".
 *
 * @returns {Promise<{ isNew: boolean, event: object }>}
 */
export const record = async ({ provider, eventId, type, occurredAt }) => {
  try {
    const event = await WebhookEvent.create({
      provider,
      eventId,
      type: type ?? null,
      occurredAt: occurredAt ?? null,
      status: WEBHOOK_EVENT_STATUS.RECEIVED,
    });

    return { isNew: true, event };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const event = await WebhookEvent.findOne({ provider, eventId }).exec();
    return { isNew: false, event };
  }
};

/**
 * Closes out an event.
 *
 * `reason` is a short outcome label — `unclaimed`, `unknown_plan`, a caught
 * error's message — never the payload. A webhook body carries customer
 * emails and payment identifiers, and a log line is not the place for them.
 */
export const markSettled = ({ provider, eventId, status, reason = null }) =>
  WebhookEvent.updateOne(
    { provider, eventId },
    { status, processedAt: new Date(), error: reason },
  ).exec();

export const findByEventId = (provider, eventId) =>
  WebhookEvent.findOne({ provider, eventId }).exec();

export default { record, markSettled, findByEventId };
