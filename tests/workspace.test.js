import { describe, expect, it } from '@jest/globals';
import { API, PASSWORDS, app, asUser, createArticle, grantPlan, registerUser, request } from './helpers.js';

describe('Collections and bookmarks', () => {
  it('returns an empty state for a new account', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken).get(`${API}/collections/state`).expect(200);

    expect(response.body.data).toEqual({ bookmarks: [], collections: [] });
  });

  it('toggles a bookmark on and off', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const saved = await asUser(reader.accessToken)
      .post(`${API}/collections/bookmarks`)
      .send({ articleId: article.id })
      .expect(200);

    expect(saved.body.data.bookmarked).toBe(true);
    expect(saved.body.data.bookmarks).toContain(article.id);

    const removed = await asUser(reader.accessToken)
      .post(`${API}/collections/bookmarks`)
      .send({ articleId: article.id })
      .expect(200);

    expect(removed.body.data.bookmarked).toBe(false);
    expect(removed.body.data.bookmarks).not.toContain(article.id);
  });

  it('refuses to bookmark another author\'s draft', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const draft = await createArticle(author.accessToken);

    await asUser(reader.accessToken)
      .post(`${API}/collections/bookmarks`)
      .send({ articleId: draft.id })
      .expect(404);
  });

  it('creates, renames and deletes a collection', async () => {
    const { accessToken } = await registerUser();

    const created = await asUser(accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Design Inspiration' })
      .expect(201);

    const id = created.body.data.collection.id;
    expect(created.body.data.collection.name).toBe('Design Inspiration');

    const renamed = await asUser(accessToken)
      .patch(`${API}/collections/${id}`)
      .send({ name: 'Design References' })
      .expect(200);

    expect(renamed.body.data.collection.name).toBe('Design References');

    await asUser(accessToken).delete(`${API}/collections/${id}`).expect(200);
    await asUser(accessToken).get(`${API}/collections/${id}`).expect(404);
  });

  it('rejects a duplicate collection name', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken).post(`${API}/collections`).send({ name: 'Research' }).expect(201);
    await asUser(accessToken).post(`${API}/collections`).send({ name: 'Research' }).expect(409);
  });

  it('adds an article to a collection and bookmarks it implicitly', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const created = await asUser(reader.accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Later' })
      .expect(201);

    const id = created.body.data.collection.id;

    const added = await asUser(reader.accessToken)
      .post(`${API}/collections/${id}/articles`)
      .send({ articleId: article.id })
      .expect(200);

    expect(added.body.data.collection.articleIds).toContain(article.id);

    // Everything in a collection also appears in Saved.
    const state = await asUser(reader.accessToken).get(`${API}/collections/state`).expect(200);
    expect(state.body.data.bookmarks).toContain(article.id);
  });

  it('drops the article from collections when it is un-bookmarked', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const created = await asUser(reader.accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Later' })
      .expect(201);

    await asUser(reader.accessToken)
      .post(`${API}/collections/${created.body.data.collection.id}/articles`)
      .send({ articleId: article.id })
      .expect(200);

    await asUser(reader.accessToken)
      .post(`${API}/collections/bookmarks`)
      .send({ articleId: article.id })
      .expect(200);

    const state = await asUser(reader.accessToken).get(`${API}/collections/state`).expect(200);
    expect(state.body.data.collections[0].articleIds).toHaveLength(0);
  });

  it('does not leak another user\'s collections', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();

    const created = await asUser(owner.accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Private list' })
      .expect(201);

    await asUser(stranger.accessToken)
      .get(`${API}/collections/${created.body.data.collection.id}`)
      .expect(404);

    const list = await asUser(stranger.accessToken).get(`${API}/collections`).expect(200);
    expect(list.body.data.collections).toHaveLength(0);
  });
});

describe('Team', () => {
  it('starts empty and exposes the available roles', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken).get(`${API}/team`).expect(200);

    expect(response.body.data.members).toEqual([]);
    expect(response.body.data.roles).toEqual(['Admin', 'Editor', 'Viewer']);
  });

  it('invites a member, defaulting to Editor with a formatted join date', async () => {
    const { accessToken, user } = await registerUser();
    // Team seats are a paid entitlement; Starter is single-user.
    await grantPlan(user.id);

    const response = await asUser(accessToken)
      .post(`${API}/team`)
      .send({ name: 'Sarah Chen', email: 'sarah.chen@inkflow.ai' })
      .expect(201);

    const member = response.body.data.member;

    expect(member.role).toBe('Editor');
    expect(member.initials).toBe('SC');
    // The Team page renders this string directly, e.g. "Jul 2026".
    expect(member.joined).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });

  it('derives a name from the email when none is supplied', async () => {
    const { accessToken, user } = await registerUser();
    // Team seats are a paid entitlement; Starter is single-user.
    await grantPlan(user.id);

    const response = await asUser(accessToken)
      .post(`${API}/team`)
      .send({ email: 'marcus.thorne@inkflow.ai' })
      .expect(201);

    expect(response.body.data.member.name).toBe('marcus thorne');
  });

  it('rejects inviting the same person twice', async () => {
    const { accessToken, user } = await registerUser();
    await grantPlan(user.id);

    await asUser(accessToken).post(`${API}/team`).send({ email: 'dup@inkflow.ai' }).expect(201);
    await asUser(accessToken).post(`${API}/team`).send({ email: 'dup@inkflow.ai' }).expect(409);
  });

  it('rejects inviting yourself', async () => {
    const { accessToken, payload } = await registerUser();

    await asUser(accessToken).post(`${API}/team`).send({ email: payload.email }).expect(400);
  });

  it('updates a role and removes a member', async () => {
    const { accessToken, user } = await registerUser();
    await grantPlan(user.id);

    const invited = await asUser(accessToken)
      .post(`${API}/team`)
      .send({ email: 'member@inkflow.ai' })
      .expect(201);

    const id = invited.body.data.member.id;

    const updated = await asUser(accessToken)
      .patch(`${API}/team/${id}/role`)
      .send({ role: 'Admin' })
      .expect(200);

    expect(updated.body.data.member.role).toBe('Admin');

    await asUser(accessToken).delete(`${API}/team/${id}`).expect(200);

    const list = await asUser(accessToken).get(`${API}/team`).expect(200);
    expect(list.body.data.members).toHaveLength(0);
  });

  it('rejects an unknown role', async () => {
    const { accessToken, user } = await registerUser();
    await grantPlan(user.id);

    const invited = await asUser(accessToken)
      .post(`${API}/team`)
      .send({ email: 'member@inkflow.ai' })
      .expect(201);

    await asUser(accessToken)
      .patch(`${API}/team/${invited.body.data.member.id}/role`)
      .send({ role: 'Owner' })
      .expect(422);
  });

  it('keeps each workspace\'s team separate', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    await grantPlan(owner.user.id);
    await grantPlan(other.user.id);

    await asUser(owner.accessToken).post(`${API}/team`).send({ email: 'a@inkflow.ai' }).expect(201);

    const list = await asUser(other.accessToken).get(`${API}/team`).expect(200);
    expect(list.body.data.members).toHaveLength(0);
  });
});

