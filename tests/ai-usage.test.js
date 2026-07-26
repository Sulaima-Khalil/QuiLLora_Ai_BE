import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { API, app, asUser, registerUser, request } from './helpers.js';
import { AiUsage } from '../src/models/index.js';
import { utcDay } from '../src/repositories/aiUsage.repository.js';
import aiService from '../src/services/ai.service.js';
import billingService from '../src/services/billing.service.js';

/**
 * Daily AI generation metering.
 *
 * Two properties matter. A generation is counted once, and only when it
 * actually produced output. And the allowance is a ceiling the database
 * enforces, so no amount of concurrency, forged payloads or client state can
 * push a Starter user past five in a day.
 */

const STARTER_DAILY_LIMIT = 5;

const generate = (token, topic = 'neural prose') =>
  asUser(token)
    .post(`${API}/ai/generate`)
    .send({ topic, tone: 'Academic', length: 'Medium', category: 'AI' });

const paragraph = (token, topic = 'testing') =>
  asUser(token).post(`${API}/ai/paragraph`).send({ topic });

const usageOf = async (userId, day = utcDay()) => {
  const row = await AiUsage.findOne({ user: userId, day }).lean();
  return row?.count ?? 0;
};

const entitlements = async (token) => {
  const response = await asUser(token).get(`${API}/billing/entitlements`).expect(200);
  return response.body.data.entitlements;
};

