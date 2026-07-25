# API Reference

Base URL: `{SERVER_URL}/api/v1` — e.g. `http://localhost:4000/api/v1`

---

## Conventions

### Response envelope

Every response uses the same shape, so the client never special-cases an
endpoint.

**Success**

```json
{ "success": true, "message": "Article created", "data": { "article": { } } }
```

**Paginated success** — the list is in `data`, cursor info in `meta`:

```json
{
  "success": true,
  "message": "Your articles",
  "data": [ ],
  "meta": {
    "page": 1, "limit": 12, "total": 34, "totalPages": 3,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

**Error**

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [{ "field": "body.password", "message": "Password must be at least 8 characters" }]
}
```

### Status codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 200  | Success                                                    |
| 201  | Created                                                    |
| 400  | Malformed request                                          |
| 401  | Missing, invalid or expired authentication                 |
| 403  | Authenticated but not permitted                            |
| 404  | Not found — also returned for resources you may not see    |
| 409  | Conflict (duplicate email, username, collection name)      |
| 413  | Upload or body too large                                   |
| 422  | Validation failed; see `errors[]`                          |
| 429  | Rate limited                                               |
| 500  | Server error                                               |

### Authentication

Sign-in sets two **HTTP-only** cookies, `inkflow_access_token` (15 min) and
`inkflow_refresh_token` (30 days). Browsers send them automatically when the
request uses `credentials: "include"`.

Non-browser clients may instead send the access token returned in the
response body:

```
Authorization: Bearer <accessToken>
```

When an access token expires, `POST /auth/refresh` issues a new pair and
revokes the old refresh token. Presenting an already-rotated refresh token is
treated as theft and revokes **every** session for that user.

### Rate limits

| Scope                                       | Limit                     |
| ------------------------------------------- | ------------------------- |
| All API routes                              | 300 / 15 min per IP       |
| `login`, `register`, `reset-password`       | 20 / 15 min per IP+email  |
| Endpoints that send email                   | 5 / hour per email        |
| `POST /ai/generate`, `POST /ai/paragraph`   | 20 / min per user         |

---

## Health

| Method | Path      | Auth | Description                                        |
| ------ | --------- | ---- | -------------------------------------------------- |
| GET    | `/health` | –    | Liveness. Always 200 while the process is running. |
| GET    | `/ready`  | –    | Readiness. 503 when MongoDB is unreachable.        |

---

## Authentication — `/auth`

| Method | Path                    | Auth | Description                                  |
| ------ | ----------------------- | ---- | -------------------------------------------- |
| GET    | `/auth/config`          | –    | Configured OAuth providers and client URL    |
| POST   | `/auth/register`        | –    | Create an account and start a session        |
| POST   | `/auth/login`           | –    | Sign in                                      |
| POST   | `/auth/logout`          | –    | Revoke the current refresh token             |
| POST   | `/auth/refresh`         | –    | Rotate the refresh token, issue a new pair   |
| POST   | `/auth/verify-email`    | –    | Confirm an address with the emailed token    |
| POST   | `/auth/resend-verification` | – | Re-send the verification email               |
| POST   | `/auth/forgot-password` | –    | Begin a password reset (emails a code + link) |
| POST   | `/auth/verify-reset-code` | –  | Validate the 6-digit code without consuming it |
| POST   | `/auth/reset-password`  | –    | Finish a password reset                      |
| GET    | `/auth/me`              | ✅   | The signed-in user                           |
| GET    | `/auth/sessions`        | ✅   | Active sessions, with the current one flagged |
| POST   | `/auth/logout-all`      | ✅   | Sign out of every device                     |
| POST   | `/auth/change-password` | ✅   | Change password; other sessions are revoked  |
| POST   | `/auth/set-password`    | ✅   | Set a first password on an OAuth-only account |

### POST /auth/register

```json
{
  "name": "Alex Rivera",
  "email": "<your-email>",
  "password": "<your-password>",
  "confirmPassword": "<your-password>",
  "username": "alexrivera",
  "country": "United States",
  "newsletter": true
}
```

