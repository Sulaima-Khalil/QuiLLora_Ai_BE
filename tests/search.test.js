import { describe, expect, it } from '@jest/globals';
import { API, app, asUser, createArticle, registerUser, request } from './helpers.js';

/**
 * Search across the three content types the product's search bar promises:
 * articles (already supported by /articles/discover), people (new
 * /users/search) and collections (new ?search= on /collections).
 *
 * The security-relevant assertions are that drafts never surface publicly and
 * that a people result carries no contact details or account internals.
 */

const publish = async (token, overrides = {}) => {
  const article = await createArticle(token, overrides);
  await asUser(token).patch(`${API}/articles/${article.id}/status`).send({ status: 'Published' }).expect(200);
  return article;
};

describe('Search — articles', () => {
  it('finds a published article by a word in its title', async () => {
    const { accessToken } = await registerUser();
    const article = await publish(accessToken, { title: 'Designing Resilient Systems' });

    const response = await request(app)
      .get(`${API}/articles/discover`)
      .query({ search: 'Resilient' })
      .expect(200);

    expect(response.body.data.map((a) => a.id)).toContain(article.id);
  });

  it('matches partial words, as the search control expects', async () => {
    const { accessToken } = await registerUser();
    await publish(accessToken, { title: 'Typography for Long-Form Reading' });

    const response = await request(app)
      .get(`${API}/articles/discover`)
      .query({ search: 'typogra' })
      .expect(200);

    expect(response.body.data.some((a) => a.title === 'Typography for Long-Form Reading')).toBe(true);
  });

  it('never returns a draft, even to the author who owns it', async () => {
    const { accessToken } = await registerUser();
    const draft = await createArticle(accessToken, { title: 'Unpublished Secret Manuscript' });

    // Signed out.
    const anonymous = await request(app)
      .get(`${API}/articles/discover`)
      .query({ search: 'Unpublished Secret' })
      .expect(200);
    expect(anonymous.body.data).toHaveLength(0);

    // And as the author: Discover is the public feed, not a workspace view.
    const owner = await asUser(accessToken)
      .get(`${API}/articles/discover`)
      .query({ search: 'Unpublished Secret' })
      .expect(200);
    expect(owner.body.data.map((a) => a.id)).not.toContain(draft.id);
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const response = await request(app)
      .get(`${API}/articles/discover`)
      .query({ search: 'zzzqqqnothingmatchesthis' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('escapes regex metacharacters instead of letting them reach the engine', async () => {
    const response = await request(app)
      .get(`${API}/articles/discover`)
      .query({ search: '.*' })
      .expect(200);

    // Treated as the literal string ".*", which matches no seeded title.
    expect(response.body.data).toEqual([]);
  });
});

describe('Search — people (GET /users/search)', () => {
  it('finds an active user by name', async () => {
    const { user } = await registerUser({ name: 'Marguerite Fontaine' });

    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: 'Marguerite' })
      .expect(200);

    expect(response.body.data.map((p) => p.id)).toContain(user.id);
  });

  it('matches on a partial name, case-insensitively', async () => {
    await registerUser({ name: 'Bartholomew Quill' });

    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: 'bartho' })
      .expect(200);

    expect(response.body.data.some((p) => p.name === 'Bartholomew Quill')).toBe(true);
  });

  it('exposes no email, settings or account internals in a result', async () => {
    const { user } = await registerUser({ name: 'Persimmon Blackwood' });

    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: 'Persimmon' })
      .expect(200);

    const person = response.body.data.find((p) => p.id === user.id);

    expect(person).toBeDefined();
    expect(person).not.toHaveProperty('email');
    expect(person).not.toHaveProperty('settings');
    expect(person).not.toHaveProperty('hasPassword');
    expect(person).not.toHaveProperty('linkedProviders');
    expect(person).not.toHaveProperty('isEmailVerified');
    expect(person).not.toHaveProperty('lastLoginAt');
    expect(JSON.stringify(person)).not.toContain('@');

    // What a result card actually renders is present.
    expect(person).toMatchObject({ id: user.id, name: 'Persimmon Blackwood' });
    expect(person).toHaveProperty('avatar');
    expect(person).toHaveProperty('role');
  });

  it('rejects a one-character query rather than scanning the table', async () => {
    // 422 is this API's validation-failure status.
    await request(app).get(`${API}/users/search`).query({ search: 'a' }).expect(422);
  });

  it('rejects a missing query', async () => {
    await request(app).get(`${API}/users/search`).expect(422);
  });

  it('returns the shared pagination envelope', async () => {
    await registerUser({ name: 'Paginated Person' });

    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: 'Paginated', page: 1, limit: 5 })
      .expect(200);

    expect(response.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(response.body.meta).toHaveProperty('totalPages');
    expect(response.body.meta).toHaveProperty('hasNextPage');
  });

  it('is not shadowed by the /:identifier public-profile route', async () => {
    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: 'anybody' })
      .expect(200);

    // The profile route answers { profile, articles, stats }; search answers a list.
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('escapes regex metacharacters in the query', async () => {
    const response = await request(app)
      .get(`${API}/users/search`)
      .query({ search: '.*' })
      .expect(200);

    expect(response.body.data).toEqual([]);
  });
});

describe('Search — collections (GET /collections?search=)', () => {
  it('finds the caller’s collection by name', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Longform Journalism', description: 'Deep dives' })
      .expect(201);

    const response = await asUser(accessToken)
      .get(`${API}/collections`)
      .query({ search: 'Longform' })
      .expect(200);

    expect(response.body.data.collections.map((c) => c.name)).toContain('Longform Journalism');
  });

  it('matches on the description too', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Inbox', description: 'Quantum computing reading list' })
      .expect(201);

    const response = await asUser(accessToken)
      .get(`${API}/collections`)
      .query({ search: 'quantum' })
      .expect(200);

    expect(response.body.data.collections.map((c) => c.name)).toContain('Inbox');
  });

  it('never returns another user’s collection', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();

    await asUser(owner.accessToken)
      .post(`${API}/collections`)
      .send({ name: 'Private Vault Of Secrets' })
      .expect(201);

    const response = await asUser(stranger.accessToken)
      .get(`${API}/collections`)
      .query({ search: 'Private Vault' })
      .expect(200);

    expect(response.body.data.collections).toEqual([]);
  });

  it('requires authentication', async () => {
    await request(app).get(`${API}/collections`).query({ search: 'anything' }).expect(401);
  });

  it('is additive: listing without a search still returns everything', async () => {
    const { accessToken } = await registerUser();

    await asUser(accessToken).post(`${API}/collections`).send({ name: 'Alpha' }).expect(201);
    await asUser(accessToken).post(`${API}/collections`).send({ name: 'Beta' }).expect(201);

    const response = await asUser(accessToken).get(`${API}/collections`).expect(200);
    const names = response.body.data.collections.map((c) => c.name);

    expect(names).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  });

  it('returns nothing for a one-character query rather than the whole list', async () => {
    const { accessToken } = await registerUser();
    await asUser(accessToken).post(`${API}/collections`).send({ name: 'Alpha' }).expect(201);

    const response = await asUser(accessToken)
      .get(`${API}/collections`)
      .query({ search: 'a' })
      .expect(200);

    expect(response.body.data.collections).toEqual([]);
  });
});
