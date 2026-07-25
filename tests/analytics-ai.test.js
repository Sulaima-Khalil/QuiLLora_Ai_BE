import { describe, expect, it } from '@jest/globals';
import { API, app, asUser, createArticle, registerUser, request } from './helpers.js';
import { ArticleView } from '../src/models/index.js';
import { classifySource } from '../src/services/analytics.service.js';
import { generateArticle, generateInsights } from '../src/services/ai.service.js';

describe('Analytics', () => {
  it('returns a zero-filled report for a new account', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken).get(`${API}/analytics`).expect(200);
    const data = response.body.data;

    expect(data.summary.totalArticles).toBe(0);
    expect(data.summary.totalViews).toBe(0);
    // The chart always renders a full window, even with no data.
    expect(data.daily).toHaveLength(7);
    expect(data.daily.every((entry) => entry.views === 0)).toBe(true);
    // Every source is present so the legend is stable.
    expect(data.trafficSources.map((entry) => entry.label).sort()).toEqual([
      'Direct',
      'Referral',
      'Search',
      'Social',
    ]);
  });

  it('records a view from a reader and reflects it in the report', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const recorded = await asUser(reader.accessToken)
      .post(`${API}/articles/${article.id}/view`)
      .send({})
      .expect(200);

    expect(recorded.body.data).toEqual({ recorded: true, unique: true });

    const response = await asUser(author.accessToken).get(`${API}/analytics`).expect(200);

    expect(response.body.data.summary.periodViews).toBe(1);
    expect(response.body.data.summary.uniqueVisitors).toBe(1);
    expect(response.body.data.topArticles[0].title).toBe(article.title);
  });

  it('counts one unique view per visitor per day', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const first = await asUser(reader.accessToken).post(`${API}/articles/${article.id}/view`).send({});
    const second = await asUser(reader.accessToken).post(`${API}/articles/${article.id}/view`).send({});

    expect(first.body.data.unique).toBe(true);
    // The unique index on (article, visitorHash, day) enforces this.
    expect(second.body.data.unique).toBe(false);

    expect(await ArticleView.countDocuments({ article: article.id })).toBe(1);
  });

  it('ignores the author reading their own article', async () => {
    const author = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    const response = await asUser(author.accessToken)
      .post(`${API}/articles/${article.id}/view`)
      .send({})
      .expect(200);

    expect(response.body.data.recorded).toBe(false);
    expect(await ArticleView.countDocuments({})).toBe(0);
  });

  it('ignores views of an unpublished article', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const draft = await createArticle(author.accessToken);

    // The draft is invisible to the reader, so the view endpoint 404s.
    await asUser(reader.accessToken).post(`${API}/articles/${draft.id}/view`).send({}).expect(200);

    expect(await ArticleView.countDocuments({})).toBe(0);
  });

  it('classifies referrers into traffic sources', () => {
    expect(classifySource('', 'inkflow.ai')).toBe('Direct');
    expect(classifySource('https://www.google.com/search?q=x', 'inkflow.ai')).toBe('Search');
    expect(classifySource('https://twitter.com/post/1', 'inkflow.ai')).toBe('Social');
    expect(classifySource('https://someblog.dev/post', 'inkflow.ai')).toBe('Referral');
    // Internal navigation is not a referral.
    expect(classifySource('https://inkflow.ai/dashboard', 'inkflow.ai')).toBe('Direct');
    expect(classifySource('not-a-url', 'inkflow.ai')).toBe('Direct');
  });

  it('attributes a view to the referrer\'s source bucket', async () => {
    const author = await registerUser();
    const reader = await registerUser();
    const article = await createArticle(author.accessToken, { status: 'Published' });

    await asUser(reader.accessToken)
      .post(`${API}/articles/${article.id}/view`)
      .send({ referrer: 'https://www.google.com/search?q=inkflow' })
      .expect(200);

    const response = await asUser(author.accessToken).get(`${API}/analytics`).expect(200);
    const search = response.body.data.trafficSources.find((entry) => entry.label === 'Search');

    expect(search.views).toBe(1);
    expect(search.value).toBe(100);
  });

  it('summarises article totals for the dashboard cards', async () => {
    const { accessToken } = await registerUser();

    await createArticle(accessToken, { title: 'Published', status: 'Published' });
    await createArticle(accessToken, { title: 'Draft' });

    const response = await asUser(accessToken).get(`${API}/analytics/summary`).expect(200);

    expect(response.body.data.summary).toMatchObject({
      totalArticles: 2,
      published: 1,
      drafts: 1,
      archived: 0,
    });
  });

  it('rejects an out-of-range window', async () => {
    const { accessToken } = await registerUser();
    await asUser(accessToken).get(`${API}/analytics?days=9999`).expect(422);
  });

  it('requires authentication', async () => {
    await request(app).get(`${API}/analytics`).expect(401);
  });
});

