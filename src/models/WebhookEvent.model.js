import mongoose from 'mongoose';
import { WEBHOOK_EVENT_STATUS, WEBHOOK_EVENT_STATUSES } from '../constants/index.js';

const { Schema, model } = mongoose;

/**
 * One row per provider webhook event, for idempotency.
 *
 * Providers guarantee at-least-once delivery, not exactly-once: the same event
 * arrives again whenever a response is slow, times out, or returns non-2xx.
 * Without a record of what has been seen, a redelivered
 * `checkout.session.completed` would activate a subscription twice.
 *
 * The intended flow is insert-first: attempt to record the event, and let the
 * unique index below reject a duplicate. That makes the database the arbiter
 * rather than a read-then-write check, which races under concurrent delivery —
 * the same approach the AI usage counter uses.
 *
 * Nothing writes to this collection yet. There is no webhook handler.
 */
const webhookEventSchema = new Schema(
  {
    /** Which provider sent it, so two providers cannot collide on event ids. */
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    /** The provider's own event id, e.g. Stripe's `evt_...`. */
    eventId: {
      type: String,
      required: true,
      trim: true,
    },

    /** Event type, for diagnostics and for routing once a handler exists. */
    type: { type: String, trim: true, default: null },

    /** When this server accepted it. */
    receivedAt: { type: Date, default: Date.now },

    /**
     * The provider's own timestamp for the event.
     *
     * Delivery is not ordered, so a handler compares this against what it has
     * already applied and ignores anything older — otherwise a late
     * `subscription.updated` could resurrect a cancelled plan.
     */
    occurredAt: { type: Date, default: null },

    status: {
      type: String,
      enum: WEBHOOK_EVENT_STATUSES,
      default: WEBHOOK_EVENT_STATUS.RECEIVED,
    },

    processedAt: { type: Date, default: null },

    /** Failure reason, for retry triage. Never the raw payload. */
    error: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * The idempotency guarantee.
 *
 * A duplicate insert fails with E11000, and that error is the signal to skip
 * the event and answer 200 — not an incident to escalate.
 */
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

/** Supports "what is still unprocessed" sweeps without a collection scan. */
webhookEventSchema.index({ status: 1, receivedAt: -1 });

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);

export default WebhookEvent;