`name`, `email` and `password` are required; the rest are optional.
`confirmPassword`, when present, must match.

**201**

```json
{
  "success": true,
  "message": "Account created. Check your inbox to verify your email address.",
  "data": {
    "user": {
      "id": "6721...", "name": "Alex Rivera", "email": "alex@inkflow.ai",
      "username": "alexrivera", "role": "Writer", "initials": "AR",
      "isEmailVerified": false, "settings": { "tone": "Academic", "creativeInference": true }
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresAt": "2026-08-24T00:00:00.000Z"
  }
}
```

Errors: `409` email or username taken · `422` validation failed.

### POST /auth/login

```json
{ "email": "<your-email>", "password": "<your-password>" }
```

**200** — same shape as register.
`401` returns an identical message for an unknown email and a wrong password,
so the endpoint cannot be used to discover which addresses are registered.

### POST /auth/refresh

Body is optional; the refresh token is read from its cookie when present.

```json
{ "refreshToken": "eyJ..." }
```

**200** issues a new pair. **401** codes: `REFRESH_TOKEN_UNKNOWN`,
`REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED` (all sessions were revoked).

### POST /auth/forgot-password

```json
{ "email": "<your-email>" }
```

**200** always, whether or not the account exists.

Sends **two** credentials in one email, so either recovery path works:

| Credential | Form                | Used by                              |
| ---------- | ------------------- | ------------------------------------ |
| Code       | 6 digits            | The 3-step "type the code" flow      |
| Token      | 64 hex characters   | The one-click `?token=` link         |

Both expire together (`PASSWORD_RESET_TOKEN_TTL_MINUTES`, default 60) and each
is single-use.

### POST /auth/verify-reset-code

Lets step 2 of the recovery flow advance to the password form without
consuming the code.

```json
{ "email": "<your-email>", "code": "<6-digit code>" }
```

**200** `{ "data": { "verified": true, "email": "<your-email>" } }`
**400** `RESET_CODE_INVALID` · **422** if the code is not exactly 6 digits.

A 6-digit space is small, so it is defended twice: the `authLimiter`
(20 attempts / 15 min per IP+email) and a counter that discards the code
after **five** wrong guesses. Both must be defeated to brute-force it.

### POST /auth/reset-password

Accepts either credential:

```json
{ "token": "<from the emailed link>", "password": "<new-password>" }
```

```json
{ "email": "<your-email>", "code": "<6-digit code>", "password": "<new-password>" }
```

**200** resets the password and revokes every session. **400** if the token or
code is invalid, expired or already used. **422** if neither credential is
supplied.

### POST /auth/change-password

```json
{ "currentPassword": "<current-password>", "newPassword": "<new-password>" }
```

**200** returns a fresh token pair, so the device that made the change stays
signed in while all others are revoked.

---

## OAuth — `/oauth`

Google and GitHub. Each stays disabled until its client id and secret are
configured; the routes then return **503** with code `OAUTH_NOT_CONFIGURED`.

| Method | Path                          | Auth | Description                                     |
| ------ | ----------------------------- | ---- | ----------------------------------------------- |
| GET    | `/oauth/providers`            | –    | Providers that are actually configured          |
| GET    | `/oauth/:provider`            | –    | Redirect the browser to the consent screen      |
| GET    | `/oauth/:provider/url`        | –    | Same, but returns the URL as JSON               |
| GET    | `/oauth/:provider/callback`   | –    | Provider redirect; sets cookies, returns to app |
| POST   | `/oauth/:provider/exchange`   | –    | Exchange a code for a session (popup/native)    |
| DELETE | `/oauth/:provider/unlink`     | ✅   | Unlink a provider                               |

`:provider` is `google` or `github`.

The flow is CSRF-protected with a `state` value stored in a short-lived cookie
and re-checked on callback. Accounts are linked by email only when the
provider asserts the address is verified; otherwise the request is rejected
with `409 OAUTH_EMAIL_UNVERIFIED`. Unlinking the last sign-in method is
refused with `LAST_AUTH_METHOD` unless a password is set first.

---

## Articles — `/articles`