/** Burns `count` of today's allowance. */
const burn = async (token, count) => {
  for (let i = 0; i < count; i += 1) await generate(token, `topic ${i}`).expect(200);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AI metering — counting', () => {
  it('starts a new account at zero', async () => {
    const { accessToken, user } = await registerUser();

    expect(await usageOf(user.id)).toBe(0);
    expect((await entitlements(accessToken)).capabilities.aiGenerationsPerDay.usage).toBe(0);
  });

  it('counts a successful generation exactly once', async () => {
    const { accessToken, user } = await registerUser();

    await generate(accessToken).expect(200);

    expect(await usageOf(user.id)).toBe(1);
  });

  it('counts the paragraph endpoint too — it produces new prose', async () => {
    const { accessToken, user } = await registerUser();

    await paragraph(accessToken).expect(200);

    expect(await usageOf(user.id)).toBe(1);
  });

  it('does not count insights — it measures the author’s own text', async () => {
    const { accessToken, user } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/ai/insights`)
      .send({ content: '<p>Some drafted words here.</p>', topic: 'testing' })
      .expect(200);

    expect(await usageOf(user.id)).toBe(0);
  });

  it('does not count the options lookup', async () => {
    const { accessToken, user } = await registerUser();

    await asUser(accessToken).get(`${API}/ai/options`).expect(200);

    expect(await usageOf(user.id)).toBe(0);
  });

  it('records usage per user, not globally', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    await generate(alice.accessToken).expect(200);
    await generate(alice.accessToken).expect(200);

    expect(await usageOf(alice.user.id)).toBe(2);
    expect(await usageOf(bob.user.id)).toBe(0);
  });
});

describe('AI metering — failures do not consume', () => {
  it('does not count a validation failure', async () => {
    const { accessToken, user } = await registerUser();

    await asUser(accessToken).post(`${API}/ai/generate`).send({ topic: 'ai' }).expect(422);

    expect(await usageOf(user.id)).toBe(0);
  });

  it('does not count an unauthenticated request', async () => {
    const { user } = await registerUser();

    await request(app).post(`${API}/ai/generate`).send({ topic: 'testing' }).expect(401);

    expect(await usageOf(user.id)).toBe(0);
  });

  /*
   * Composition failure is exercised against the service rather than the
   * route: the validator rejects a malformed payload before the controller
   * runs, which is the correct behaviour and is covered above. Calling
   * `generateArticleFor` directly with no topic reaches the composer and makes
   * it throw, which is the case the refund exists for.
   */
  it('refunds the slot when composition throws', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, 2);

    await expect(aiService.generateArticleFor(user.id, {})).rejects.toThrow();

    // Claimed, then handed straight back.
    expect(await usageOf(user.id)).toBe(2);
    expect((await entitlements(accessToken)).capabilities.aiGenerationsPerDay.usage).toBe(2);
  });

  it('leaves a refunded slot usable', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT - 1);

    await expect(aiService.generateArticleFor(user.id, {})).rejects.toThrow();
    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT - 1);

    // The refunded slot is the one that lets this through.
    await generate(accessToken).expect(200);
    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT);
    await generate(accessToken, 'now full').expect(403);
  });

  it('refunds the paragraph endpoint the same way', async () => {
    const { user } = await registerUser();

    await expect(aiService.generateParagraphFor(user.id, null)).rejects.toThrow();

    expect(await usageOf(user.id)).toBe(0);
  });

  it('never drives the counter below zero on a double refund', async () => {
    const { user } = await registerUser();

    await billingService.releaseAiGeneration(user.id);
    await billingService.releaseAiGeneration(user.id);

    expect(await usageOf(user.id)).toBe(0);
  });
});

describe('AI metering — the daily ceiling', () => {
  it('allows exactly the plan allowance', async () => {
    const { accessToken, user } = await registerUser();

    for (let i = 1; i <= STARTER_DAILY_LIMIT; i += 1) {
      await generate(accessToken, `topic ${i}`).expect(200);
      expect(await usageOf(user.id)).toBe(i);
    }
  });

  it('rejects the one past the allowance', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    const response = await generate(accessToken, 'one too many').expect(403);

    expect(response.body).toMatchObject({ success: false, code: 'PLAN_LIMIT_REACHED' });
    expect(response.body.message).toMatch(/5 AI generations per day/i);
    expect(response.body.message).toMatch(/midnight UTC/i);
    expect(response.body.errors?.[0]).toMatchObject({ field: 'aiGenerationsPerDay' });
  });

  it('does not reach the generator when refusing', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    const compose = jest.spyOn(aiService, 'generateArticle');
    await generate(accessToken, 'blocked').expect(403);

    expect(compose).not.toHaveBeenCalled();
  });

  it('does not increment when refusing', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await generate(accessToken, 'blocked').expect(403);
    await generate(accessToken, 'blocked again').expect(403);

    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT);
  });

  it('blocks the paragraph endpoint on the same allowance', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await paragraph(accessToken).expect(403);
  });

  it('returns no partial output with the refusal', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    const response = await generate(accessToken, 'blocked').expect(403);

    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('<p>');
  });
});

describe('AI metering — concurrency', () => {
  it('cannot be overshot by simultaneous requests', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT - 1);

    // Two requests race for the single remaining slot.
    const results = await Promise.all([
      generate(accessToken, 'race a'),
      generate(accessToken, 'race b'),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 403]);
    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT);
  });

  it('holds the ceiling under a burst from an empty allowance', async () => {
    const { accessToken, user } = await registerUser();

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => generate(accessToken, `burst ${i}`)),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 403).length;

    expect(succeeded).toBe(STARTER_DAILY_LIMIT);
    expect(refused).toBe(12 - STARTER_DAILY_LIMIT);
    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT);
  });
});

describe('AI metering — the day boundary', () => {
  it('keeps a separate counter per UTC day', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await generate(accessToken, 'blocked today').expect(403);

    // Age today's row by relabelling it as yesterday, which is what the clock
    // rolling over amounts to for this model.
    const yesterday = utcDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await AiUsage.updateOne({ user: user.id, day: utcDay() }, { $set: { day: yesterday } });

    await generate(accessToken, 'fresh day').expect(200);

    expect(await usageOf(user.id, yesterday)).toBe(STARTER_DAILY_LIMIT);
    expect(await usageOf(user.id)).toBe(1);
  });

  it('labels the day in UTC', async () => {
    const { accessToken, user } = await registerUser();
    await generate(accessToken).expect(200);

    const row = await AiUsage.findOne({ user: user.id }).lean();
    expect(row.day).toBe(new Date().toISOString().slice(0, 10));
    expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('AI metering — paid plans', () => {
  it('does not block Pro', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    await burn(accessToken, STARTER_DAILY_LIMIT + 3);

    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT + 3);
  });

  it('does not block Business', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'yearly' });

    await burn(accessToken, STARTER_DAILY_LIMIT + 2);
    await generate(accessToken, 'still fine').expect(200);
  });

  it('still records usage on an unlimited plan', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    await burn(accessToken, 2);

    expect(await usageOf(user.id)).toBe(2);
  });

  it('applies the new ceiling only once the server confirms the plan', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);
    await generate(accessToken, 'blocked').expect(403);

    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });
    await generate(accessToken, 'now allowed').expect(200);
  });
});

describe('AI metering — cannot be bypassed by the client', () => {
  it('ignores a plan or usage smuggled into the payload', async () => {
    const { accessToken, user } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await asUser(accessToken)
      .post(`${API}/ai/generate`)
      .send({
        topic: 'forged request',
        planId: 'business',
        usage: 0,
        aiGenerationsPerDay: 999,
        limits: { aiGenerationsPerDay: null },
      })
      .expect(403);

    expect(await usageOf(user.id)).toBe(STARTER_DAILY_LIMIT);
  });

  it('ignores plan claims sent as headers', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await asUser(accessToken)
      .post(`${API}/ai/generate`)
      .set('X-Plan', 'business')
      .set('X-AI-Usage', '0')
      .send({ topic: 'header forgery' })
      .expect(403);
  });

  it('is not relieved by a pending upgrade request', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'yearly' })
      .expect(202);

    await generate(accessToken, 'still blocked').expect(403);
  });
});

describe('GET /billing/entitlements — AI capability', () => {
  it('reports real usage, remaining and enforcement', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, 2);

    expect((await entitlements(accessToken)).capabilities.aiGenerationsPerDay).toEqual({
      limit: 5,
      usage: 2,
      remaining: 3,
      enforced: true,
      reached: false,
    });
  });

  it('flags the capability as reached once the day is spent', async () => {
    const { accessToken } = await registerUser();
    await burn(accessToken, STARTER_DAILY_LIMIT);

    expect((await entitlements(accessToken)).capabilities.aiGenerationsPerDay).toMatchObject({
      usage: 5,
      remaining: 0,
      reached: true,
    });
  });

  it('reports unlimited as a null limit, with usage still counted', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'monthly' });
    await burn(accessToken, 7);

    expect((await entitlements(accessToken)).capabilities.aiGenerationsPerDay).toEqual({
      limit: null,
      usage: 7,
      remaining: null,
      enforced: true,
      reached: false,
    });
  });

  it('lists AI among the enforced capabilities', async () => {
    const { accessToken } = await registerUser();

    expect((await entitlements(accessToken)).enforcedCapabilities).toEqual([
      'publishedArticles',
      'teamMembers',
      'aiGenerationsPerDay',
    ]);
  });
});