describe('AI Writer', () => {
  it('generates a draft from a topic', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/ai/generate`)
      .send({ topic: 'neural prose', tone: 'Academic', length: 'Medium', category: 'AI' })
      .expect(200);

    const article = response.body.data.article;

    expect(article.title).toBe('An Analysis of Neural prose');
    expect(article.content).toContain('<p>');
    expect(article.wordCount).toBeGreaterThan(0);
    expect(article.readTime).toBeGreaterThanOrEqual(1);
  });

  it('applies the tone-specific title template', () => {
    expect(generateArticle({ topic: 'design systems', tone: 'Persuasive' }).title).toBe(
      'Why Design systems Matters More Than Ever',
    );
    expect(generateArticle({ topic: 'design systems', tone: 'Technical' }).title).toBe(
      'Design systems: A Technical Deep Dive',
    );
  });

  it('produces longer drafts for longer length presets', () => {
    const short = generateArticle({ topic: 'testing', length: 'Short' });
    const long = generateArticle({ topic: 'testing', length: 'Long' });

    expect(long.wordCount).toBeGreaterThan(short.wordCount);
  });

  it('is deterministic for the same prompt and varies with `variation`', () => {
    const first = generateArticle({ topic: 'testing', variation: 0 });
    const repeat = generateArticle({ topic: 'testing', variation: 0 });
    const different = generateArticle({ topic: 'testing', variation: 1 });

    expect(first.content).toBe(repeat.content);
    expect(first.content).not.toBe(different.content);
  });

  it('rejects a topic that is too short', async () => {
    const { accessToken } = await registerUser();
    await asUser(accessToken).post(`${API}/ai/generate`).send({ topic: 'ai' }).expect(422);
  });

  it('generates an extra paragraph', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken)
      .post(`${API}/ai/paragraph`)
      .send({ topic: 'testing' })
      .expect(200);

    expect(response.body.data.paragraph.html).toMatch(/^<p>.+<\/p>$/);
  });

  it('derives insights from the supplied draft rather than canned text', () => {
    const insights = generateInsights({
      content: '<p>One sentence here. Another sentence follows.</p><p>A second paragraph.</p>',
      topic: 'testing',
      category: 'Engineering',
    });

    expect(insights.stats.paragraphs).toBe(2);
    expect(insights.stats.words).toBeGreaterThan(0);
    expect(insights.factcheck).toContain(`${insights.stats.words} words`);
  });

  it('reports empty-draft insights honestly', () => {
    const insights = generateInsights({ content: '' });

    expect(insights.stats.words).toBe(0);
    expect(insights.factcheck).toMatch(/nothing to scan/i);
  });

  it('exposes the generation options the UI offers', async () => {
    const { accessToken } = await registerUser();

    const response = await asUser(accessToken).get(`${API}/ai/options`).expect(200);

    expect(response.body.data.tones).toEqual(['Academic', 'Minimalist', 'Persuasive', 'Technical']);
    expect(response.body.data.lengths).toEqual(['Short', 'Medium', 'Long']);
  });

  it('requires authentication', async () => {
    await request(app).post(`${API}/ai/generate`).send({ topic: 'testing' }).expect(401);
  });
});

describe('Infrastructure', () => {
  it('answers the health probe', async () => {
    const response = await request(app).get(`${API}/health`).expect(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('reports readiness when the database is connected', async () => {
    const response = await request(app).get(`${API}/ready`).expect(200);
    expect(response.body.data.database).toBe('connected');
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get(`${API}/does-not-exist`).expect(404);

    expect(response.body).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"email": broken}')
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('does not leak the framework banner', async () => {
    const response = await request(app).get(`${API}/health`);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets security headers', async () => {
    const response = await request(app).get(`${API}/health`);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('blocks an origin that is not allow-listed', async () => {
    const response = await request(app).get(`${API}/health`).set('Origin', 'https://evil.example');

    expect(response.status).toBe(403);
  });

  it('allows the configured client origin', async () => {
    const response = await request(app).get(`${API}/health`).set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
