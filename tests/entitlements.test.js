import { describe, expect, it } from '@jest/globals';
import { API, app, asUser, registerUser, request } from './helpers.js';
import { Article, TeamMember, User } from '../src/models/index.js';
import billingService from '../src/services/billing.service.js';

/**
 * Plan limit enforcement.
 *
 * The property under test: the ceiling is the server's, derived from the plan
 * on the user document. Nothing a client sends — a plan id in the payload, a
 * forged local value, a doctored entitlements response — can raise it.
 *
 * The article limit is on *published* articles, matching what the plan
 * promises. Drafts are not rationed.
 */

const STARTER_PUBLISHED_LIMIT = 3;

const createArticle = (token, title, status) =>
  asUser(token)
    .post(`${API}/articles`)
    .send({ title, content: '<p>Body copy.</p>', category: 'Engineering', ...(status ? { status } : {}) });

const publish = (token, id) =>
  asUser(token).patch(`${API}/articles/${id}/status`).send({ status: 'Published' });

/** Creates a draft and returns its id. */
const draft = async (token, title) =>
  (await createArticle(token, title).expect(201)).body.data.article.id;

/** Publishes `count` articles, filling the plan's allowance. */
const fillPublished = async (token, count) => {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const id = await draft(token, `Published ${i + 1}`);
    await publish(token, id).expect(200);
    ids.push(id);
  }
  return ids;
};

const entitlements = async (token) => {
  const response = await asUser(token).get(`${API}/billing/entitlements`).expect(200);
  return response.body.data.entitlements;
};

const statusOf = async (token, id) => {
  const response = await asUser(token).get(`${API}/articles/${id}`).expect(200);
  return response.body.data.article.status;
};

describe('Published-article limit — drafts are not rationed', () => {
  it('lets a free user create far more drafts than the published limit', async () => {
    const { accessToken } = await registerUser();

    for (let i = 0; i < STARTER_PUBLISHED_LIMIT + 5; i += 1) {
      await createArticle(accessToken, `Draft ${i}`).expect(201);
    }

    const listed = await asUser(accessToken).get(`${API}/articles`).expect(200);
    expect(listed.body.meta.total).toBe(STARTER_PUBLISHED_LIMIT + 5);
  });

  it('still allows new drafts once the published allowance is full', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    // The promise is "3 published articles", not "3 articles".
    await createArticle(accessToken, 'A draft while full').expect(201);
  });

  it('counts neither drafts nor archived articles toward the limit', async () => {
    const { accessToken } = await registerUser();

    for (let i = 0; i < 4; i += 1) await createArticle(accessToken, `Draft ${i}`).expect(201);

    const archivedId = await draft(accessToken, 'To archive');
    await asUser(accessToken).patch(`${API}/articles/${archivedId}/archive`).expect(200);

    expect((await entitlements(accessToken)).capabilities.publishedArticles.usage).toBe(0);
  });
});

describe('Published-article limit — enforcement', () => {
  it('allows publishing up to the limit', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    expect((await entitlements(accessToken)).capabilities.publishedArticles).toMatchObject({
      limit: 3,
      usage: 3,
      remaining: 0,
      reached: true,
    });
  });

  it('rejects the fourth publication', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Fourth');

    const response = await publish(accessToken, fourth).expect(403);

    expect(response.body).toMatchObject({ success: false, code: 'PLAN_LIMIT_REACHED' });
    expect(response.body.message).toMatch(/3 published articles/i);
    expect(response.body.message).toMatch(/drafts are unaffected/i);
    expect(response.body.errors?.[0]).toMatchObject({ field: 'publishedArticles' });
  });

  it('leaves the article a draft when publication is refused', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Stays a draft');

    await publish(accessToken, fourth).expect(403);

    expect(await statusOf(accessToken, fourth)).toBe('Draft');
    expect((await entitlements(accessToken)).capabilities.publishedArticles.usage).toBe(3);
  });

  it('lets an already-published article be re-saved without consuming a slot', async () => {
    const { accessToken } = await registerUser();
    const [first] = await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    // Re-publishing something already published is a no-op, not a 4th slot.
    await publish(accessToken, first).expect(200);
    await asUser(accessToken)
      .put(`${API}/articles/${first}`)
      .send({ title: 'Edited while published', status: 'Published' })
      .expect(200);

    expect(await statusOf(accessToken, first)).toBe('Published');
  });

  it('does not block ordinary edits at the limit', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const spare = await draft(accessToken, 'Spare draft');

    await asUser(accessToken)
      .put(`${API}/articles/${spare}`)
      .send({ title: 'Edited freely', content: '<p>More words.</p>' })
      .expect(200);
  });
});

