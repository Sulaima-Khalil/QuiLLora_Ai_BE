# Database

MongoDB with Mongoose. Six collections, each one required by a screen in the
frontend — profile and editorial settings are embedded on the user rather than
split into collections of their own, because they are always read together
with it and never queried independently.

```
User ──1:N──> Article ──1:N──> ArticleView
 │              ▲
 │              │ (referenced)
 ├──1:N──> Collection
 ├──1:N──> TeamMember      (workspaceOwner)
 ├──1:N──> RefreshToken
 └──N:M──> Article         (bookmarks[])
```

Indexes are created explicitly at boot via `syncIndexes()` rather than
implicitly on first use, which avoids the common production surprise of an
index build starting under load.

---

## `users`

The account, its public profile and its editorial preferences.

| Field                     | Type       | Notes                                                        |
| ------------------------- | ---------- | ------------------------------------------------------------ |
| `name`                    | String     | Required, 2–80 chars                                          |
| `username`                | String     | Optional, unique (sparse), lowercase, `[a-z0-9_.]`            |
| `email`                   | String     | Required, unique, lowercase                                   |
| `password`                | String     | bcrypt hash, `select: false`. Absent for OAuth-only accounts  |
| `role`                    | String     | Job title shown on the profile — not a permission             |
| `bio`, `country`, `avatar`| String     | Profile fields                                                |
| `isEmailVerified`         | Boolean    | Set by the verification flow                                  |
| `isActive`                | Boolean    | False deactivates sign-in and rejects existing tokens         |
| `newsletterOptIn`         | Boolean    | From the register form                                        |
| `lastLoginAt`             | Date       | Updated on each sign-in                                       |
| `authProvider`            | Enum       | `local` \| `google` \| `github`                               |
| `oauthAccounts[]`         | Subdocs    | `{ provider, providerAccountId, email, linkedAt }`            |
| `emailVerificationToken`  | String     | SHA-256 digest, `select: false`                               |
| `emailVerificationExpires`| Date       | `select: false`                                               |
| `passwordResetToken`      | String     | SHA-256 digest of the emailed link token, `select: false`     |
| `passwordResetCode`       | String     | SHA-256 digest of the 6-digit code, `select: false`           |
| `passwordResetCodeAttempts` | Number   | Wrong guesses; the code is burned at 5, `select: false`       |
| `passwordResetExpires`    | Date       | Shared expiry for both, `select: false`                       |
| `passwordChangedAt`       | Date       | Displayed in the security panel                               |
| `tokenVersion`            | Number     | Incremented on password change; embedded in each access token |
| `bookmarks[]`             | ObjectId[] | → `Article`                                                   |
| `settings`                | Subdoc     | `tone`, `creativeInference`, `autoCitations`, `twoFactor`, `editorialUpdates`, `analyticsReports` |

**Indexes:** `email` (unique) · `username` (unique, sparse) · `bookmarks` ·
`createdAt: -1`

**Virtuals:** `initials` (avatar label) · `hasPassword`

**Hooks:** a pre-save hook hashes `password` when modified, and on any change
after creation bumps `tokenVersion` and stamps `passwordChangedAt`.

### Why `tokenVersion` rather than comparing `passwordChangedAt`

JWT `iat` has one-second resolution. A token minted in the same second as a
password change would compare as "not older" and survive it. An integer
counter embedded in the token is exact, so a changed password invalidates
every prior access token with no race.

### Why the code and the link token are separate fields

One reset issues both. Storing them separately keeps the link at its full 256
bits of entropy — folding the two together would have meant either a weak
6-digit link or a code nobody could type. `passwordResetCodeAttempts` exists
because a million-value space is walkable: the code is discarded after five
wrong guesses rather than trusting rate limiting alone.

### Why token digests are stored, not tokens

Verification and reset tokens are stored as SHA-256 digests, so a database
leak yields nothing replayable. SHA-256 rather than bcrypt is correct here
because the input is already 256 bits of entropy — there is nothing to
brute-force, and a slow KDF would only add latency.

