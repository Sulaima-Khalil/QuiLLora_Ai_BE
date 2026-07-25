# HR / Team Feature — Complete Reference

This document covers the **people-management (HR) feature** of the InkFlow AI
backend end to end: every file that participates, what each one holds, the data
model, the request flow, the rules enforced, and what is *not* implemented yet.

> **Naming note.** There is no module called `hr` in this codebase. The HR
> capability — managing the people in a workspace, their roles, and their
> invitation lifecycle — is implemented as the **Team** feature (`/api/v1/team`,
> the `teammembers` collection). Every "HR" reference below maps to that.
>
> This is *staff/people management*, not an HR suite. There is no payroll,
> attendance, leave, salary, department, designation, or performance-review
> functionality anywhere in the codebase.

---

## 1. Where everything lives — file map

Every file that participates in the HR/Team feature, in request order:

| Layer          | File                                                         | What it holds                                                                     |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Constants**  | [src/constants/index.js](../src/constants/index.js#L52-L67)   | `TEAM_ROLE`, `TEAM_ROLES`, `MEMBER_STATUS`, `MEMBER_STATUSES` — the vocabulary     |
| **Model**      | [src/models/TeamMember.model.js](../src/models/TeamMember.model.js) | Mongoose schema, indexes, the `initials` virtual                            |
| **Model index**| [src/models/index.js:4](../src/models/index.js#L4)            | Re-exports `TeamMember`                                                           |
| **Repository** | [src/repositories/team.repository.js](../src/repositories/team.repository.js) | All database queries — the only file that touches `TeamMember` directly |
| **Repo index** | [src/repositories/index.js:4](../src/repositories/index.js#L4) | Re-exports as `teamRepository`                                                   |
| **Service**    | [src/services/team.service.js](../src/services/team.service.js) | Business rules: invite, role change, removal, role resolution                    |
| **Service index**| [src/services/index.js:6](../src/services/index.js#L6)      | Re-exports as `teamService`                                                       |
| **Controller** | [src/controllers/team.controller.js](../src/controllers/team.controller.js) | HTTP layer — reads `req`, calls the service, shapes the response        |
| **Routes**     | [src/routes/v1/team.routes.js](../src/routes/v1/team.routes.js) | Path → middleware → controller wiring                                            |
| **Route mount**| [src/routes/v1/index.js:22](../src/routes/v1/index.js#L22)    | `router.use('/team', teamRoutes)`                                                 |
| **Validators** | [src/validators/team.validator.js](../src/validators/team.validator.js) | Zod schemas for invite / role update / id param                           |
| **Validator index**| [src/validators/index.js:6](../src/validators/index.js#L6) | Re-exports as `teamValidator`                                                    |
| **Serializer** | [src/utils/serializers.js:208-224](../src/utils/serializers.js#L208-L224) | `serializeTeamMember` — the exact JSON the frontend renders            |
| **Auth guard** | [src/middlewares/auth.middleware.js:86-97](../src/middlewares/auth.middleware.js#L86-L97) | `requireRole(...)` role gate (see §7 — currently unused) |
| **Rate limit** | [src/middlewares/rateLimit.middleware.js:48-56](../src/middlewares/rateLimit.middleware.js#L48-L56) | `emailLimiter` — 5 invites / hour                       |
| **Email send** | [src/emails/mailer.js:67-78](../src/emails/mailer.js#L67-L78)  | `sendTeamInviteEmail`                                                             |
| **Email body** | [src/emails/templates.js:131-146](../src/emails/templates.js#L131-L146) | `teamInviteTemplate` — subject, HTML, plain text                        |
| **Registration hook** | [src/services/auth.service.js:50-53](../src/services/auth.service.js#L50-L53) | Claims pending invites when the invitee registers          |
| **Membership lookup** | [src/services/auth.service.js:341-350](../src/services/auth.service.js#L341-L350) | `resolveMemberships` (see §7 — currently unused)      |
| **Cascade delete** | [src/services/user.service.js:157](../src/services/user.service.js#L157) | `teamRepository.deleteAllByWorkspace` on account deletion             |
| **Seed data**  | [src/database/seed.js:230-233](../src/database/seed.js#L230-L233), [:305-323](../src/database/seed.js#L305-L323) | The two demo members                     |
| **Tests**      | [tests/workspace.test.js:141-237](../tests/workspace.test.js#L141-L237) | 7 integration tests under `describe('Team')`                            |
| **API docs**   | [docs/API.md:428-455](API.md#L428)                            | Endpoint table                                                                    |
| **DB docs**    | [docs/DATABASE.md:190-207](DATABASE.md#L190)                  | Collection reference                                                              |
| **Frontend map**| [docs/INTEGRATION.md:185-192](INTEGRATION.md#L185)           | `teamStore.js` action → endpoint mapping                                          |

**Nothing else in the codebase touches the HR feature.** There is no separate
`hr/`, `employee/`, or `Workspace` directory or collection.

---

## 2. Core design decision — the workspace

**Every user owns exactly one workspace, identified by their own user id.**

There is no `Workspace` collection. `TeamMember.workspaceOwner` points straight
at the owning `User`. Consequences:

- The workspace owner holds **no `TeamMember` row of their own**. They are
  implicitly `Admin` ([team.service.js:92](../src/services/team.service.js#L92)).
- Every query is scoped by `workspaceOwner`, which gives tenant isolation for
  free — one user can never see or mutate another workspace's members.
- Deleting a user deletes their whole workspace's memberships
  ([user.service.js:157](../src/services/user.service.js#L157)).

---

## 3. Data model — `teammembers` collection

Defined in [src/models/TeamMember.model.js](../src/models/TeamMember.model.js).

| Field            | Type       | Rules                                                                      |
| ---------------- | ---------- | -------------------------------------------------------------------------- |
| `workspaceOwner` | ObjectId   | → `User`. **Required**, indexed. The workspace this membership belongs to.  |
| `user`           | ObjectId   | → `User`. `null` while the invite is outstanding; set once they register.    |
| `name`           | String     | **Required**, trimmed, max 80 chars.                                        |
| `email`          | String     | **Required**, lowercased, trimmed, regex-validated.                         |
| `role`           | Enum       | `Admin` \| `Editor` \| `Viewer`. Defaults to `Editor`.                      |
| `status`         | Enum       | `Invited` \| `Active`. Defaults to `Invited`.                               |
| `invitedBy`      | ObjectId   | → `User`. Who sent the invite.                                              |
| `joinedAt`       | Date       | Defaults to now. Drives the `"Jan 2024"` label on the Team page.             |
| `createdAt` / `updatedAt` | Date | Added by `timestamps: true`.                                             |

### Indexes

| Index                              | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `{ workspaceOwner: 1 }`            | Field-level `index: true` — list-by-workspace queries         |
| `{ workspaceOwner: 1, email: 1 }`  | **Unique** — one person can hold only one role per workspace   |

The unique compound index is the real duplicate guard; the service's
pre-check ([team.service.js:39-40](../src/services/team.service.js#L39-L40)) is
a friendlier 409 on top of it, not the source of truth.

### Virtual: `initials`

[TeamMember.model.js:58-64](../src/models/TeamMember.model.js#L58-L64) — derives
avatar initials from `name`: one word → first letter (`"Sarah"` → `S`), two or
more → first letters of the first two words (`"Sarah Chen"` → `SC`). Always
uppercase. Enabled in JSON output via `toJSON: { virtuals: true }`.

### Vocabulary — [src/constants/index.js:52-67](../src/constants/index.js#L52-L67)

```js
TEAM_ROLE     = { ADMIN: 'Admin', EDITOR: 'Editor', VIEWER: 'Viewer' }
TEAM_ROLES    = ['Admin', 'Editor', 'Viewer']
MEMBER_STATUS = { INVITED: 'Invited', ACTIVE: 'Active' }
MEMBER_STATUSES = ['Invited', 'Active']
```

All `Object.freeze`d. Values are capitalised strings, not lowercase slugs,
because the frontend's `teamStore.js` renders them directly.

---

## 4. API surface — `/api/v1/team`

All five routes sit behind `router.use(authenticate)`
([team.routes.js:14](../src/routes/v1/team.routes.js#L14)), so every one of them
requires a valid access token. The workspace is always **the caller's own**
(`req.user._id`) — there is no way to pass a workspace id.

| Method | Path              | Middleware                                        | Controller        |
| ------ | ----------------- | ------------------------------------------------- | ----------------- |
| GET    | `/team/roles`     | `authenticate`                                    | `listRoles`       |
| GET    | `/team`           | `authenticate`                                    | `listMembers`     |
| POST   | `/team`           | `authenticate`, `emailLimiter`, `validate(inviteMemberSchema)` | `inviteMember` |
| PATCH  | `/team/:id/role`  | `authenticate`, `validate(updateRoleSchema)`      | `updateMemberRole`|
| DELETE | `/team/:id`       | `authenticate`, `validate(memberIdSchema)`        | `removeMember`    |

`GET /team/roles` is declared **before** `GET /team` so `roles` is never
swallowed by a parameterised path.

### GET `/team` — list members

Returns every member of the caller's workspace, oldest first
(`sort({ createdAt: 1 })`), plus the role list so the frontend needs no second
request.

```json
{
  "success": true,
  "message": "Team members",
  "data": {
    "members": [
      {
        "id": "665f...",
        "name": "Sarah Chen",
        "email": "sarah.chen@inkflow.ai",
        "role": "Editor",
        "status": "Active",
        "initials": "SC",
        "joined": "Mar 2024",
        "joinedAt": "2024-03-08T09:00:00.000Z",
        "userId": null
      }
    ],
    "roles": ["Admin", "Editor", "Viewer"]
  }
}
```

### GET `/team/roles` — role list

```json
{ "success": true, "message": "Available roles", "data": { "roles": ["Admin", "Editor", "Viewer"] } }
```

### POST `/team` — invite a member → **201**

Request body — [team.validator.js:7-15](../src/validators/team.validator.js#L7-L15):

| Field   | Required | Rules                                                             |
| ------- | -------- | ----------------------------------------------------------------- |
| `email` | ✅       | Trimmed, lowercased, valid email, max 254 chars                    |
| `name`  | ❌       | Trimmed, max 80 chars. Derived from the email when omitted          |
| `role`  | ❌       | Must be one of `TEAM_ROLES`. Defaults to `Editor`                   |

```json
{ "email": "sarah.chen@inkflow.ai", "name": "Sarah Chen", "role": "Editor" }
```

Response: `201` with `{ "message": "Invitation sent to sarah.chen@inkflow.ai", "data": { "member": { … } } }`

### PATCH `/team/:id/role` — change a role

`:id` must be a 24-char hex ObjectId. Body: `{ "role": "Admin" }` — required and
enum-checked. Returns the updated member with
`message: "Role updated to Admin"`.

### DELETE `/team/:id` — remove a member

Hard delete, scoped to the caller's workspace. Returns
`{ "message": "Team member removed", "data": { "id": "665f..." } }`.

### Error responses

| Status | When                                                                  | Raised by |
| ------ | --------------------------------------------------------------------- | --------- |
| **401** | No/invalid/stale token, or the account no longer exists              | `authenticate` |
| **403** | Account deactivated (`isActive: false`)                              | `authenticate` |
| **400** | Empty email, or inviting **yourself** (the workspace owner)          | `team.service.js` |
| **409** | That email is already a member of this workspace                     | `team.service.js` |
| **404** | Member id not found **in the caller's workspace**                    | `team.service.js` |
| **422** | Zod validation failure — bad email, unknown role, malformed id       | `validate` middleware |
| **429** | More than 5 invites per hour for the same target email               | `emailLimiter` |

Note the split: an **unknown role sent to PATCH** is `422` (the Zod enum rejects
it before the service runs), whereas
[`updateMemberRole`'s own guard](../src/services/team.service.js#L70-L72) would
raise `400` — it is a defence-in-depth check for non-HTTP callers.

---

## 5. Request flow — invite, end to end

```
POST /api/v1/team  { email, name?, role? }
  │
  ├─ app.js            → helmet, cors, json, cookieParser, apiLimiter
  ├─ routes/v1/index   → /team → team.routes.js
  ├─ authenticate      → verify access token (cookie or Bearer), load User,
  │                      check isActive + token version → req.user
  ├─ emailLimiter      → max 5/hour, keyed on the target email (skipped in tests)
  ├─ validate          → Zod inviteMemberSchema → replaces req.body with parsed data
  ├─ team.controller   → teamService.inviteMember(req.user, req.body)
  │    │
  │    └─ team.service.inviteMember
  │         1. normalise email (trim + lowercase); 400 if empty
  │         2. name = stripTags(name) || email localpart with . and _ → spaces
  │         3. 400 if email === owner.email        ("you are the owner")
  │         4. 409 if teamRepository.findByEmailForWorkspace hits
  │         5. userRepository.findByEmail → does an account already exist?
  │         6. teamRepository.create({
  │              workspaceOwner: owner._id,
  │              user:   existingUser?._id ?? null,
  │              name:   existingUser?.name ?? derivedName,
  │              email, role: role ?? 'Editor',
  │              status: existingUser ? 'Active' : 'Invited',
  │              invitedBy: owner._id })
  │         7. mailer.sendTeamInviteEmail(...).catch(log)   ← non-blocking
  │         8. return serializeTeamMember(member)
  │
  └─ sendCreated → 201 { success, message, data: { member } }
```

Two details worth knowing:

- **Email failure never fails the invite.** The `.catch()` at
  [team.service.js:64](../src/services/team.service.js#L64) logs a warning and
  the request still returns 201. The membership row is the source of truth.
- **XSS is stripped at the service layer.** `stripTags(name)`
  ([sanitizeHtml.helper.js](../src/helpers/sanitizeHtml.helper.js)) runs before
  the name is persisted or put in the email HTML.

### Derived display name

When `name` is omitted, `email.split('@')[0].replace(/[._]/g, ' ')` is used —
so `marcus.thorne@inkflow.ai` becomes `"marcus thorne"`. It is deliberately
**not** title-cased; the test at
[workspace.test.js:167-176](../tests/workspace.test.js#L167-L176) pins the
lowercase result.

---

## 6. Membership lifecycle

```
                     invite sent
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
 email has NO account              email HAS an account
        │                                   │
   status: Invited                    status: Active
   user:   null                       user:   <userId>
        │                             name taken from that account
        │
        │  that person registers  →  auth.service.register
        │  teamRepository.claimInvitesForUser(userId, email, 'Active')
        ▼
   status: Active, user: <newUserId>, joinedAt: now
```

**Invite claiming** — [auth.service.js:50-53](../src/services/auth.service.js#L50-L53):
on every registration, `claimInvitesForUser` runs an `updateMany` over *all*
rows matching `{ email, user: null }` across **every** workspace, setting
`user`, `status: 'Active'`, and a fresh `joinedAt`. So one registration claims
invites from several workspaces at once. It is wrapped in `.catch(log)` —
a failure here never blocks registration.

**The invite email** — [templates.js:131-146](../src/emails/templates.js#L131-L146):

- Subject: `"{inviter} invited you to {workspace} on InkFlow AI"`
- Heading: `"You have been invited as {role}"`
- Workspace name is synthesised as `` `${owner.name}'s workspace` ``
  ([team.service.js:61](../src/services/team.service.js#L61)) — there is no
  stored workspace name.
- CTA links to `clientUrl('register', { email: to })` — the **registration**
  page with the address prefilled. There is **no invite token and no accept /
  decline endpoint**; the link is a convenience, not a credential.

**Removal** is a hard delete — no soft-delete, no `Removed` status, no audit
trail. `Invited` and `Active` are the only two statuses that exist.

---

## 7. Roles — what they mean today ⚠️

This is the most important gap to understand.

`Admin` / `Editor` / `Viewer` are currently **stored labels, not enforced
permissions.** Concretely:

- [`requireRole(...)`](../src/middlewares/auth.middleware.js#L86-L97) exists and
  is exported from [middlewares/index.js](../src/middlewares/index.js#L5), but
  **it is not applied to a single route** anywhere in `src/routes/`.
- `requireRole` reads `req.membership?.role`, and **nothing ever sets
  `req.membership`** — there is no middleware that populates it. So even if the
  guard were mounted, it would fall through to its
  `?? TEAM_ROLE.ADMIN` default and allow everyone.
- [`teamService.resolveRole`](../src/services/team.service.js#L91-L100) —
  resolves a caller's role inside a given workspace. **Exported, never called.**
- [`authService.resolveMemberships`](../src/services/auth.service.js#L341-L350) —
  lists the workspaces a user belongs to. **Exported, never called by any
  controller or route.**

Because every team route scopes on `req.user._id` as the workspace owner, a
member of *someone else's* workspace has no endpoint through which to act inside
it — their membership row grants them nothing yet. The only enforced
authorisation is **ownership**: you manage your own workspace, nobody else's.

The building blocks for real RBAC are in place (`resolveRole`,
`resolveMemberships`, `requireRole`, `req.membership`); the wiring — a
`loadMembership` middleware plus `requireRole` on the mutating routes — is not.
A `Viewer` today can invite and remove members exactly like an `Admin`, provided
they own the workspace.

---

## 8. Validation reference

[src/validators/team.validator.js](../src/validators/team.validator.js), built
on shared pieces from
[common.validator.js](../src/validators/common.validator.js):

| Schema               | Shape                                                        |
| -------------------- | ------------------------------------------------------------ |
| `inviteMemberSchema` | `body: { name?: string≤80, email: <shared email>, role?: enum }` |
| `updateRoleSchema`   | `params: { id: ObjectId }`, `body: { role: enum }` (required) |
| `memberIdSchema`     | `params: { id: ObjectId }`                                    |

Shared building blocks used:

- `email` — trimmed, lowercased, `.email()`, min 1, max 254
- `idParam` / `objectId` — `/^[a-f\d]{24}$/i`

The [`validate` middleware](../src/middlewares/validate.middleware.js) replaces
`req.body`/`req.params` with the **parsed** values, so the service receives
already-normalised input (lowercase email, trimmed name). Failures become
`422`.

---

## 9. Repository API

[src/repositories/team.repository.js](../src/repositories/team.repository.js) —
the only file issuing `TeamMember` queries. All email lookups run through the
local `normalizeEmail` helper.

| Function                                    | Query                                                              | Used by |
| ------------------------------------------- | ------------------------------------------------------------------ | ------- |
| `findAllByWorkspace(owner)`                 | `find({ workspaceOwner })` sorted `createdAt: 1`                   | `listMembers` |
| `findByIdForWorkspace(id, owner)`           | `findOne({ _id, workspaceOwner })`                                  | *(unused)* |
| `findByEmailForWorkspace(email, owner)`     | `findOne({ workspaceOwner, email })`                                | duplicate check on invite |
| `create(payload)`                           | `TeamMember.create`                                                 | `inviteMember` |
| `updateForWorkspace(id, owner, update)`     | `findOneAndUpdate` with `new: true, runValidators: true`             | `updateMemberRole` |
| `deleteForWorkspace(id, owner)`             | `findOneAndDelete({ _id, workspaceOwner })`                         | `removeMember` |
| `countByWorkspace(owner)`                   | `countDocuments`                                                    | *(unused)* |
| `deleteAllByWorkspace(owner)`               | `deleteMany({ workspaceOwner })`                                    | account deletion |
| `findMembershipsForUser(userId, email)`     | `find({ $or: [{ user }, { email }] })`                              | `resolveRole`, `resolveMemberships` |
| `claimInvitesForUser(userId, email, status)`| `updateMany({ email, user: null }, { user, status, joinedAt })`      | registration |

Every single-document mutation carries `workspaceOwner` in its **filter**, not
just in a post-fetch check — cross-tenant access is impossible by construction,
and a miss returns `null`, which the service converts to `404`.

---

## 10. Response shape — `serializeTeamMember`

[src/utils/serializers.js:208-224](../src/utils/serializers.js#L208-L224). Never
return a raw `TeamMember` document; always serialise.

| Output key | Source                                    | Note                                     |
| ---------- | ----------------------------------------- | ---------------------------------------- |
| `id`       | `_id`                                     | String, not `_id`                        |
| `name`     | `name`                                    |                                          |
| `email`    | `email`                                   |                                          |
| `role`     | `role`                                    |                                          |
| `status`   | `status`                                  |                                          |
| `initials` | virtual                                   | `""` when name is missing                |
| `joined`   | `formatMonthYear(joinedAt ?? createdAt)`  | Pre-formatted `"Mar 2024"` for direct rendering |
| `joinedAt` | `joinedAt ?? createdAt`                   | Raw ISO date, for sorting                |
| `userId`   | `user`                                    | `null` while the invite is pending       |

`invitedBy`, `workspaceOwner`, `updatedAt` and `__v` are deliberately **not**
exposed. `joined` is formatted server-side (via
[utils/date.js](../src/utils/date.js)) so the React Team page can render the
string with no date library.

---

## 11. Cross-cutting behaviour

**Rate limiting.** `POST /team` is the only team route with a dedicated limiter:
`emailLimiter` — **5 requests per hour**, keyed on the target email (falling
back to the IP when no email is present), because it triggers an outbound email.
The global `apiLimiter` covers all five routes. Both are skipped when
`NODE_ENV=test`.

**Account deletion cascade.**
[user.service.js:154-162](../src/services/user.service.js#L154-L162) calls
`teamRepository.deleteAllByWorkspace(user._id)` alongside articles, collections,
analytics and tokens. Note the asymmetry: deleting a user removes **the
workspace they own**, but their *memberships in other people's workspaces* are
left behind as orphaned rows with a dangling `user` reference.

**Seed data.** [src/database/seed.js:230-233](../src/database/seed.js#L230-L233)
defines two members mirroring the frontend's `DEFAULT_TEAM`, both created with
`status: Active` under the primary seeded owner:

| Name          | Email                        | Role   | joinedAt   |
| ------------- | ---------------------------- | ------ | ---------- |
| Marcus Thorne | marcus.thorne@inkflow.ai     | Admin  | 2024-01-15 |
| Sarah Chen    | sarah.chen@inkflow.ai        | Editor | 2024-03-08 |

The seed is idempotent — it skips a member whose
`{ workspaceOwner, email }` already exists. `npm run seed:destroy` removes them
via `deleteMany({ workspaceOwner: { $in: userIds } })`.

**No background jobs.** Nothing in [src/jobs/](../src/jobs/) or
[src/cron/](../src/cron/) touches team membership — no invite-expiry sweep, no
reminder emails.

---

## 12. Test coverage

[tests/workspace.test.js:141-237](../tests/workspace.test.js#L141-L237) —
`describe('Team')`, 7 integration tests against an in-memory MongoDB:

| Test                                                        | Asserts                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| starts empty and exposes the available roles                 | `members: []`, `roles: ['Admin','Editor','Viewer']`         |
| invites a member, defaulting to Editor with a formatted date  | `role: 'Editor'`, `initials: 'SC'`, `joined` matches `/^[A-Z][a-z]{2} \d{4}$/` |
| derives a name from the email when none is supplied          | `marcus.thorne@…` → `"marcus thorne"`                       |
| rejects inviting the same person twice                       | 201 then **409**                                            |
| rejects inviting yourself                                    | **400**                                                     |
| updates a role and removes a member                          | PATCH → `Admin`, DELETE → 200, list back to empty           |
| keeps each workspace's team separate                         | Owner's invite invisible to another user — tenant isolation  |
| rejects an unknown role                                      | `role: 'Owner'` → **422**                                   |

Run with `npm test`. **Not covered:** invite-claiming on registration, the
invite email contents, `emailLimiter`, `resolveRole` / `resolveMemberships`, and
the account-deletion cascade of memberships.

---

## 13. Frontend contract

[docs/INTEGRATION.md:185-192](INTEGRATION.md#L185) — `src/utils/teamStore.js`
maps one-to-one onto these endpoints:

| Store action       | Endpoint                |
| ------------------ | ----------------------- |
| `refreshTeam`      | `GET /team`             |
| `inviteMember`     | `POST /team`            |
| `updateMemberRole` | `PATCH /team/:id/role`  |
| `removeMember`     | `DELETE /team/:id`      |

`pages/Team.jsx` needs no changes: the serializer emits `id`, `initials` and the
pre-formatted `joined` string exactly as the old localStorage store did.

---

## 14. Known gaps

| # | Gap                                                                                              | Where |
| - | ------------------------------------------------------------------------------------------------ | ----- |
| 1 | **Roles are not enforced.** `requireRole` is mounted on no route and `req.membership` is never set | §7 |
| 2 | `resolveRole` and `resolveMemberships` are dead exports — nothing calls them                       | §7 |
| 3 | **No invite token / accept-or-decline flow.** The email links to the register page, nothing more   | §6 |
| 4 | **No cross-workspace endpoints.** A member of another workspace cannot act inside it              | §7 |
| 5 | Removing a member is a hard delete — no audit trail, no `Removed` status                          | §6 |
| 6 | Invites never expire — no cron sweeps stale `Invited` rows                                        | §11 |
| 7 | No re-send-invite endpoint                                                                        | §4 |
| 8 | Memberships in *other* workspaces are orphaned when a user deletes their account                  | §11 |
| 9 | No pagination on `GET /team` — the full list is always returned                                   | §4 |
| 10 | Editing a member's `name` or `email` is not possible; only `role` is mutable                     | §4 |
| 11 | No HR-suite concepts at all: payroll, attendance, leave, salary, department, designation, reviews | — |
