import { describe, expect, it } from '@jest/globals';
import { API, CODES, PASSWORDS, app, asUser, buildUser, registerUser, request } from './helpers.js';
import { User } from '../src/models/index.js';
import { hashToken } from '../src/helpers/crypto.helper.js';

describe('Authentication', () => {
  describe('POST /auth/register', () => {
    it('creates an account, hashes the password and issues a session', async () => {
      const payload = buildUser();

      const response = await request(app).post(`${API}/auth/register`).send(payload).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(payload.email.toLowerCase());
      expect(response.body.data.accessToken).toEqual(expect.any(String));

      // The password must never appear in a response body.
      expect(JSON.stringify(response.body)).not.toContain(payload.password);

      const stored = await User.findOne({ email: payload.email }).select('+password');
      expect(stored.password).not.toBe(payload.password);
      expect(stored.password).toMatch(/^\$2[aby]\$/);

      // Both auth cookies are set and inaccessible to JavaScript.
      const cookies = response.headers['set-cookie'].join(';');
      expect(cookies).toContain('inkflow_access_token');
      expect(cookies).toContain('inkflow_refresh_token');
      expect(cookies).toContain('HttpOnly');
    });

    it('rejects a duplicate email with 409', async () => {
      const { payload } = await registerUser();

      const response = await request(app)
        .post(`${API}/auth/register`)
        .send(buildUser({ email: payload.email }))
        .expect(409);

      expect(response.body.message).toMatch(/already exists/i);
    });

    it('rejects a short password with a field-level error', async () => {
      const response = await request(app)
        .post(`${API}/auth/register`)
        .send(buildUser({ password: PASSWORDS.tooShort }))
        .expect(422);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'body.password' })]),
      );
    });

    it('rejects mismatched confirmPassword', async () => {
      await request(app)
        .post(`${API}/auth/register`)
        .send(buildUser({ password: PASSWORDS.initial, confirmPassword: PASSWORDS.mismatched }))
        .expect(422);
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with correct credentials', async () => {
      const { payload } = await registerUser();

      const response = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: payload.password })
        .expect(200);

      expect(response.body.data.user.email).toBe(payload.email.toLowerCase());
      expect(response.body.data.accessToken).toEqual(expect.any(String));
    });

    it('returns the same generic message for a wrong password and an unknown email', async () => {
      const { payload } = await registerUser();

      const wrongPassword = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: PASSWORDS.wrong })
        .expect(401);

      const unknownEmail = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@inkflow.ai', password: PASSWORDS.wrong })
        .expect(401);

      // Identical wording is what prevents account enumeration.
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('is immune to a NoSQL operator injection in the email field', async () => {
      await registerUser();

      const response = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: { $ne: null }, password: { $ne: null } });

      // The sanitizer strips `$ne`, leaving an empty object that fails validation.
      expect([401, 422]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the signed-in user via bearer token', async () => {
      const { accessToken, payload } = await registerUser();

      const response = await asUser(accessToken).get(`${API}/auth/me`).expect(200);
      expect(response.body.data.user.email).toBe(payload.email.toLowerCase());
    });

    it('returns the signed-in user via the HTTP-only cookie', async () => {
      const { cookies, payload } = await registerUser();

      const response = await request(app).get(`${API}/auth/me`).set('Cookie', cookies).expect(200);
      expect(response.body.data.user.email).toBe(payload.email.toLowerCase());
    });

    it('rejects a missing token with 401', async () => {
      await request(app).get(`${API}/auth/me`).expect(401);
    });

    it('rejects a malformed token with 401', async () => {
      await asUser('not-a-real-jwt').get(`${API}/auth/me`).expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and issues a new pair', async () => {
      const { refreshToken } = await registerUser();

      const response = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken })
        .expect(200);

      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('revokes every session when a rotated token is replayed', async () => {
      const { refreshToken } = await registerUser();

      const rotated = await request(app).post(`${API}/auth/refresh`).send({ refreshToken }).expect(200);
      const newToken = rotated.body.data.refreshToken;

      // Replaying the consumed token is the signature of a stolen credential.
      const replay = await request(app).post(`${API}/auth/refresh`).send({ refreshToken }).expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The whole family is revoked, so the legitimate token dies too.
      await request(app).post(`${API}/auth/refresh`).send({ refreshToken: newToken }).expect(401);
    });

    it('rejects a refresh attempt with no token', async () => {
      await request(app).post(`${API}/auth/refresh`).send({}).expect(401);
    });
  });

  describe('Logout', () => {
    it('clears cookies and revokes the presented refresh token', async () => {
      const { refreshToken, cookies } = await registerUser();

      const response = await request(app).post(`${API}/auth/logout`).set('Cookie', cookies).expect(200);

      const cleared = response.headers['set-cookie'].join(';');
      expect(cleared).toContain('inkflow_access_token=;');

      await request(app).post(`${API}/auth/refresh`).send({ refreshToken }).expect(401);
    });
  });

  describe('Email verification', () => {
    it('verifies the address with the emailed token', async () => {
      const { payload } = await registerUser();

      // The raw token is only ever emailed, so the test reproduces the digest
      // lookup the service performs rather than reading the token back out.
      const user = await User.findOne({ email: payload.email }).select('+emailVerificationToken');
      expect(user.isEmailVerified).toBe(false);
      expect(user.emailVerificationToken).toEqual(expect.any(String));

      // Re-deriving the raw value is impossible by design, so drive the
      // endpoint with a known token written directly to the document.
      const rawToken = 'a'.repeat(64);
      user.emailVerificationToken = hashToken(rawToken);
      user.emailVerificationExpires = new Date(Date.now() + 60_000);
      await user.save({ validateBeforeSave: false });

      const response = await request(app)
        .post(`${API}/auth/verify-email`)
        .send({ token: rawToken })
        .expect(200);

      expect(response.body.data.user.isEmailVerified).toBe(true);
    });

    it('rejects an invalid token', async () => {
      await request(app)
        .post(`${API}/auth/verify-email`)
        .send({ token: 'b'.repeat(64) })
        .expect(400);
    });

    it('rejects an expired token', async () => {
      const { payload } = await registerUser();
      const rawToken = 'c'.repeat(64);

      const user = await User.findOne({ email: payload.email }).select('+emailVerificationToken');
      user.emailVerificationToken = hashToken(rawToken);
      user.emailVerificationExpires = new Date(Date.now() - 1000);
      await user.save({ validateBeforeSave: false });

      await request(app).post(`${API}/auth/verify-email`).send({ token: rawToken }).expect(400);
    });
  });

  describe('Password reset by 6-digit code', () => {
    /** Plants a known code so the test can drive the endpoints that consume it. */
    const plantCode = async (email, code, { expiresInMs = 60_000 } = {}) => {
      const user = await User.findOne({ email }).select('+passwordResetCode');
      user.passwordResetCode = hashToken(code);
      user.passwordResetCodeAttempts = 0;
      user.passwordResetExpires = new Date(Date.now() + expiresInMs);
      await user.save({ validateBeforeSave: false });
      return user;
    };

    it('issues a code alongside the link when a reset is requested', async () => {
      const { payload } = await registerUser();

      await request(app).post(`${API}/auth/forgot-password`).send({ email: payload.email }).expect(200);

      const user = await User.findOne({ email: payload.email }).select(
        '+passwordResetCode +passwordResetToken +passwordResetExpires',
      );

      // Both credentials are issued: the code to type, the token for the link.
      expect(user.passwordResetCode).toEqual(expect.any(String));
      expect(user.passwordResetToken).toEqual(expect.any(String));
      expect(user.passwordResetExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('verifies a correct code without consuming it', async () => {
      const { payload } = await registerUser();
      await plantCode(payload.email, CODES.valid);

      const response = await request(app)
        .post(`${API}/auth/verify-reset-code`)
        .send({ email: payload.email, code: CODES.valid })
        .expect(200);

      expect(response.body.data.verified).toBe(true);

      // Step 3 still needs the code, so verification must not burn it.
      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ email: payload.email, code: CODES.valid, password: PASSWORDS.replacement })
        .expect(200);
    });

    it('rejects a wrong code', async () => {
      const { payload } = await registerUser();
      await plantCode(payload.email, CODES.valid);

      const response = await request(app)
        .post(`${API}/auth/verify-reset-code`)
        .send({ email: payload.email, code: CODES.wrong })
        .expect(400);

      expect(response.body.code).toBe('RESET_CODE_INVALID');
    });

    it('rejects a malformed code before it reaches the service', async () => {
      const { payload } = await registerUser();

      await request(app)
        .post(`${API}/auth/verify-reset-code`)
        .send({ email: payload.email, code: '12ab' })
        .expect(422);
    });

    it('burns the code after five wrong attempts', async () => {
      const { payload } = await registerUser();
      await plantCode(payload.email, CODES.valid);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app)
          .post(`${API}/auth/verify-reset-code`)
          .send({ email: payload.email, code: CODES.wrong })
          .expect(400);
      }

      // The correct code is now worthless — the small numeric space cannot be
      // walked even if rate limiting is evaded.
      await request(app)
        .post(`${API}/auth/verify-reset-code`)
        .send({ email: payload.email, code: CODES.valid })
        .expect(400);

      const user = await User.findOne({ email: payload.email }).select('+passwordResetCode');
      expect(user.passwordResetCode).toBeUndefined();
    });

    it('rejects an expired code', async () => {
      const { payload } = await registerUser();
      await plantCode(payload.email, CODES.valid, { expiresInMs: -1000 });

      await request(app)
        .post(`${API}/auth/verify-reset-code`)
        .send({ email: payload.email, code: CODES.valid })
        .expect(400);
    });

    it('resets the password with email + code and revokes sessions', async () => {
      const { payload, refreshToken } = await registerUser();
      await plantCode(payload.email, CODES.other);

      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ email: payload.email, code: CODES.other, password: PASSWORDS.replacement })
        .expect(200);

      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: PASSWORDS.replacement })
        .expect(200);

      await request(app).post(`${API}/auth/refresh`).send({ refreshToken }).expect(401);
    });

    it('consumes the code so it cannot be replayed', async () => {
      const { payload } = await registerUser();
      await plantCode(payload.email, CODES.other);

      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ email: payload.email, code: CODES.other, password: PASSWORDS.replacement })
        .expect(200);

      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ email: payload.email, code: CODES.other, password: PASSWORDS.alternate })
        .expect(400);
    });

    it('requires either a token or an email and code pair', async () => {
      await registerUser();

      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ password: PASSWORDS.replacement })
        .expect(422);
    });
  });

  describe('Password reset', () => {
    it('responds identically whether or not the account exists', async () => {
      const { payload } = await registerUser();

      const known = await request(app)
        .post(`${API}/auth/forgot-password`)
        .send({ email: payload.email })
        .expect(200);

      const unknown = await request(app)
        .post(`${API}/auth/forgot-password`)
        .send({ email: 'ghost@inkflow.ai' })
        .expect(200);

      expect(known.body.message).toBe(unknown.body.message);
    });

    it('resets the password and revokes existing sessions', async () => {
      const { payload, refreshToken } = await registerUser();

      await request(app).post(`${API}/auth/forgot-password`).send({ email: payload.email }).expect(200);

      const rawToken = 'd'.repeat(64);
      const user = await User.findOne({ email: payload.email }).select('+passwordResetToken');
      user.passwordResetToken = hashToken(rawToken);
      user.passwordResetExpires = new Date(Date.now() + 60_000);
      await user.save({ validateBeforeSave: false });

      await request(app)
        .post(`${API}/auth/reset-password`)
        .send({ token: rawToken, password: PASSWORDS.replacement })
        .expect(200);

      // Old credential fails, new one works.
      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: payload.password })
        .expect(401);

      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: PASSWORDS.replacement })
        .expect(200);

      // Sessions issued before the reset are dead.
      await request(app).post(`${API}/auth/refresh`).send({ refreshToken }).expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and keeps the caller signed in', async () => {
      const { accessToken, payload } = await registerUser();

      const response = await asUser(accessToken)
        .post(`${API}/auth/change-password`)
        .send({ currentPassword: payload.password, newPassword: PASSWORDS.replacement })
        .expect(200);

      // A fresh pair is issued so the initiating device is not logged out.
      expect(response.body.data.accessToken).toEqual(expect.any(String));

      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: payload.email, password: PASSWORDS.replacement })
        .expect(200);
    });

    it('rejects a wrong current password', async () => {
      const { accessToken } = await registerUser();

      await asUser(accessToken)
        .post(`${API}/auth/change-password`)
        .send({ currentPassword: PASSWORDS.wrong, newPassword: PASSWORDS.replacement })
        .expect(401);
    });

    it('rejects reusing the current password', async () => {
      const { accessToken, payload } = await registerUser();

      await asUser(accessToken)
        .post(`${API}/auth/change-password`)
        .send({ currentPassword: payload.password, newPassword: payload.password })
        .expect(400);
    });

    it('invalidates tokens issued before the change', async () => {
      const { accessToken, payload } = await registerUser();

      await asUser(accessToken)
        .post(`${API}/auth/change-password`)
        .send({ currentPassword: payload.password, newPassword: PASSWORDS.replacement })
        .expect(200);

      // `passwordChangedAt` is backdated one second, so the original token
      // now predates the change and must be refused.
      const response = await asUser(accessToken).get(`${API}/auth/me`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('PASSWORD_CHANGED');
    });
  });

  describe('GET /auth/sessions', () => {
    it('lists active sessions and flags the current one', async () => {
      const { accessToken, cookies } = await registerUser();

      const response = await request(app)
        .get(`${API}/auth/sessions`)
        .set('Cookie', cookies)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.sessions).toHaveLength(1);
      expect(response.body.data.sessions[0].current).toBe(true);
    });
  });
});