---

## `articles`

| Field                      | Type       | Notes                                                     |
| -------------------------- | ---------- | --------------------------------------------------------- |
| `title`                    | String     | Required, ≤ 200                                            |
| `slug`                     | String     | Derived from the title, unique per author                  |
| `content`                  | String     | Sanitised TipTap HTML                                      |
| `excerpt`                  | String     | Card description; auto-derived when not supplied           |
| `category`                 | String     | Free-form (see below)                                      |
| `tags[]`                   | String[]   | Max 20                                                     |
| `author`                   | ObjectId   | → `User`, required                                         |
| `authorName`               | String     | Denormalised byline; rewritten when the author renames     |
| `status`                   | Enum       | `Draft` \| `Published` \| `Archived`                       |
| `previousStatus`           | Enum       | Status to return to when un-archiving                      |
| `visibility`               | Enum       | `public` \| `unlisted` \| `private`                        |
| `allowComments`            | Boolean    |                                                            |
| `coverImage`               | String     | Upload path or URL                                         |
| `seoTitle`, `seoDescription` | String   | From the editor's SEO panel                                |
| `readTime`, `wordCount`    | Number     | Derived from `content` on save                             |
| `views`, `uniqueViews`     | Number     | Denormalised counters                                      |
| `bookmarkCount`            | Number     | Denormalised counter                                       |
| `publishedAt`, `archivedAt`| Date       | Stamped on the matching transition                         |
| `notes[]`                  | Subdocs    | Private author notes, `select: false`                      |
| `generatedByAI`            | Boolean    | Set by the AI Writer                                       |

**Indexes**

| Index                                          | Serves                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `{ author: 1, status: 1, createdAt: -1 }`      | Dashboard, My Articles, Archive              |
| `{ status: 1, visibility: 1, publishedAt: -1 }`| The Discover feed                            |
| `{ author: 1, slug: 1 }` unique sparse         | Per-author slug uniqueness                   |
| `{ category: 1 }`, `{ author: 1 }`, `{ status: 1 }` | Filters                                 |
| text on `title`, `excerpt`, `tags`             | Search (weights 10 / 1 / 4)                  |

Each compound index puts equality fields before the sort field, so MongoDB
can satisfy both the filter and the ordering from the index alone.

### Why `category` is not an enum

`pages/Write.jsx` derives the category from the author's first free-text tag.
A schema enum would reject legitimate input — and the frontend's own seed data
already used values (`UX Research`, `Ethics`, `Science`, `Internal`) outside
any fixed list. `SUGGESTED_CATEGORIES` in `src/constants` drives the UI chips
without constraining what can be stored.

### Denormalised counters

`views`, `uniqueViews` and `bookmarkCount` are kept on the document so list
endpoints need no aggregation. `ArticleView` remains the source of truth, and
a scheduled job reconciles any drift.

---

## `articleviews`

One row per read. Event rows rather than a bare counter are what make the
Analytics page's real features possible: the daily chart, the traffic-source
breakdown and unique-reader counts.

| Field             | Type     | Notes                                                    |
| ----------------- | -------- | -------------------------------------------------------- |
| `article`         | ObjectId | → `Article`                                               |
| `author`          | ObjectId | → `User`; denormalised so analytics needs no join         |
| `viewer`          | ObjectId | → `User`, null when anonymous                             |
| `visitorHash`     | String   | SHA-256 of the user id, or of IP + user agent             |
| `source`          | Enum     | `Direct` \| `Search` \| `Social` \| `Referral`            |
| `referrer`        | String   |                                                            |
| `day`             | String   | `YYYY-MM-DD` (UTC), pre-computed for grouping             |
| `durationSeconds` | Number   | Reported by the client when available                     |

**Indexes:** `{ article, visitorHash, day }` **unique** ·
`{ author, createdAt: -1 }` · `{ author, day }`

