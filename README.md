# InkFlow AI — Backend

Production REST API for the [InkFlow AI](https://github.com/SulaimaKhalil785/ArticApp) editorial
workspace. Node.js, Express 5, MongoDB and Mongoose, with cookie-based JWT
authentication and refresh-token rotation.

Every endpoint here exists because a screen in the frontend needs it. Nothing
is speculative.

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Connecting the frontend](#connecting-the-frontend)
- [Scripts](#scripts)
- [Testing](#testing)
- [Documentation](#documentation)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Tool    | Version | Notes                                         |
| ------- | ------- | --------------------------------------------- |
| Node.js | >= 20   | Uses native `fetch` and ESM                   |
| MongoDB | >= 6    | Local install or a free MongoDB Atlas cluster |
| npm     | >= 10   | Ships with Node 20                            |

SMTP credentials are **optional**. Without them, emails are printed to the
console instead of sent, so verification and password-reset links stay usable
in development.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Generate two different JWT secrets and paste them into .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Point MONGO_URI at your database (local or Atlas)
#    local:  mongodb://127.0.0.1:27017/inkflow

# 5. Load the demo dataset (optional but recommended)
npm run seed

# 6. Start the API
npm run dev
```

The API is then at **http://localhost:4000/api/v1**, and
`GET /api/v1/health` should answer:

```json
{ "success": true, "message": "InkFlow AI API is running", "data": { "status": "ok" } }
```

### Demo account

`npm run seed` creates two verified users, 13 articles, a team and a
collection — reproducing the dataset the frontend used to hardcode:

```
Email:    alex@inkflow.ai
Password: demo1234
```

Run `npm run seed:destroy` to remove all of it. The seed is idempotent, so
running it twice will not create duplicates.

---

## Environment variables

Every variable is documented inline in [`.env.example`](.env.example). Only
three are required — the server refuses to boot without them, with a message
naming what is missing:

| Variable             | Required | Purpose                                          |
| -------------------- | -------- | ------------------------------------------------ |
| `MONGO_URI`          | ✅       | MongoDB connection string                        |
| `JWT_ACCESS_SECRET`  | ✅       | Signs access tokens (min 32 chars)               |
| `JWT_REFRESH_SECRET` | ✅       | Signs refresh tokens (min 32 chars, must differ) |
| `CLIENT_URL`         | –        | Frontend origin; trusted by CORS, used in emails |
| `PORT`               | –        | Defaults to `4000`                               |

Config is validated by Zod at startup in [`src/config/env.js`](src/config/env.js),
so a typo fails immediately rather than at the first request that needs it.

---

## Connecting the frontend

The frontend needs one variable:

```bash
# ArticApp/.env
VITE_API_URL=http://localhost:4000
```

No `/api/v1` suffix — the API client appends it.

Then run both:

```bash
# terminal 1
cd lumina-back-end && npm run dev      # http://localhost:4000

# terminal 2
cd ArticApp && npm run dev             # http://localhost:5173
```

`http://localhost:5173` is trusted by CORS out of the box. For any other
origin, add it to `CORS_ORIGINS`.

Auth tokens travel in **HTTP-only cookies**, so the browser sends them
automatically and no token is readable from JavaScript. This requires
`withCredentials: true` on the client, which the frontend's API client
already sets.

> **Cross-site deployments** (frontend on Vercel, API on Render) need
> `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`, both over HTTPS.
> Browsers reject `SameSite=None` without `Secure`.

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for the endpoint-by-endpoint
mapping to each frontend page.

---

## Scripts

| Script                 | Description                             |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Start with nodemon, reloading on change |
| `npm start`            | Start for production                    |
| `npm run seed`         | Populate the demo dataset (idempotent)  |
| `npm run seed:destroy` | Remove all seeded data                  |
| `npm test`             | Run the integration suite               |
| `npm run test:watch`   | Run the suite in watch mode             |

---

## Testing

```bash
npm test
```

104 integration tests run against a **real MongoDB** started in memory, so
indexes, validators and aggregations are genuinely exercised rather than
mocked. No local MongoDB install is needed — the harness downloads a `mongod`
binary on first run.

| Suite                        | Covers                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tests/auth.test.js`         | Registration, login, refresh rotation and reuse detection, email verification, password reset and change, sessions |
| `tests/articles.test.js`     | CRUD, ownership, visibility, XSS sanitisation, derived fields, archive/restore, notes                              |
| `tests/workspace.test.js`    | Collections, bookmarks, team, profile, settings, account deletion                                                  |
| `tests/analytics-ai.test.js` | View recording and de-duplication, traffic classification, AI generation, security headers, CORS                   |

---

## Documentation

| Document                                       | Contents                                         |
| ---------------------------------------------- | ------------------------------------------------ |
| [`docs/API.md`](docs/API.md)                   | Every endpoint, with request and response bodies |
| [`docs/DATABASE.md`](docs/DATABASE.md)         | Collections, fields, indexes and relationships   |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Folder structure and the request lifecycle       |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md)   | Frontend page → endpoint mapping                 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)     | Deploying to Render, Railway or a VPS            |

---

## Deployment

Briefly — the full guide is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md):

1. Set `NODE_ENV=production` and use strong, unique JWT secrets.
2. Point `MONGO_URI` at a managed database (Atlas) and allow-list the host.
3. Set `CLIENT_URL` to the deployed frontend, plus `COOKIE_SECURE=true` and
   `COOKIE_SAME_SITE=none` for a cross-site setup.
4. Run `npm start`. The server creates its indexes on boot.
5. Point health checks at `/api/v1/ready`, which returns 503 while the
   database is unreachable.

> **Uploads on ephemeral hosts.** Cover images and avatars are written to
> local disk, which does not survive a redeploy on Render's free tier or
> Heroku. Mount a persistent volume and set `UPLOAD_DIR` to it, or replace the
> storage engine in `src/middlewares/upload.middleware.js` with S3/Cloudinary.

---

## Troubleshooting

**`Invalid environment configuration`** — a required variable is missing or a
JWT secret is under 32 characters. The message names the exact field.

**`MongooseServerSelectionError`** — MongoDB is unreachable. Check `mongod` is
running locally, or that your IP is allow-listed in Atlas under Network Access.

**CORS error in the browser** — the frontend origin is not trusted. Add it to
`CORS_ORIGINS` (comma-separated) and restart.

**Signed out on every refresh** — the cookie is being dropped. Cross-site
setups need `COOKIE_SAME_SITE=none` **and** `COOKIE_SECURE=true` over HTTPS;
check the frontend sends `withCredentials: true`.

**No verification email** — expected without SMTP configured. The full message,
including the link, is written to the server console.

---

## License

ISC