| Method | Path                            | Auth     | Description                          |
| ------ | ------------------------------- | -------- | ------------------------------------ |
| GET    | `/articles/discover`            | optional | Public feed of published articles    |
| GET    | `/articles/categories`          | –        | Categories present in the public feed |
| GET    | `/articles`                     | ✅       | The caller's own articles             |
| POST   | `/articles`                     | ✅       | Create                                |
| GET    | `/articles/:id`                 | optional | Read one, subject to visibility       |
| PUT    | `/articles/:id`                 | ✅       | Update                                |
| PATCH  | `/articles/:id`                 | ✅       | Update (partial; same handler)        |
| PATCH  | `/articles/:id/status`          | ✅       | Set status explicitly                 |
| PATCH  | `/articles/:id/archive`         | ✅       | Archive, remembering the prior status |
| PATCH  | `/articles/:id/restore`         | ✅       | Restore to the prior status           |
| DELETE | `/articles/:id`                 | ✅       | Delete, clearing all references       |
| POST   | `/articles/:id/view`            | optional | Record a read                         |
| POST   | `/articles/:id/notes`           | ✅       | Add a private note                    |
| DELETE | `/articles/:id/notes/:noteId`   | ✅       | Delete a note                         |

### GET /articles

Query: `page`, `limit` (max 100), `sort`, `search`, `status`, `category`,
`tag`, `includeArchived`.

`sort` accepts `createdAt`, `updatedAt`, `publishedAt`, `views`, `title`,
`readTime`, each optionally prefixed with `-` for descending. Unknown values
fall back to `-createdAt`.

Returns drafts and private articles — this is the author's own view.

### POST /articles

```json
{
  "title": "The Future of Neural Prose",
  "content": "<h1>Intro</h1><p>Body…</p>",
  "status": "Draft",
  "category": "Technology",
  "tags": ["Architecture", "Technology"],
  "visibility": "public",
  "excerpt": "How AI-assisted editing tools are becoming collaborators.",
  "seoTitle": "",
  "allowComments": true,
  "generatedByAI": false
}
```

Only `title` is required. `status` is `Draft` | `Published` | `Archived`;
`visibility` is `public` | `unlisted` | `private`. When `category` is omitted
it falls back to the first tag, matching the Write page.

A cover image can be attached by sending `multipart/form-data` with a
`coverImage` file (JPEG, PNG, WebP, GIF or AVIF; max 5 MB).

**Server-derived fields** — supplying them has no effect:

| Field                       | Derived from                                |
| --------------------------- | ------------------------------------------- |
| `author`, `authorName`      | The session                                 |
| `slug`                      | The title, made unique per author           |
| `wordCount`, `readTime`     | The content                                 |
| `excerpt`                   | The content, when not supplied              |
| `publishedAt`               | First transition to `Published`             |
| `views`, `uniqueViews`      | Recorded read events                        |

`content` is sanitised against an allow-list matching what the TipTap editor
produces. `<script>`, event handlers such as `onerror`, and `javascript:` URLs
are stripped; headings, lists, blockquotes, links, images, tables and
text-align/font-size styles are preserved.

**201**

```json
{
  "success": true,
  "message": "Article created",
  "data": {
    "article": {
      "id": "6721...", "title": "The Future of Neural Prose",
      "description": "How AI-assisted editing tools…", "excerpt": "How AI-assisted…",
      "category": "Technology", "tags": ["Architecture", "Technology"],
      "author": "Alex Rivera", "authorId": "6720...",
      "date": "Dec 4, 2025", "readingTime": "6 min read", "readTime": 6,
      "status": "Draft", "visibility": "public",
      "img": "", "coverImage": "",
      "words": 1180, "views": 0, "seo": 82, "readerType": "Analysis",
      "content": "<h1>Intro</h1><p>Body…</p>"
    }
  }
}
```

`date` and `readingTime` are pre-formatted for direct rendering; `description`
is an alias of `excerpt` so the article card and the SEO panel both work.

### GET /articles/discover

Query: `page`, `limit`, `sort`, `search`, `category`, `tag`, `author`.

