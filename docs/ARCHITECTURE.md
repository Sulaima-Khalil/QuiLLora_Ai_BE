# Architecture

A layered Express application. Each layer has one job and depends only on the
layer beneath it, so a change to how data is stored never reaches a controller
and a change to HTTP shape never reaches a service.

```
route → middleware → controller → service → repository → model → MongoDB
                                     ↓
                              serializer → HTTP response
```

| Layer          | Responsibility                                              | Must not                      |
| -------------- | ----------------------------------------------------------- | ----------------------------- |
| **route**      | Bind a path to middleware and a controller                   | Contain logic                 |
| **middleware** | Auth, validation, sanitisation, rate limiting, uploads       | Know about business rules     |
| **controller** | Read the request, call one service, send the response        | Query the database            |
| **service**    | Business rules, permissions, orchestration                   | Touch `req` or `res`          |
| **repository** | Build and run queries                                        | Contain business rules        |
| **model**      | Schema, indexes, derived fields                              | Reach out to other services   |
| **serializer** | Map documents to the exact shape the frontend renders        | Fetch anything                |

The rule that keeps this honest: **services never see `req` or `res`.** They
take plain arguments and return plain data, which is why they are testable
without HTTP and reusable from the seed script and cron jobs.

---

## Folder structure

```
src/
├── app.js                 Express app: middleware chain and route mounting
├── server.js              Bootstrap: DB connect, indexes, cron, graceful shutdown
│
├── config/
│   ├── env.js             Zod-validated environment; throws at boot if invalid
│   ├── cors.js            Origin allow-list (credentials require it)
│   └── index.js
│
├── constants/
│   └── index.js           Statuses, roles, tones, cookies — the shared vocabulary
│
├── database/
│   ├── connect.js         Connection, index sync, graceful disconnect
│   └── seed.js            Demo dataset (npm run seed)
│
├── models/                Mongoose schemas, indexes and hooks
│   ├── User.model.js
│   ├── Article.model.js
│   ├── Collection.model.js
│   ├── TeamMember.model.js
│   ├── RefreshToken.model.js
│   ├── ArticleView.model.js
│   └── index.js
│
├── repositories/          Query construction; the only place Mongoose is called
│   ├── user.repository.js
│   ├── article.repository.js
│   ├── collection.repository.js
│   ├── team.repository.js
│   ├── token.repository.js
│   ├── analytics.repository.js
│   └── index.js
│
├── services/              Business rules
│   ├── auth.service.js        register, login, verify, reset, change password
│   ├── token.service.js       issue, rotate, revoke; cookie handling
│   ├── oauth.service.js       Google and GitHub authorization-code flow
│   ├── article.service.js     CRUD, ownership, visibility, archive/restore
│   ├── collection.service.js  bookmarks and reading lists
│   ├── team.service.js        workspace membership
│   ├── user.service.js        profile, settings, account deletion
│   ├── analytics.service.js   view recording and aggregation
│   ├── ai.service.js          AI Writer generation
│   └── index.js
│
├── controllers/           Thin HTTP adapters
│   ├── auth.controller.js
│   ├── oauth.controller.js
│   ├── article.controller.js
│   ├── collection.controller.js
│   ├── team.controller.js
│   ├── user.controller.js
│   ├── analytics.controller.js
│   ├── ai.controller.js
│   └── health.controller.js
│
├── routes/
│   ├── index.js           Version index
│   └── v1/                One router per resource
│
├── middlewares/
│   ├── auth.middleware.js      authenticate, optionalAuthenticate, requireRole
│   ├── validate.middleware.js  Zod validation for body/query/params
│   ├── sanitize.middleware.js  NoSQL injection guard
│   ├── rateLimit.middleware.js Global, auth, email and AI limiters
│   ├── upload.middleware.js    Multer storage, type and size limits
│   ├── error.middleware.js     Centralised error translation
│   └── index.js
│
├── validators/            Zod schemas, one module per resource
├── helpers/               password, crypto, HTML sanitisation
├── utils/                 ApiError, ApiResponse, asyncHandler, jwt, dates,
│                          pagination, slugify, readTime, serializers, logger
├── emails/                transporter, templates, mailer
├── jobs/                  Idempotent maintenance tasks
└── cron/                  Schedules for those tasks

tests/                     Integration suites against an in-memory MongoDB
docs/                      This documentation
uploads/                   Runtime upload target (git-ignored)
```

