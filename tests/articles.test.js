import { describe, expect, it } from '@jest/globals';
import { API, app, asUser, createArticle, registerUser, request } from './helpers.js';
import { Article } from '../src/models/index.js';

describe('Articles', () => {
  describe('POST /articles', () => {
    it('creates a draft and derives reading time, word count and excerpt', async () => {
      const { accessToken } = await registerUser();

      const content = `<p>${'word '.repeat(400).trim()}</p>`;

      const response = await asUser(accessToken)
        .post(`${API}/articles`)
        .send({ title: 'Derived Fields', content, category: 'Engineering' })
        .expect(201);

      const article = response.body.data.article;

      expect(article.status).toBe('Draft');
      expect(article.wordCount).toBe(400);
      expect(article.readTime).toBe(2); // 400 words / 200 wpm
      expect(article.readingTime).toBe('2 min read');
      expect(article.excerpt).not.toBe('');
      // The frontend card reads `description`, kept as an alias of excerpt.
      expect(article.description).toBe(article.excerpt);
    });

    it('returns the pre-formatted date and cover fields the frontend renders', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      expect(article.date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(article).toHaveProperty('img');
      expect(article).toHaveProperty('author');
    });

    it('strips dangerous markup from the article body', async () => {
      const { accessToken } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/articles`)
        .send({
          title: 'XSS attempt',
          content:
            '<p>Safe text</p><script>alert("xss")</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad link</a>',
        })
        .expect(201);

      const { content } = response.body.data.article;

      expect(content).toContain('Safe text');
      expect(content).not.toContain('<script');
      expect(content).not.toContain('onerror');
      expect(content).not.toContain('javascript:');
    });

    it('keeps safe formatting produced by the editor', async () => {
      const { accessToken } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/articles`)
        .send({
          title: 'Formatting survives',
          content:
            '<h1>Heading</h1><p style="text-align:center"><strong>bold</strong> <em>italic</em></p><blockquote><p>quote</p></blockquote>',
        })
        .expect(201);

      const { content } = response.body.data.article;

      expect(content).toContain('<h1>Heading</h1>');
      expect(content).toContain('<strong>bold</strong>');
      expect(content).toContain('text-align:center');
      expect(content).toContain('<blockquote>');
    });

    it('falls back to the first tag when no category is given', async () => {
      const { accessToken } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/articles`)
        .send({ title: 'Tag derived category', content: '<p>Body</p>', tags: ['Architecture', 'Tech'] })
        .expect(201);

      expect(response.body.data.article.category).toBe('Architecture');
    });

    it('rejects an unauthenticated request', async () => {
      await request(app).post(`${API}/articles`).send({ title: 'No auth' }).expect(401);
    });

    it('rejects a missing title', async () => {
      const { accessToken } = await registerUser();
      await asUser(accessToken).post(`${API}/articles`).send({ content: '<p>Body</p>' }).expect(422);
    });
  });

  describe('GET /articles', () => {
    it('returns only the caller\'s own articles', async () => {
      const author = await registerUser();
      const stranger = await registerUser();

      await createArticle(author.accessToken, { title: 'Mine' });
      await createArticle(stranger.accessToken, { title: 'Theirs' });

      const response = await asUser(author.accessToken).get(`${API}/articles`).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Mine');
    });

    it('paginates with accurate metadata', async () => {
      const { accessToken } = await registerUser();

      // Five drafts: the free plan limits published articles, not drafts.
      for (let index = 0; index < 5; index += 1) {
        await createArticle(accessToken, { title: `Article ${index}` });
      }

      const response = await asUser(accessToken).get(`${API}/articles?page=2&limit=2`).expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('filters by status', async () => {
      const { accessToken } = await registerUser();

      await createArticle(accessToken, { title: 'Draft one' });
      await createArticle(accessToken, { title: 'Published one', status: 'Published' });

      const response = await asUser(accessToken).get(`${API}/articles?status=Published`).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Published one');
    });

    it('searches by title', async () => {
      const { accessToken } = await registerUser();

      await createArticle(accessToken, { title: 'Distributed Systems Primer' });
      await createArticle(accessToken, { title: 'Colour Theory' });

      const response = await asUser(accessToken).get(`${API}/articles?search=distributed`).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Distributed Systems Primer');
    });
  });

  describe('GET /articles/discover', () => {
    it('lists only published public articles and works anonymously', async () => {
      const { accessToken } = await registerUser();

      await createArticle(accessToken, { title: 'Public piece', status: 'Published' });
      await createArticle(accessToken, { title: 'Draft piece' });
      await createArticle(accessToken, { title: 'Private piece', status: 'Published', visibility: 'private' });

      const response = await request(app).get(`${API}/articles/discover`).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Public piece');
    });

    it('flags bookmarked articles for a signed-in reader', async () => {
      const author = await registerUser();
      const reader = await registerUser();

      const article = await createArticle(author.accessToken, { status: 'Published' });

      await asUser(reader.accessToken)
        .post(`${API}/collections/bookmarks`)
        .send({ articleId: article.id })
        .expect(200);

      const response = await asUser(reader.accessToken).get(`${API}/articles/discover`).expect(200);

      expect(response.body.data[0].isBookmarked).toBe(true);
    });
  });

  describe('GET /articles/:id', () => {
    it('hides another author\'s draft behind a 404', async () => {
      const author = await registerUser();
      const stranger = await registerUser();

      const draft = await createArticle(author.accessToken);

      await asUser(stranger.accessToken).get(`${API}/articles/${draft.id}`).expect(404);
      await asUser(author.accessToken).get(`${API}/articles/${draft.id}`).expect(200);
    });

    it('returns 400 for a malformed id', async () => {
      await request(app).get(`${API}/articles/not-an-id`).expect(422);
    });

    it('returns 404 for a well-formed but unknown id', async () => {
      await request(app).get(`${API}/articles/64b7f9c2e1a2b3c4d5e6f7a8`).expect(404);
    });
  });

  describe('PUT /articles/:id', () => {
    it('updates fields the author owns', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      const response = await asUser(accessToken)
        .put(`${API}/articles/${article.id}`)
        .send({ title: 'Renamed', tags: ['One', 'Two'], visibility: 'unlisted' })
        .expect(200);

      expect(response.body.data.article.title).toBe('Renamed');
      expect(response.body.data.article.tags).toEqual(['One', 'Two']);
      expect(response.body.data.article.visibility).toBe('unlisted');
    });

    it('refuses to update someone else\'s article', async () => {
      const author = await registerUser();
      const stranger = await registerUser();

      const article = await createArticle(author.accessToken);

      await asUser(stranger.accessToken)
        .put(`${API}/articles/${article.id}`)
        .send({ title: 'Hijacked' })
        .expect(403);
    });

    it('recomputes reading time when the content changes', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      const response = await asUser(accessToken)
        .put(`${API}/articles/${article.id}`)
        .send({ content: `<p>${'word '.repeat(1000).trim()}</p>` })
        .expect(200);

      expect(response.body.data.article.wordCount).toBe(1000);
      expect(response.body.data.article.readTime).toBe(5);
    });
  });

  describe('Archive and restore', () => {
    it('archives a published article and restores it to Published', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken, { status: 'Published' });

      const archived = await asUser(accessToken)
        .patch(`${API}/articles/${article.id}/archive`)
        .expect(200);

      expect(archived.body.data.article.status).toBe('Archived');
      expect(archived.body.data.article.previousStatus).toBe('Published');

      const restored = await asUser(accessToken)
        .patch(`${API}/articles/${article.id}/restore`)
        .expect(200);

      expect(restored.body.data.article.status).toBe('Published');
    });

    it('restores a draft back to Draft', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      await asUser(accessToken).patch(`${API}/articles/${article.id}/archive`).expect(200);
      const restored = await asUser(accessToken).patch(`${API}/articles/${article.id}/restore`).expect(200);

      expect(restored.body.data.article.status).toBe('Draft');
    });

    it('refuses to restore an article that is not archived', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      await asUser(accessToken).patch(`${API}/articles/${article.id}/restore`).expect(400);
    });
  });

  describe('DELETE /articles/:id', () => {
    it('deletes the article and clears it from bookmarks and collections', async () => {
      const author = await registerUser();
      const reader = await registerUser();

      const article = await createArticle(author.accessToken, { status: 'Published' });

      const collection = await asUser(reader.accessToken)
        .post(`${API}/collections`)
        .send({ name: 'Reading list' })
        .expect(201);

      await asUser(reader.accessToken)
        .post(`${API}/collections/${collection.body.data.collection.id}/articles`)
        .send({ articleId: article.id })
        .expect(200);

      await asUser(author.accessToken).delete(`${API}/articles/${article.id}`).expect(200);

      expect(await Article.findById(article.id)).toBeNull();

      // No dangling references are left behind.
      const state = await asUser(reader.accessToken).get(`${API}/collections/state`).expect(200);
      expect(state.body.data.bookmarks).not.toContain(article.id);
      expect(state.body.data.collections[0].articleIds).not.toContain(article.id);
    });
  });

  describe('Article notes', () => {
    it('adds and removes private notes', async () => {
      const { accessToken } = await registerUser();
      const article = await createArticle(accessToken);

      const added = await asUser(accessToken)
        .post(`${API}/articles/${article.id}/notes`)
        .send({ text: 'Tighten the executive summary.' })
        .expect(201);

      expect(added.body.data.notes).toHaveLength(1);
      const noteId = added.body.data.notes[0].id;

      const removed = await asUser(accessToken)
        .delete(`${API}/articles/${article.id}/notes/${noteId}`)
        .expect(200);

      expect(removed.body.data.notes).toHaveLength(0);
    });

    it('does not expose notes to other readers', async () => {
      const author = await registerUser();
      const reader = await registerUser();

      const article = await createArticle(author.accessToken, { status: 'Published' });

      await asUser(author.accessToken)
        .post(`${API}/articles/${article.id}/notes`)
        .send({ text: 'Internal reminder' })
        .expect(201);

      const response = await asUser(reader.accessToken).get(`${API}/articles/${article.id}`).expect(200);

      expect(response.body.data.article.notes).toBeUndefined();
    });
  });
});