describe('Published-article limit — every publication path is covered', () => {
  it('blocks publishing directly at creation', async () => {
    const { accessToken, user } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    const before = await Article.countDocuments({ author: user.id });
    await createArticle(accessToken, 'Born published', 'Published').expect(403);

    // Refused before anything was written.
    expect(await Article.countDocuments({ author: user.id })).toBe(before);
  });

  it('blocks publishing through a full update', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Via update');

    await asUser(accessToken)
      .put(`${API}/articles/${id}`)
      .send({ title: 'Trying to publish', status: 'Published' })
      .expect(403);

    expect(await statusOf(accessToken, id)).toBe('Draft');
  });

  it('applies no other edits when an update is refused for publishing', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Original title');

    await asUser(accessToken)
      .put(`${API}/articles/${id}`)
      .send({ title: 'Renamed and published', status: 'Published' })
      .expect(403);

    const article = await Article.findById(id);
    expect(article.title).toBe('Original title');
    expect(article.status).toBe('Draft');
  });

  it('blocks publishing through the status endpoint', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Via status');

    await publish(accessToken, id).expect(403);
  });

  it('blocks restore from re-publishing past the limit', async () => {
    const { accessToken } = await registerUser();
    const ids = await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    // Archive one published article, then publish a replacement to refill.
    await asUser(accessToken).patch(`${API}/articles/${ids[0]}/archive`).expect(200);
    const replacement = await draft(accessToken, 'Replacement');
    await publish(accessToken, replacement).expect(200);

    // Restoring the archived one would make a 4th published article.
    const response = await asUser(accessToken)
      .patch(`${API}/articles/${ids[0]}/restore`)
      .expect(403);

    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(await statusOf(accessToken, ids[0])).toBe('Archived');
  });

  it('allows restore of an article that was archived as a draft', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);

    const id = await draft(accessToken, 'Archived draft');
    await asUser(accessToken).patch(`${API}/articles/${id}/archive`).expect(200);

    // It comes back a draft, so no published slot is needed.
    await asUser(accessToken).patch(`${API}/articles/${id}/restore`).expect(200);
    expect(await statusOf(accessToken, id)).toBe('Draft');
  });
});

describe('Published-article limit — freeing a slot', () => {
  it('unpublishing back to draft frees a slot', async () => {
    const { accessToken } = await registerUser();
    const ids = await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Waiting');

    await publish(accessToken, fourth).expect(403);

    await asUser(accessToken)
      .patch(`${API}/articles/${ids[0]}/status`)
      .send({ status: 'Draft' })
      .expect(200);

    await publish(accessToken, fourth).expect(200);
  });

  it('archiving frees a slot', async () => {
    const { accessToken } = await registerUser();
    const ids = await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Waiting');

    await publish(accessToken, fourth).expect(403);
    await asUser(accessToken).patch(`${API}/articles/${ids[0]}/archive`).expect(200);
    await publish(accessToken, fourth).expect(200);
  });

  it('deleting a published article frees a slot', async () => {
    const { accessToken } = await registerUser();
    const ids = await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Waiting');

    await publish(accessToken, fourth).expect(403);
    await asUser(accessToken).delete(`${API}/articles/${ids[0]}`).expect(200);
    await publish(accessToken, fourth).expect(200);
  });
});

