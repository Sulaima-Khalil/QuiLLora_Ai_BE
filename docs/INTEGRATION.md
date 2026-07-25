# Frontend integration

How the InkFlow AI frontend (`ArticApp`) talks to this API, and what changed
when it moved off `localStorage`.

---

## Setup

```bash
# ArticApp/.env
VITE_API_URL=http://localhost:4000
```

No `/api/v1` suffix — the client appends it.

```bash
cd lumina-back-end && npm run seed && npm run dev   # :4000
cd ArticApp && npm run dev                          # :5173
```

Sign in with the seeded demo account: `alex@inkflow.ai` / `demo1234`.

---

## What changed

The frontend previously made **zero** HTTP calls — `axios` was installed but
unused, and all eight features ran on `localStorage`. The store modules were
rewritten to call the API while keeping their exported names and call
signatures, so most components were untouched.

### New files

| File                         | Purpose                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| `src/utils/apiClient.js`     | axios instance, 401 refresh-and-retry, session flag          |
| `src/utils/discoverStore.js` | Public feed (replaces the hardcoded `DISCOVER_ARTICLES`)     |
| `src/utils/analyticsStore.js`| Analytics report (replaces the hardcoded arrays)             |
| `src/utils/aiStore.js`       | AI Writer generation (replaces the local template engine)    |

### Rewritten stores

| File                            | Notes                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| `src/utils/auth.js`             | Real endpoints; same exports, so Login/Register are unchanged |
| `src/utils/articlesStore.js`    | Cached snapshot + `subscribeArticles`; async mutations      |
| `src/utils/collectionsStore.js` | Cached snapshot; optimistic bookmark toggle                 |
| `src/utils/profileStore.js`     | Cached snapshot; profile *and* settings                     |
| `src/utils/teamStore.js`        | Cached snapshot                                             |
| `src/utils/metrics.js`          | Reads the real metrics the API attaches; hash removed       |

### The caching pattern

Components read stores synchronously during render
(`useState(getArticles)`), but HTTP is asynchronous. Each store therefore
keeps an in-memory snapshot, exposes a synchronous getter, and fires a change
event once the server responds:

```js
const [articles, setArticles] = useState(getArticles);   // [] on first render

useEffect(() => {
  const unsubscribe = subscribeArticles(setArticles);    // re-render on arrival
  refreshArticles();
  return unsubscribe;
}, []);
```

`Collections`, `Discover`, `Team` and `Home` already subscribed, so they
needed no change. Only `MyArticle` and `Archive` gained the effect above.

### Component changes

| Component            | Change                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `App.jsx`            | Restores the session on load; listens for session expiry           |
| `MyArticle`, `Archive` | Subscribe to the article store                                   |
| `Write`              | Loads `?edit=` from the API; `savePost` awaits the write           |
| `AIWriter`           | Generation, next-paragraph and insights call the API               |
| `Discover`, `DiscoveryCards` | Render the live public feed                              |
| `Collections`        | Resolves saved articles from the feed instead of the static array  |
| `Setting`            | Loads and saves settings; delete-account takes a password          |
| `ForgotPassword` → `VerifyResetCode` → `ResetPassword` | The 3-step recovery flow, backed by a real emailed code |
| `VerifyEmail`        | Consumes the `?token=` from the emailed link; resend calls the API |
| `Login`, `Register`  | OAuth buttons start the real flow, disabled when unconfigured      |
| `Analytics`          | Renders the real report                                            |

Unchanged: `ProtectedRoute`, `GuestRoute`, `Home`, `Team`, `Profile`,
`Dashboard` and the landing page — the store signatures they depend on were
preserved.

### Password recovery

Three steps, and the backend supports both ways in:

1. **`/forgot-password`** — posts the address; the server emails a 6-digit
   code *and* a one-click link.
2. **`/verify-reset-code`** — the code is checked without being consumed, so
   the user can advance to the password form and still use it there.
3. **`/reset-password`** — accepts the verified code (via router state) or the
   `?token=` from the link. Every session is revoked on success.

Because the code is only six digits, the server discards it after five wrong
guesses on top of the per-IP+email rate limit.

---

## Sessions

Tokens live in **HTTP-only cookies**, so JavaScript cannot read them — which
is what makes an XSS bug non-fatal for sessions. The client therefore keeps a
`inkflow_session` flag in `localStorage` purely so the route guards can answer
"is someone signed in?" synchronously. It is a hint, never a credential; the
server re-validates every request.

`apiClient` retries once through `POST /auth/refresh` on a 401, so an expired
access token is invisible to the UI. When the refresh itself fails it emits
`inkflow-session-expired`, and `App.jsx` clears the flag and redirects.

---

## Store → endpoint mapping

### auth.js

| Function                 | Endpoint                       |
| ------------------------ | ------------------------------ |
| `registerUser`           | `POST /auth/register`          |
| `loginUser`              | `POST /auth/login`             |
| `logoutUser`             | `POST /auth/logout`            |
| `restoreSession`         | `GET /auth/me`                 |
| `requestPasswordReset`   | `POST /auth/forgot-password`   |
| `verifyResetCode`        | `POST /auth/verify-reset-code` |
| `resetPassword`          | `POST /auth/reset-password`    |
| `verifyEmail`            | `POST /auth/verify-email`      |
| `resendVerification`     | `POST /auth/resend-verification` |
| `changePassword`         | `POST /auth/change-password`   |
| `listSessions`           | `GET /auth/sessions`           |
| `getAuthProviders`       | `GET /oauth/providers`         |
| `isAuthenticated`        | local flag, no request         |