Only `Published` + `public` articles. When the caller is signed in, each item
carries `isBookmarked`.

### GET /articles/:id

Drafts and private articles are visible only to their author — everyone else
receives **404** rather than 403, so the endpoint does not confirm that a
hidden article exists. Unlisted articles are readable by anyone with the link.
`notes` are returned to the author only.

### POST /articles/:id/view

```json
{ "referrer": "https://news.ycombinator.com/", "durationSeconds": 145 }
```

Both fields optional. Separate from `GET` so that opening an article in the
editor, or prefetching it, does not inflate analytics.

Ignored for unpublished articles and for the author's own reads. A visitor
counts once per article per UTC day, enforced by a unique index. The referrer
is classified as `Direct`, `Search`, `Social` or `Referral`.

**200** `{ "data": { "recorded": true, "unique": true } }`

---

## Collections and bookmarks — `/collections`

All routes require authentication.

| Method | Path                                     | Description                             |
| ------ | ---------------------------------------- | --------------------------------------- |
| GET    | `/collections/state`                     | Bookmarks and collections in one call   |
| GET    | `/collections/bookmarks`                 | Saved articles, hydrated                |
| POST   | `/collections/bookmarks`                 | Toggle a bookmark                       |
| POST   | `/collections/bookmarks/:articleId`      | Toggle a bookmark (id in the path)      |
| GET    | `/collections`                           | List collections                        |
| POST   | `/collections`                           | Create a collection                     |
| GET    | `/collections/:id`                       | One collection, with its articles       |
| PATCH  | `/collections/:id`                       | Rename or re-describe                   |
| DELETE | `/collections/:id`                       | Delete                                  |
| POST   | `/collections/:id/articles`              | Add an article                          |
| DELETE | `/collections/:id/articles/:articleId`   | Remove an article                       |

### GET /collections/state

```json
{
  "success": true,
  "data": {
    "bookmarks": ["6721...", "6722..."],
    "collections": [
      { "id": "6730...", "name": "Design Inspiration", "articleIds": ["6721..."], "articleCount": 1 }
    ]
  }
}
```

Adding an article to a collection also bookmarks it; un-bookmarking removes it
from every collection. This keeps the invariant the UI relies on — everything
in a collection appears under Saved.

Collection names are unique per user; a duplicate returns **409**.

---

## Team — `/team`

All routes require authentication. Each user owns one workspace, identified by
their own id.

| Method | Path              | Description                              |
| ------ | ----------------- | ---------------------------------------- |
| GET    | `/team`           | Members, plus the available roles        |
| GET    | `/team/roles`     | `["Admin", "Editor", "Viewer"]`          |
| POST   | `/team`           | Invite a member (sends an email)         |
| PATCH  | `/team/:id/role`  | Change a member's role                   |
| DELETE | `/team/:id`       | Remove a member                          |

### POST /team

```json
{ "email": "sarah.chen@inkflow.ai", "name": "Sarah Chen", "role": "Editor" }
```

Only `email` is required; a display name is derived from the address when
omitted. Defaults to `Editor`. Inviting yourself returns **400**; inviting an
existing member returns **409**.

An invite for an address that already has an account becomes an active
membership immediately; otherwise it is claimed when that person registers.

Members are returned with `joined` pre-formatted as `"Jan 2024"`.

---

## Users, profile and settings — `/users`

| Method | Path                  | Auth     | Description                                |
| ------ | --------------------- | -------- | ------------------------------------------ |
| GET    | `/users/me`           | ✅       | The caller's profile                       |
| PATCH  | `/users/me`           | ✅       | Update the profile                         |
| DELETE | `/users/me`           | ✅       | Delete the account and everything it owns  |
| GET    | `/users/me/settings`  | ✅       | Editorial preferences                      |
| PATCH  | `/users/me/settings`  | ✅       | Update preferences (partial)               |
| GET    | `/users/:identifier`  | optional | Public author profile, by id or username   |

### PATCH /users/me

```json
{ "name": "Sulaima Khalil", "role": "Web Developer & Data Analyst", "bio": "", "country": "Pakistan" }
```