The unique index is what enforces "one unique view per visitor per article per
day" — the first read of the day inserts, every repeat raises a duplicate-key
error the service interprets as "not unique". Doing this in the database
rather than with a read-then-write in application code removes the race
entirely.

**Privacy:** the raw IP address is never stored. `visitorHash` is a one-way
digest, so unique-reader counts do not come at the cost of retaining personal
data.

---

## `collections`

Named reading lists. Plain bookmarks are *not* modelled here — they live on
`User.bookmarks`, because the frontend treats them as a single flat list.

| Field         | Type       | Notes                     |
| ------------- | ---------- | ------------------------- |
| `owner`       | ObjectId   | → `User`, required        |
| `name`        | String     | Required, ≤ 80            |
| `description` | String     | ≤ 300                     |
| `articles[]`  | ObjectId[] | → `Article`               |

**Indexes:** `{ owner: 1, name: 1 }` unique · `{ owner: 1 }`

The unique compound index rejects duplicate names at the database level rather
than through a racy pre-check.

---

## `teammembers`

| Field            | Type     | Notes                                              |
| ---------------- | -------- | -------------------------------------------------- |
| `workspaceOwner` | ObjectId | → `User`; the workspace this membership belongs to  |
| `user`           | ObjectId | → `User`, null while the invite is outstanding      |
| `name`, `email`  | String   | Required                                            |
| `role`           | Enum     | `Admin` \| `Editor` \| `Viewer`                     |
| `status`         | Enum     | `Invited` \| `Active`                               |
| `invitedBy`      | ObjectId | → `User`                                            |
| `joinedAt`       | Date     | Rendered as `"Jan 2024"`                            |

**Indexes:** `{ workspaceOwner: 1, email: 1 }` unique · `{ workspaceOwner: 1 }`

Every user owns exactly one workspace, keyed by their own id, so no separate
`Workspace` collection is needed. The owner holds no membership row and is
implicitly an Admin.

---

## `refreshtokens`

Server-side record of each issued refresh token. A stateless JWT cannot be
revoked before it expires; this collection is what makes revocation possible.

| Field                  | Type     | Notes                                       |
| ---------------------- | -------- | ------------------------------------------- |
| `user`                 | ObjectId | → `User`                                    |
| `tokenHash`            | String   | SHA-256 digest, unique                      |
| `expiresAt`            | Date     | TTL index                                   |
| `revokedAt`            | Date     | Null while active                           |
| `replacedByTokenHash`  | String   | Set on rotation, preserving the chain       |
| `userAgent`, `ipAddress` | String | Shown in the sessions list                  |

**Indexes:** `tokenHash` unique · `{ expiresAt: 1 }` TTL · `{ user, revokedAt }`

Each refresh token carries a random `jti`, so two sessions created for the
same user in the same second produce different tokens instead of colliding on
the unique `tokenHash`.

**Rotation and theft detection:** refreshing revokes the presented token and
issues a new one. If an already-revoked token is presented again, it has been
replayed — the service revokes every session for that user and returns
`REFRESH_TOKEN_REUSED`.

---

## Scheduled maintenance

Defined in `src/cron`, all idempotent and pinned to UTC.

| Job                       | Schedule       | Purpose                                                 |
| ------------------------- | -------------- | ------------------------------------------------------- |
| `cleanup-expired-tokens`  | hourly         | Removes expired tokens and ones revoked over 7 days ago |
| `sync-view-counts`        | every 6 hours  | Reconciles article counters against `ArticleView`       |
| `cleanup-orphaned-uploads`| daily 03:30    | Deletes upload files no document references             |

Set `ENABLE_CRON=false` on additional instances so each job runs exactly once
across the fleet.

---

## Seeding

```bash
npm run seed           # idempotent
npm run seed:destroy   # remove everything the seed created
```

Creates two verified users, 13 articles, 2 team members and 1 collection,
reproducing the dataset the frontend previously hardcoded so a fresh database
looks identical to the localStorage build.