describe('Published-article limit — paid plans', () => {
  it('lets Pro publish past the free ceiling', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT + 3);

    expect((await entitlements(accessToken)).capabilities.publishedArticles).toMatchObject({
      limit: null,
      usage: 6,
      remaining: null,
      reached: false,
    });
  });

  it('lets Business publish past the free ceiling', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'yearly' });

    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT + 2);
    expect((await entitlements(accessToken)).capabilities.publishedArticles.usage).toBe(5);
  });

  it('applies the new ceiling only once the server confirms the plan', async () => {
    const { accessToken, user } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const fourth = await draft(accessToken, 'Fourth');

    await publish(accessToken, fourth).expect(403);
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });
    await publish(accessToken, fourth).expect(200);
  });

  it('counts only the caller’s own published articles', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    await fillPublished(alice.accessToken, STARTER_PUBLISHED_LIMIT);
    const aliceFourth = await draft(alice.accessToken, 'Alice fourth');
    await publish(alice.accessToken, aliceFourth).expect(403);

    // Bob's allowance is untouched.
    const bobFirst = await draft(bob.accessToken, 'Bob first');
    await publish(bob.accessToken, bobFirst).expect(200);
  });
});

describe('Published-article limit — cannot be bypassed by the client', () => {
  it('ignores a plan smuggled into the publish payload', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Forged');

    await asUser(accessToken)
      .patch(`${API}/articles/${id}/status`)
      .send({ status: 'Published', planId: 'business', limits: { publishedArticles: null } })
      .expect(403);
  });

  it('ignores plan claims sent as headers', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Header forgery');

    await asUser(accessToken)
      .patch(`${API}/articles/${id}/status`)
      .set('X-Plan', 'business')
      .send({ status: 'Published' })
      .expect(403);
  });

  it('reads the plan from the database, and a pending request is not a plan', async () => {
    const { accessToken, user } = await registerUser();
    await fillPublished(accessToken, STARTER_PUBLISHED_LIMIT);
    const id = await draft(accessToken, 'Pending');

    await asUser(accessToken)
      .post(`${API}/billing/subscription/request`)
      .send({ planId: 'business', cycle: 'yearly' })
      .expect(202);

    await publish(accessToken, id).expect(403);
    expect((await User.findById(user.id)).subscription.planId).toBe('starter');
  });
});

describe('Team member limit — enforcement', () => {
  const invite = (token, email) =>
    asUser(token).post(`${API}/team`).send({ name: 'Invitee', email, role: 'Editor' });

  it('refuses any invite on a single-seat plan', async () => {
    const { accessToken } = await registerUser();

    // Starter allows 1 seat and the owner holds it.
    const response = await invite(accessToken, 'first.invitee@example.com').expect(403);

    expect(response.body).toMatchObject({ success: false, code: 'PLAN_LIMIT_REACHED' });
    expect(response.body.message).toMatch(/single user/i);
  });

  it('creates no member and sends no invite when refused', async () => {
    const { accessToken, user } = await registerUser();

    await invite(accessToken, 'ghost@example.com').expect(403);

    expect(await TeamMember.countDocuments({ workspaceOwner: user.id })).toBe(0);
  });

  it('allows invites up to the seat count on a paid plan', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    // Pro is 5 seats including the owner, so 4 invites.
    for (let i = 0; i < 4; i += 1) {
      await invite(accessToken, `teammate${i}@example.com`).expect(201);
    }

    await invite(accessToken, 'one.too.many@example.com').expect(403);
  });

  it('counts a pending invitation as an occupied seat', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    for (let i = 0; i < 4; i += 1) {
      await invite(accessToken, `pending${i}@example.com`).expect(201);
    }

    // None of them registered, so all four are still 'Invited'.
    const pending = await TeamMember.countDocuments({
      workspaceOwner: user.id,
      status: 'Invited',
    });
    expect(pending).toBe(4);

    // The seat is spoken for regardless.
    await invite(accessToken, 'blocked@example.com').expect(403);
  });

  it('frees a seat when a member is removed', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    for (let i = 0; i < 4; i += 1) {
      await invite(accessToken, `member${i}@example.com`).expect(201);
    }
    await invite(accessToken, 'blocked@example.com').expect(403);

    const members = await asUser(accessToken).get(`${API}/team`).expect(200);
    const id = members.body.data.members[0].id;
    await asUser(accessToken).delete(`${API}/team/${id}`).expect(200);

    await invite(accessToken, 'now.allowed@example.com').expect(201);
  });

  it('reports a duplicate as a conflict, not a seat problem', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'pro', cycle: 'monthly' });

    await invite(accessToken, 'dupe@example.com').expect(201);
    await invite(accessToken, 'dupe@example.com').expect(409);
  });

  it('is unlimited on Business', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'yearly' });

    for (let i = 0; i < 8; i += 1) {
      await invite(accessToken, `unlimited${i}@example.com`).expect(201);
    }
  });
});