describe('Profile and settings', () => {
  it('returns the caller\'s profile with computed initials', async () => {
    const { accessToken } = await registerUser({ name: 'Alex Rivera' });

    const response = await asUser(accessToken).get(`${API}/users/me`).expect(200);

    expect(response.body.data.profile.initials).toBe('AR');
    expect(response.body.data.profile).not.toHaveProperty('password');
  });

  it('updates profile fields', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .patch(`${API}/users/me`)
      .send({ name: 'Sulaima Khalil', role: 'Web Developer & Data Analyst', country: 'Pakistan' })
      .expect(200);

    expect(response.body.data.profile.name).toBe('Sulaima Khalil');
    expect(response.body.data.profile.role).toBe('Web Developer & Data Analyst');
  });

  it('refreshes the byline on existing articles when the name changes', async () => {
    const { accessToken } = await registerUser({ name: 'Old Name' });
    await createArticle(accessToken);

    await asUser(accessToken).patch(`${API}/users/me`).send({ name: 'New Name' }).expect(200);

    const list = await asUser(accessToken).get(`${API}/articles`).expect(200);
    expect(list.body.data[0].author).toBe('New Name');
  });

  it('rejects a username already taken', async () => {
    const first = await registerUser();
    const second = await registerUser();

    await asUser(first.accessToken).patch(`${API}/users/me`).send({ username: 'writer' }).expect(200);
    await asUser(second.accessToken).patch(`${API}/users/me`).send({ username: 'writer' }).expect(409);
  });

  it('returns default settings and merges a partial update', async () => {
    const { accessToken } = await registerUser();

    const initial = await asUser(accessToken).get(`${API}/users/me/settings`).expect(200);

    expect(initial.body.data.settings).toMatchObject({
      tone: 'Academic',
      creativeInference: true,
      autoCitations: false,
      twoFactor: false,
      editorialUpdates: true,
      analyticsReports: false,
    });

    const updated = await asUser(accessToken)
      .patch(`${API}/users/me/settings`)
      .send({ tone: 'Technical', twoFactor: true })
      .expect(200);

    expect(updated.body.data.settings.tone).toBe('Technical');
    expect(updated.body.data.settings.twoFactor).toBe(true);
    // Untouched toggles keep their values.
    expect(updated.body.data.settings.editorialUpdates).toBe(true);
  });

  it('rejects an unknown tone', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken).patch(`${API}/users/me/settings`).send({ tone: 'Sarcastic' }).expect(422);
  });

  it('exposes a public profile without private fields', async () => {
    const author = await registerUser({ name: 'Public Author' });
    await createArticle(author.accessToken, { status: 'Published' });

    const response = await request(app).get(`${API}/users/${author.user.id}`).expect(200);

    expect(response.body.data.profile.name).toBe('Public Author');
    expect(response.body.data.profile.email).toBeUndefined();
    expect(response.body.data.profile.settings).toBeUndefined();
    expect(response.body.data.articles).toHaveLength(1);
    expect(response.body.data.stats.published).toBe(1);
  });

  it('hides drafts from visitors but shows them to the owner', async () => {
    const author = await registerUser();
    await createArticle(author.accessToken, { title: 'Secret draft' });

    const anonymous = await request(app).get(`${API}/users/${author.user.id}`).expect(200);
    expect(anonymous.body.data.articles).toHaveLength(0);

    const self = await asUser(author.accessToken).get(`${API}/users/${author.user.id}`).expect(200);
    expect(self.body.data.articles).toHaveLength(1);
  });

  it('deletes the account and everything it owns', async () => {
    const { accessToken, payload, user } = await registerUser();
    await createArticle(accessToken);

    await asUser(accessToken)
      .delete(`${API}/users/me`)
      .send({ password: payload.password })
      .expect(200);

    await request(app).get(`${API}/users/${user.id}`).expect(404);
    await asUser(accessToken).get(`${API}/auth/me`).expect(401);
  });

  it('requires the password to delete an account', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken).delete(`${API}/users/me`).send({}).expect(400);
    await asUser(accessToken).delete(`${API}/users/me`).send({ password: PASSWORDS.wrong }).expect(401);
  });
});