Send `multipart/form-data` with an `avatar` file to change the picture; the
previous one is deleted. Renaming updates the byline on every existing
article. A taken username returns **409**.

### PATCH /users/me/settings

```json
{ "tone": "Technical", "twoFactor": true }
```

Partial by design — untouched toggles keep their values. `tone` must be one of
`Academic`, `Minimalist`, `Persuasive`, `Technical`.

### GET /users/:identifier

Accepts a user id or a username. Visitors see published public articles and
aggregate stats; the owner additionally sees drafts and archived work. Email,
settings and account internals are never exposed to visitors.

### DELETE /users/me

```json
{ "password": "<your-password>" }
```

Required whenever the account has a password. Deletes the user together with
their articles, collections, team, analytics, sessions and uploaded files, and
clears the references from other users' bookmarks and collections.

---

## Analytics — `/analytics`

Both routes require authentication and are scoped to the caller's own work.

| Method | Path                  | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/analytics`          | Full report; `?days=` (1–365, default 7)     |
| GET    | `/analytics/summary`  | Compact totals for the dashboard stat cards  |

### GET /analytics

```json
{
  "success": true,
  "data": {
    "range": { "days": 7, "from": "2026-07-19T00:00:00.000Z", "to": "2026-07-25T…" },
    "summary": {
      "totalArticles": 13, "published": 7, "drafts": 5, "archived": 1,
      "totalViews": 482, "totalWords": 14320, "totalReadTime": 71, "bookmarks": 4,
      "periodViews": 96, "uniqueVisitors": 71, "engagementRate": 74,
      "viewsTrend": 12.4, "averageWordsPerArticle": 1101
    },
    "daily": [{ "day": "2026-07-19", "label": "Sun", "views": 12, "uniqueVisitors": 9 }],
    "trafficSources": [{ "label": "Search", "views": 41, "value": 43 }],
    "topArticles": [
      { "id": "6721…", "title": "…", "views": 48, "uniqueVisitors": 39,
        "engagement": 81, "averageDuration": 142, "publishedAt": "2025-10-24T…" }
    ],
    "categories": [{ "label": "AI", "count": 3, "views": 180 }]
  }
}
```

`daily` is always zero-filled to the full window, and `trafficSources` always
lists all four buckets, so the chart and legend never change shape.

---

## AI Writer — `/ai`

All routes require authentication.

| Method | Path            | Description                                   |
| ------ | --------------- | --------------------------------------------- |
| GET    | `/ai/options`   | Tone, length and category choices             |
| POST   | `/ai/generate`  | Draft an article from a topic                 |
| POST   | `/ai/paragraph` | One additional paragraph                      |
| POST   | `/ai/insights`  | Editorial feedback on the current draft       |

### POST /ai/generate

```json
{ "topic": "neural prose", "tone": "Technical", "length": "Long", "category": "AI", "variation": 0 }
```

`topic` is required (min 3 characters). `tone` is one of the four editorial
tones, `length` is `Short` | `Medium` | `Long`.

Generation is **deterministic**: the same input returns the same draft, which
keeps the endpoint cacheable. Increment `variation` to request a different
take on the same prompt.

**200**

```json
{
  "data": {
    "article": {
      "title": "Neural prose: A Technical Deep Dive",
      "content": "<p>…</p><blockquote><p>…</p></blockquote>",
      "excerpt": "…", "wordCount": 127, "readTime": 1, "readingEase": 62
    }
  }
}
```

> Drafting runs on a server-side template engine, so the feature works with no
> model provider, API key or per-request cost. To delegate to a hosted model,
> replace `compose()` in `src/services/ai.service.js` — it is the only
> function that produces text, and every route, validator and caller stays
> unchanged.

### POST /ai/insights

```json
{ "content": "<p>…</p>", "topic": "neural prose", "tone": "Academic", "category": "AI" }
```

Returns `rewrite`, `research`, `factcheck`, `outline`, `images`, `summary`,
`tone` and a `stats` object — each computed from the supplied draft, not
canned, so the numbers shown to the writer reflect their actual text.
