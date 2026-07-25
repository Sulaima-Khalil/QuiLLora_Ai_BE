import { randomBytes, randomInt } from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';

export const API = '/api/v1';

/**
 * Fixture credentials, generated per run.
 *
 * Deliberately not literals: a hardcoded password in a committed test is
 * indistinguishable from a real leaked one to a secret scanner, and the
 * resulting false positives train people to ignore the scanner. Generating
 * them also guarantees no test accidentally depends on a specific string.
 */
const suffix = randomBytes(6).toString('hex');

export const PASSWORDS = Object.freeze({
  /** What `buildUser` registers with. */
  initial: `Fx-init-${suffix}`,
  /** A valid replacement, for change-password and reset flows. */
  replacement: `Fx-next-${suffix}`,
  /** A second replacement, where a test resets twice. */
  alternate: `Fx-alt-${suffix}`,
  /** Never registered anywhere — used to assert rejection. */
  wrong: `Fx-wrong-${suffix}`,
  /** Deliberately mismatched against `initial` for confirm-password checks. */
  mismatched: `Fx-mismatch-${suffix}`,
  /** Below the 8-character minimum, to trigger validation. */
  tooShort: 'Fx-1',
});

/** Six-digit reset codes, planted directly on the user document by tests. */
export const CODES = Object.freeze({
  valid: String(randomInt(100_000, 1_000_000)),
  other: String(randomInt(100_000, 1_000_000)),
  wrong: '000000',
});

/** Default registration payload; override any field per test. */
export const buildUser = (overrides = {}) => ({
  name: 'Test Writer',
  email: `writer_${randomBytes(5).toString('hex')}@inkflow.ai`,
  password: PASSWORDS.initial,
  ...overrides,
});

/**
 * Registers a user and returns everything a test needs to act as them.
 *
 * The cookie jar is returned alongside the bearer token so both auth
 * transports can be exercised.
 */
export const registerUser = async (overrides = {}) => {
  const payload = buildUser(overrides);

  const response = await request(app).post(`${API}/auth/register`).send(payload).expect(201);

  return {
    payload,
    user: response.body.data.user,
    accessToken: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
    cookies: response.headers['set-cookie'],
  };
};

/** Supertest agent with the Authorization header pre-applied. */
export const asUser = (token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

/** Creates an article owned by `token`'s user. */
export const createArticle = async (token, overrides = {}) => {
  const response = await asUser(token)
    .post(`${API}/articles`)
    .send({
      title: 'A Test Article About Systems',
      content: '<p>The opening paragraph carries the promise of the piece.</p><p>Supporting detail follows.</p>',
      category: 'Engineering',
      tags: ['Testing'],
      ...overrides,
    })
    .expect(201);

  return response.body.data.article;
};

export { app, request };
