# Feature 1: Auth and Workspace

Status: **shipped** · Worktree: `feat/auth-workspace`

Someone signs up with Google or an email code, says "just me" or "with a team", gets a workspace, invites teammates, and invitees can join. After this feature every later table can hang off `workspace_id`.

## Approved decisions

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Workspaces, members and invites: Better Auth's organization plugin, or our own tables and routes | **Our own.** Better Auth handles only identity (users, sessions, accounts, codes). | Board API is our own `/workspaces/...` routes with owner/editor/viewer; the plugin's invite id is a bearer token stored in plain text (breaks rule 4); one query per permission check. Board text gets corrected. |
| D2 | Members page (screen + role change, remove, resend, revoke) | **Its own feature right after the app shell.** This feature builds only the invite endpoints onboarding needs. | Members lives inside the sidebar frame, which comes in feature 2. Slices stay small. |
| D3 | Missing on the boards: accepting an invite | Add `POST /invites/accept` and an `invites.token_hash` column. Drop `sessions.active_workspace_id` (the workspace comes from the URL). | Without it invites can't be used. |
| D4 | Cookies across web and API | Dev: both on `localhost` (cookies ignore ports). Production: needs one domain (`app.` + `api.`), decided at first deploy. | `*.pages.dev` and `*.workers.dev` are different sites; browsers block those cookies. |

## Screens (Pencil → `design/exports/`)

| Screen | Frame | Export |
|---|---|---|
| Sign in | `liVv8` | `201-sign-in.png` |
| Sign up | `z5oLf8` | `202-sign-up.png` |
| Check your email (code) | `YFccp` | `203-enter-code.png` |
| Just me or team (+ "Name your space") | `J5WA2` | `204-onboarding-just-me-or-team.png` |
| Create workspace (step 1 of 2) | `KJSud` | `205-onboarding-workspace.png` |
| Invite your team (step 2 of 2) | `Ce7zv` | `206-onboarding-invite.png` |
| No access (wrong workspace) | `MzuLT` | `506-no-access.png` |

Not designed, kept minimal: the code email and the invite email (plain layout in our tokens), and a placeholder workspace home (`/:ws`) showing the workspace name and Sign out until feature 2 replaces it.

## Flows
1. **Sign up / sign in:** email → 6-digit code (10 min, 3 attempts, stored hashed) → session. Or Google. A new person with no workspace goes to onboarding; anyone else goes to their last workspace.
2. **Just me:** name your space → personal workspace (`is_personal`, slug from the name) → `/:ws`.
3. **With a team:** workspace name + URL → invite emails with a role (or skip) → `/:ws`.
4. **Accept invite:** link `/invite/<token>` → sign in or sign up with the invited email → membership created, invite `accepted` → `/:ws`. Wrong email, expired, revoked or used: a clear message, no membership.

## Endpoints

| Method | Path | Body → response | Who |
|---|---|---|---|
| ALL | `/api/auth/*` | Better Auth: email code send/verify, Google, session, sign-out | Public |
| GET | `/me` | → `{ user, workspaces: [{ id, slug, name, role, isPersonal }] }` | Signed in |
| POST | `/workspaces` | `{ name, slug, isPersonal }` → workspace; caller becomes owner. 409 if slug taken. | Signed in |
| GET | `/workspaces/:ws` | → workspace + your role. 404 if not a member (never 403: don't reveal it exists). | O E V |
| POST | `/workspaces/:ws/invites` | `{ emails[≤20], role: editor\|viewer }` → created invites (token sent by email, never returned) | O |
| POST | `/invites/accept` | `{ token }` → `{ workspace }`. Signed-in email must match; not expired, revoked or used. | Signed in |

`:ws` is the workspace slug. Every workspace route runs `requireMember` then `requireRole`, from one permissions map.

## Tables (Drizzle, one migration)

| Table | Columns | Notes |
|---|---|---|
| `users` | id, email (unique), email_verified, name, avatar_url, timezone, timestamps | Better Auth `user` mapped to our names |
| `sessions` | id, user_id, token (unique), expires_at, ip_address, user_agent, timestamps | Better Auth |
| `accounts` | id, user_id, provider_id, account_id, tokens, timestamps | Better Auth (Google) |
| `verifications` | id, identifier, value (hashed code), expires_at | Better Auth email codes |
| `workspaces` | id uuid v7, name, slug (unique), is_personal, logo, timestamps | ours |
| `memberships` | workspace_id, user_id, role (owner\|editor\|viewer), timestamps; PK (workspace_id, user_id) | ours |
| `invites` | id uuid v7, workspace_id, email, role, token_hash (unique), invited_by, expires_at (+7 d), status (pending\|accepted\|revoked), timestamps; unique pending (workspace_id, email) | ours |
| `rate_limits` | Better Auth rate-limit storage | in Postgres, because Workers memory isn't shared between requests |

Additive only, nothing to backfill.

## Tasks (each test-first)
1. Test database: Testcontainers Postgres + migrations; a `testApp()` helper that signs a user in.
2. Schema + migration for the tables above.
3. Better Auth on Hono (Workers, Neon HTTP driver): email code plugin (6 digits, 10 min, 3 attempts, hashed), Google, cookies HttpOnly/Secure/SameSite=Lax, rate limits stored in Postgres, CORS with credentials for the web origin only.
4. Email sender: Resend in real use; in dev and test an outbox (codes and invite links printed to the API log; tests read the outbox in memory). No test-only HTTP route.
5. `requireSession`, `requireMember(ws)`, `requireRole` middleware + the permissions map (owner/editor/viewer rows from the Permissions board for this feature's actions).
6. `GET /me`, `POST /workspaces` (slug rules: lowercase letters, numbers, dashes, 3–40, reserved words blocked).
7. `GET /workspaces/:ws`.
8. `POST /workspaces/:ws/invites` (random 32-byte token, store SHA-256, email the link, dedupe pending invites).
9. `POST /invites/accept`.
10. Web: TanStack Router + Query, Better Auth React client, typed Hono client; routes `/sign-in`, `/sign-up`, `/verify`, `/onboarding`, `/onboarding/workspace`, `/onboarding/invite`, `/invite/$token`, `/$ws` (placeholder), not-found, no-access.
11. The seven screens from Pencil (shared components: Button, Input, Brand, field and error states).
12. Code and invite emails.

## Tests
- **API (Vitest + real Postgres):**
  - email code: right code, wrong code, expired, a 4th attempt, reuse
  - `/me`
  - create workspace: slug taken, bad slug
  - invites: owner only, editor and viewer get 403, more than 20, duplicates
  - accept: wrong email, expired, revoked, already used
- **Isolation:** for each `/workspaces/:ws` route, a member of workspace B gets **404** on workspace A.
- **Rate limits:** code send and verify return 429 past the limit.
- **Playwright:**
  - sign up with an email code, go "with a team", create a workspace, invite 2 people, land on `/:ws`
  - second user: open the invite link, sign up with the invited email, land in the same workspace
  - signed-out access to `/:ws` redirects to sign-in

## Out of scope
- Members page, role changes, remove, resend and revoke (D2)
- Workspace settings, rename, delete
- App shell and Home (feature 2)
- Account settings
- SSO
- Production deploy and domain (D4)
- Google sign-in in Playwright: tested by hand; automating Google's login page is brittle and against their terms