### articlesStore.js

| Function             | Endpoint                          |
| -------------------- | --------------------------------- |
| `refreshArticles`    | `GET /articles?limit=100`         |
| `fetchArticleById`   | `GET /articles/:id`               |
| `createArticle`      | `POST /articles`                  |
| `updateArticle`      | `PUT /articles/:id`               |
| `setArticleStatus`   | `PATCH /articles/:id/status`      |
| `archiveArticle`     | `PATCH /articles/:id/archive`     |
| `restoreArticle`     | `PATCH /articles/:id/restore`     |
| `deleteArticle`      | `DELETE /articles/:id`            |
| `uploadCover`        | `PUT /articles/:id` (multipart)   |
| `addArticleNote`     | `POST /articles/:id/notes`        |
| `deleteArticleNote`  | `DELETE /articles/:id/notes/:noteId` |

### collectionsStore.js

| Function                   | Endpoint                                      |
| -------------------------- | --------------------------------------------- |
| `refreshCollections`       | `GET /collections/state`                      |
| `fetchSavedArticles`       | `GET /collections/bookmarks`                  |
| `toggleBookmark`           | `POST /collections/bookmarks`                 |
| `createCollection`         | `POST /collections`                           |
| `renameCollection`         | `PATCH /collections/:id`                      |
| `deleteCollection`         | `DELETE /collections/:id`                     |
| `addToCollection`          | `POST /collections/:id/articles`              |
| `removeFromCollection`     | `DELETE /collections/:id/articles/:articleId` |
| `fetchCollectionArticles`  | `GET /collections/:id`                        |

### profileStore.js

| Function             | Endpoint                       |
| -------------------- | ------------------------------ |
| `fetchProfile`       | `GET /users/me`                |
| `saveProfile`        | `PATCH /users/me`              |
| `uploadAvatar`       | `PATCH /users/me` (multipart)  |
| `fetchSettings`      | `GET /users/me/settings`       |
| `saveSettings`       | `PATCH /users/me/settings`     |
| `fetchPublicProfile` | `GET /users/:identifier`       |
| `deleteAccount`      | `DELETE /users/me`             |

### teamStore.js

| Function           | Endpoint                  |
| ------------------ | ------------------------- |
| `refreshTeam`      | `GET /team`               |
| `inviteMember`     | `POST /team`              |
| `updateMemberRole` | `PATCH /team/:id/role`    |
| `removeMember`     | `DELETE /team/:id`        |

### discoverStore.js / analyticsStore.js / aiStore.js

| Function                 | Endpoint                       |
| ------------------------ | ------------------------------ |
| `refreshDiscover`        | `GET /articles/discover`       |
| `refreshCategories`      | `GET /articles/categories`     |
| `recordArticleView`      | `POST /articles/:id/view`      |
| `fetchAnalytics`         | `GET /analytics?days=`         |
| `fetchDashboardSummary`  | `GET /analytics/summary`       |
| `generateArticle`        | `POST /ai/generate`            |
| `generateParagraph`      | `POST /ai/paragraph`           |
| `generateInsights`       | `POST /ai/insights`            |
| `fetchAiOptions`         | `GET /ai/options`              |

---

## Shape compatibility

The API serialises articles into the exact props the cards already render, so
no component had to change how it reads data:

| Frontend prop   | Source                                                    |
| --------------- | ---------------------------------------------------------- |
| `id`            | `_id`, stringified                                          |
| `description`   | Alias of `excerpt` (the card reads `description`)           |
| `author`        | The populated author's name                                 |
| `date`          | Pre-formatted `"Dec 4, 2025"`                               |
| `readingTime`   | Pre-formatted `"5 min read"`                                |
| `img`           | `coverImage`; the store fills a local asset when it is empty |
| `words`, `views`, `seo`, `readerType` | Real values, replacing the old hash-derived placeholders |

Team members carry `joined` pre-formatted as `"Jan 2024"`, matching the Team
page.

---

## Behaviour that is now real

| Previously                                   | Now                                                        |
| -------------------------------------------- | ---------------------------------------------------------- |
| Passwords compared in plain text in the browser | bcrypt hashes, never returned                            |
| Session was the string `local-<email>`       | Signed JWTs in HTTP-only cookies with rotation             |
| Views and SEO derived from a hash of the id  | Recorded read events and a transparent SEO rubric          |
| Analytics arrays hardcoded in the page       | Aggregations over real reads                               |
| AI drafting ran a template engine in the tab | `POST /ai/generate`, swappable for a hosted model          |
| Team invites were local objects              | Persisted memberships with an emailed invitation           |
| Data was per-browser                         | Shared across devices, per account                         |

---

## Verifying the connection

```bash
curl http://localhost:4000/api/v1/health
curl "http://localhost:4000/api/v1/articles/discover?limit=3"

curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alex@inkflow.ai","password":"demo1234"}'
```

If the browser reports a CORS failure, the frontend origin is not in
`CORS_ORIGINS`. If you are signed out on every reload, the cookie is being
dropped — see the cross-site note in the README.