---

## Request lifecycle

A `POST /api/v1/articles` with a cover image:

1. **helmet** sets security headers; **cors** checks the origin against the
   allow-list.
2. **express.json / urlencoded** parse the body (2 MB cap).
3. **cookie-parser** exposes `req.cookies`.
4. **mongoSanitize** strips `$`-prefixed and dotted keys from body, query and
   params.
5. **apiLimiter** applies the global rate limit.
6. **authenticate** reads the access token from the cookie (or `Authorization`
   header), verifies it, loads the user and checks `isActive` and
   `tokenVersion`.
7. **multer** writes the upload to disk and fills `req.body` for the
   multipart fields.
8. **validate** parses body/query/params with Zod and replaces them with the
   coerced, allow-listed result.
9. **controller** calls `articleService.createArticle(...)`.
10. **service** sanitises the HTML, derives the slug, and delegates to the
    repository.
11. **repository** writes through the model, whose pre-save hook computes
    `wordCount`, `readTime` and the excerpt.
12. **serializer** maps the document to the frontend's shape and
    `sendCreated` wraps it in the standard envelope.
13. Any thrown error skips to **errorHandler**, which translates it and
    returns the standard error envelope.

---

## Cross-cutting decisions

### Errors

Everything funnels through `ApiError` and one handler. Zod failures, Mongoose
validation and cast errors, duplicate keys, and Multer limits are each
translated into the right status with a client-safe message. Unrecognised
errors are logged in full and reported as a bare 500 in production, so stack
traces and driver internals never leak.

### Validation

Every route that takes input declares a Zod schema. The middleware **replaces**
`req.body` and `req.params` with the parsed result, so controllers can never
accidentally read an unvalidated field. `req.query` is getter-only in
Express 5, so the parsed value is published as `req.validatedQuery`.

### Response shape

`sendSuccess`, `sendCreated` and `sendPaginated` guarantee that every 2xx body
looks the same. The client unwraps `data` without special-casing endpoints.

### Serializers

`utils/serializers.js` is the single place that knows what the frontend
expects — `id` not `_id`, `img` not `coverImage`, a pre-formatted `date`
string, a `"5 min read"` label. Keeping that mapping in one module is what let
the React components keep their existing props when the localStorage stores
were swapped for HTTP calls.

### Security

| Concern              | Measure                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| Password storage     | bcrypt, cost 12 by default                                                |
| Session transport    | HTTP-only cookies, so XSS cannot read a token                             |
| Token lifetime       | 15-minute access tokens, 30-day refresh tokens                            |
| Session revocation   | Server-side refresh records, plus `tokenVersion` on the user              |
| Token theft          | Rotation with reuse detection — a replayed token kills every session      |
| NoSQL injection      | `$`/dotted keys stripped before any query is built                        |
| XSS in content       | Allow-list HTML sanitisation of every article body                        |
| Prototype pollution  | `__proto__` / `constructor` / `prototype` keys stripped                   |
| Brute force          | Per-IP+email limiter on credential endpoints                             |
| Email abuse          | 5/hour limit on endpoints that send mail                                  |
| Account enumeration  | Identical responses for unknown and wrong-password sign-ins               |
| Upload abuse         | MIME allow-list, 5 MB cap, server-generated filenames                     |
| Header hardening     | helmet, `x-powered-by` disabled                                           |
| Path traversal       | Uploads resolved and checked against the upload root before deletion      |

### Graceful shutdown

On `SIGTERM`/`SIGINT` the server stops cron, closes the mail transport, drains
the HTTP server so in-flight requests finish, then disconnects MongoDB. A
10-second timer forces exit if a socket refuses to close.

---

## Extending it

**A new resource** — add model → repository → service → validator →
controller → route, then mount it in `routes/v1/index.js`.

**A real AI provider** — replace `compose()` in `services/ai.service.js`. It
is the only function that produces text; routes, validators and callers stay
unchanged.

**Object storage for uploads** — swap the multer storage engine in
`middlewares/upload.middleware.js`. `toPublicUrl` and `removeUpload` are the
only other places that touch file paths.

**A new OAuth provider** — add an entry to the `PROVIDERS` map in
`services/oauth.service.js` with its endpoints and a `normalize` function.