describe('GET /billing/entitlements', () => {
  it('rejects an unauthenticated caller', async () => {
    await request(app).get(`${API}/billing/entitlements`).expect(401);
  });

  it('reports published limit, usage, remaining and enforcement', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, 2);
    // A draft alongside them, to prove it is not counted.
    await createArticle(accessToken, 'Unpublished').expect(201);

    const result = await entitlements(accessToken);

    expect(result.planId).toBe('starter');
    expect(result.capabilities.publishedArticles).toEqual({
      limit: 3,
      usage: 2,
      remaining: 1,
      enforced: true,
      reached: false,
    });
  });

  it('no longer reports a total-article capability', async () => {
    const { accessToken } = await registerUser();
    await createArticle(accessToken, 'A draft').expect(201);

    const result = await entitlements(accessToken);

    expect(result.capabilities.articles).toBeUndefined();
    expect(Object.keys(result.capabilities)).toEqual(
      expect.arrayContaining(['publishedArticles', 'teamMembers', 'aiGenerationsPerDay']),
    );
  });

  it('counts the owner’s own seat', async () => {
    const { accessToken } = await registerUser();

    const result = await entitlements(accessToken);

    expect(result.capabilities.teamMembers).toEqual({
      limit: 1,
      usage: 1,
      remaining: 0,
      enforced: true,
      reached: true,
    });
  });

  it('flags a capability as reached once it is full', async () => {
    const { accessToken } = await registerUser();
    await fillPublished(accessToken, 3);

    const result = await entitlements(accessToken);

    expect(result.capabilities.publishedArticles).toMatchObject({ remaining: 0, reached: true });
  });

  it('reports AI usage from the daily meter', async () => {
    const { accessToken } = await registerUser();

    const result = await entitlements(accessToken);

    // Metered now: a real zero from an empty day, not an unknown.
    expect(result.capabilities.aiGenerationsPerDay).toEqual({
      limit: 5,
      usage: 0,
      remaining: 5,
      enforced: true,
      reached: false,
    });
    expect(result.enforcedCapabilities).toEqual([
      'publishedArticles',
      'teamMembers',
      'aiGenerationsPerDay',
    ]);
  });

  it('reports unlimited as a null limit, still with real usage', async () => {
    const { accessToken, user } = await registerUser();
    await billingService.confirmUpgrade(user.id, { planId: 'business', cycle: 'monthly' });
    await fillPublished(accessToken, 2);

    const result = await entitlements(accessToken);

    expect(result.capabilities.publishedArticles).toEqual({
      limit: null,
      usage: 2,
      remaining: null,
      enforced: true,
      reached: false,
    });
  });

  it('tracks usage as articles are published and unpublished', async () => {
    const { accessToken } = await registerUser();

    expect((await entitlements(accessToken)).capabilities.publishedArticles.usage).toBe(0);

    const [id] = await fillPublished(accessToken, 1);
    expect((await entitlements(accessToken)).capabilities.publishedArticles.remaining).toBe(2);

    await asUser(accessToken)
      .patch(`${API}/articles/${id}/status`)
      .send({ status: 'Draft' })
      .expect(200);

    expect((await entitlements(accessToken)).capabilities.publishedArticles.usage).toBe(0);
  });

  it('exposes no internals', async () => {
    const { accessToken } = await registerUser();
    const body = JSON.stringify(await entitlements(accessToken));

    expect(body).not.toMatch(/workspaceOwner|_id|mongo|filter|repository/i);
  });
});
