# SDD ledger — plan: docs/plans/2026-10-13-redesign-pencil.md
Pre-flight: Task3/4/5 consume Task2 components + Task3 sidebar; consistent.
Ruling: no git repo — progress tracked here, no commits — cost if wrong: none.
Ruling: pause for user review after Tasks 2-6 — spec section 7 requires it, overrides continuous execution — cost: extra turns.
Ruling: design lives in Pencil untitled doc (~/.pencil/documents/f4c62afd-.../untitled.pen); execute cannot create files at a new path — user saves as design/planfrojex.pen — cost: one manual Save As.
Ruling: lint CLIP check dropped — Get ctx.bounds reports wrong offsets for correctly rendered nodes; clipping verified via screenshots — cost: missed clip if screenshot too small.
Task 1: complete (Foundations F0ST7o; 13 colour tokens light+dark, font/radius vars; lint OK, screenshot verified)
Task 2: complete (Components Vztu5; lint OK; exported PNG reviewed; fixed avatar overlap + diff overflow). Ruling: no generic Table row component — columns differ per page, rows built per page — cost: less reuse. Ruling: sm buttons via height:28 override, not separate components — cost: none.
Ruling (user feedback): status dots + bordered pill replaced by Status/* glyph components; spec 5.1 + plan updated.
Task 3: complete (App sidebar VsKop component; Home AcVMH; Projects IU6CB; New project dialog KPujp; lint OK incl. no '·'; exports reviewed). Ruling: template 'AI Product' renamed 'ML product' — no 'AI' in UI labels rule — cost: rename back. Ruling: no '·' separators in new screens pending user answer — cost: re-add.
Ruling (user feedback): type scale bumped one step (ui 14, body 15, caption/mono 13, page title 20); task row 40, sidebar item 32; Projects nav icon -> folder-kanban. Spec + plan updated.
Task 4: complete (Project header FWS4G component; Brief zVyWv, Plan PuZFO, Tasks jbajX, Diagrams wfh13, Activity YGMNY; lint OK; '·' removed from Components too; exports reviewed). Ruling: diagram nodes drawn as layout frames + lucide arrows (no hand-drawn paths) — cost: less Excalidraw-like.
Task 5: complete (My tasks HFbCf, Inbox A5OOCs, Members ySGov, Invite dialog VrFWr, Settings BxhXC, Search fouSX, Sign in liVv8, Onboarding KJSud + Ce7zv, Share page wLbFa; lint OK; exports reviewed; share diagram clip fixed). Ruling: Kenji Sato shown as Viewer to cover viewer role — cost: none.
Ruling (user choice): logo = option J 'Live o' lowercase wordmark; Brand component IHCUC rebuilt, Logo mark component gFMU3 added; spec 5.6 updated.
Landing page cBSRj added (user request); onboarding previews added (user request); lint OK. Open: pricing copy 'Free for one person' / 'Per member, monthly' is placeholder pending user decision.
Landing rebuilt Raycast-style (user request): 'Landing page (dark)' AQ0Hp, dark theme tokens, gradients/glows/blur allowed on landing page only. Earlier light landings deleted by user. Testimonials replaced by role 'where to start' cards (no fabricated quotes).
Landing switched to light theme (user: dark didn't match). Frame AQ0Hp renamed 'Landing page'.
Landing hero background = 'Milestone ruler' (user chose option 3 of 3 meaningful options); beams removed; option frames deleted.
Competitive features designed: Settings/Integrations xUwQS, Plan drift nDDEh, Share approval rbIpM, Weekly email AfvS8; spec section 9 added.
Red list done: Sign up z5oLf8, Forgot password YFccp, Onboarding Just me/team J5WA2, Share dialog VgHUp, New task dialog KZG3Z, Tasks board FW6Kk, Account settings I5kXg, 404 ms0wi, No access MzuLT (Kenji/viewer), Mobile Projects p05gi / Brief NebpO / Share PSyOX, States XGY3p. Lint OK except allowed exception: white text/icons on third-party logo tiles in Integrations.
Task 6: complete (mobile + states). Remaining: final arrange + PNG export; backend spec next.
Final cleanup: canvas arranged into 8 labelled rows + archive; 42 PNGs exported to design/exports (ordered names). File still unsaved (untitled.pen) — user to Save As design/planfrojex.pen.
Decision (user): in-app Diagrams use React Flow (xyflow, MIT) + ELK.js instead of Excalidraw + Mermaid; stack board row added; spec page 9 updated.
Backend boards in Pencil: 1 Tech stack R9AjXm, 2 Costs us7u3, 3 System architecture GfPSF, 4 Data model kEpuM (26 tables), 5 API endpoints JMohA (89 endpoints), 6 Key flows pfNTv (4 swimlanes), 7 Permissions qVcF6. Next: written backend spec + plan; feature workflow skill pending 2 answers.
Rule added (user): diagram versions capped at last 50 + named; scenes >1MB stored in R2 (diagram_versions.label/storage/r2_key). Data model board + spec page 9 updated; cleanup job covers old versions.

## 2026-10-29: Rebuild setup
- Old repos and docs zipped to `../planforjex-backup-2026-10-29.zip`; folder emptied; docs and design exports restored.
- Monorepo: pnpm 12 + Turborepo, `apps/api` (Hono on Workers, Drizzle, Neon, Clerk) and `apps/web` (React 19, Vite 8, Tailwind 4 with design tokens). `pnpm check` passes.
- Team: lead + builder (Sonnet), reviewer (Opus), security (Opus), qa (Sonnet) in `.claude/agents/`.
- Skills: `/feature`, `/fix`, `/ship` in `.claude/skills/`. Ship's git step waits for the git setup.
- Worktrees: `pnpm wt <name>` → `../planforjex-worktrees/<name>` on `feat/<name>`, copies files in `.worktreeinclude`.

## 2026-10-29: Auth switched from Clerk to Better Auth
- Why: free at any size, users and workspaces in our own Postgres (no webhook sync), fits our designed screens.
- Passwordless (Google + 6-digit email code): password hashing doesn't fit the Workers free CPU limit, and there is no password to leak.
- Pencil: Sign in and Sign up lose the password field and SSO button; Forgot password became "Enter code". Boards updated (stack, costs, architecture, data model: sessions, accounts, verifications tables; API: `/api/auth/*`; permissions).
- Resend moves up: needed in feature 1 to send codes. Until then, dev prints the code in the API log.

## 2026-10-29: Feature 0 design system
- Dark tokens, `--shadow-float`, avatar and height tokens in `styles.css`; 17px `--text-dialog`; favicon from Logo mark.
- Primitives in `apps/web/src/ui/` (native `<dialog>`, `popover`, `<select>`); dev-only gallery `apps/web/design.html`.
- Tests: `src/design-rules.test.ts` (rule 7 guard, runs in `pnpm check`); Playwright `apps/web/e2e` via `pnpm --filter @planfrojex/web e2e`.

## 2026-11-05: Feature 1 auth and workspace
- Passwordless Better Auth (Google + 6-digit email code, hashed, DB rate limits); tables users, sessions, accounts, verifications, workspaces, memberships, invites, rate_limits (migration 0000, applied on Neon `production`).
- Endpoints: /me, POST /workspaces, GET /workspaces/:ws, POST /workspaces/:ws/invites, POST /invites/accept. Screens: sign in/up, enter code, onboarding (3), accept invite, no access (workspace version).
- Local dev: `wrangler dev --env dev` against Docker Postgres; `pnpm merge` runs integration tests against temporary Postgres locally.
- **D4, first deploy:** Decide the production web/API domain and apply migration `0001` (projects and stars) to Neon production before deploying the app. Use Neon HTTP for production migrations on networks that block port 5432.

## 2026-11-12: Feature 2 app shell and Home
- Workspace sidebar and keyboard-accessible switcher use existing memberships; Home shows empty task, project and activity states until those features are implemented.
- Existing workspace authorization and sign-out remain in use; no new database tables or migrations.

## 2026-11-13: Feature 3 Members — approved

- **Screens:** Members page and Invite people dialog, from exports `501-members.png` and `502-members-invite-dialog.png`. Enable Members in the existing workspace sidebar. Include loading, empty, error and confirmation states using the design system.
- **What people can do:** All workspace members can view the member list. Owners can invite people, view pending invites, change member roles, remove members, resend invitations and revoke invitations. Editors and viewers see the list without owner controls; pending invitations are owner-only, as on the API board.
- **Existing data:** Reuse `users`, `memberships` and `invites`; reuse the existing invite endpoint and acceptance flow. No new tables or migration are planned. Project counts and last-active information are not yet available: show an unavailable marker instead of sample or invented data.
- **Endpoints:** Add `GET /workspaces/:ws/members`, `PATCH` and `DELETE /workspaces/:ws/members/:userId`, `GET /workspaces/:ws/invites`, `POST /invites/:id/resend`, and `DELETE /invites/:id`. Keep the existing `POST /workspaces/:ws/invites`. Invitation-ID routes must resolve the invitation's workspace and check membership and owner permission server-side.
- **Recommended safeguards:** Owners may assign owner, editor or viewer; the last owner cannot be removed or demoted. Enforce this atomically, including concurrent changes. Removing someone removes only that workspace membership; access to their other workspaces stays intact. Resend generates a new random token, stores only its hash, renews expiry, and invalidates the old link; revoked, accepted or concurrently changed invites cannot be resent. Rate limits and delivery failures must be handled without leaving an unusable invitation.
- **Tests:** Write failing tests first for each endpoint, owner/editor/viewer permissions, another workspace receiving 404, last-owner and concurrent-change safeguards, invite token rotation/revocation/expiry and email failure. Add Playwright coverage for the Members page, inviting, role changes, removal, resend/revoke, permission-limited views, loading and errors. Run `pnpm check`, the browser suite, and compare with both exports; complete the reviewer/security pass before shipping.
- **Out of scope:** Project membership/counts, real last-active tracking, workspace settings, SSO, public sharing, deployment, and new dependencies.

## 2026-11-13: Feature 4 Projects — approved

- **Screens:** Projects list and New project dialog from exports `302-projects.png` and `303-new-project-dialog.png`, with applicable empty and error states from `704-states.png`. Enable Projects and starred projects in the workspace sidebar. Reuse existing UI primitives; add missing reusable primitives to the gallery.
- **List and views:** All workspace members can list projects, filter by status, lead and due date, sort by last update, and switch between the built-in All, Active, Led by me and Starred views shown in the design. Stars are personal and persist across sessions. Custom user-created saved views are not drawn and are out of scope.
- **Create:** Owners and editors can create a project with a name, editable brief, workspace-member lead, optional target date, and a blank or selected starter template. Viewers can browse and star but cannot create. The five named starter templates provide editable starting text; they do not create tasks or plans. New projects start in Draft. Validate that the lead belongs to the same workspace.
- **Data:** Add an additive migration for `projects` and personal `stars` as in the data-model board; generate a key from the name, unique per workspace, adding a number on collision. Use UUID v7 IDs. Store the brief as JSON `{ problem: text }`, and include `deleted_at`, `tags`, `created_at` and `updated_at`; exclude deleted projects from the list. Show the lead alone in Team and “No plan yet” in Progress. Apply and test migrations against local or temporary Postgres; never modify the production database as part of this feature.
- **Endpoints:** `GET` and `POST /workspaces/:ws/projects`, `GET /templates`, and `PUT` and `DELETE /projects/:id/star`, matching the API board. Templates are a fixed list in code, with no table. Reuse workspace membership and role checks; resolve the project's workspace on star operations and return 404 for projects in other workspaces. The list supports the displayed views, filters, ordering, cursor pagination and a count for each tab.
- **Navigation and later work:** Project details and editing belong to Feature 5; until that screen exists, project rows and sidebar stars must not lead to a broken page. Home's New project button opens the same creation dialog. No project deletion, project team management, task progress, custom saved views, deployment, or new dependencies.
- **Verification:** Test first for creation, validation, all three roles, cross-workspace 404s on each workspace-owned endpoint, per-user stars, filters, views, pagination and migration. Add browser coverage for creation, templates, filters and views, starring, permissions, loading, empty and error states, and keyboard interaction. Run `pnpm check` and the full Playwright suite, compare the screens with exports 302 and 303, and complete an independent correctness and security review before shipping through the repository workflow.

## 2026-11-13: Feature 5 Project › Brief — approved 2026-11-13 (with the three recommendations)

- **Screens:** `401-project-brief.png` with the project header `104-project-header-component.png`. Project rows (Projects list, Home, sidebar stars) open `/:ws/projects/:id`. Unknown or other-workspace project: the existing no-access/404 treatment.
- **Header:** breadcrumb, title, status, lead, due date, star (works). Plan, Tasks, Diagrams, Activity tabs and Share are visibly unavailable until their features; team avatars show the lead only; progress shows "No plan yet". No "⋯" menu yet (delete/restore isn't drawn).
- **Brief:** sections Problem, Goals (numbered), Constraints, Out of scope, plus tags. Owners and editors edit each section in place (click → textarea → Save/Cancel); viewers read only. Properties panel: status, lead, target date editable by owners/editors; Created "date by name".
- **Comments:** list + composer on the right; everyone in the workspace (viewers too, per the API board) can comment; `@` suggests workspace members and stores their ids in `mentions`. Authors can edit and delete their own comments. Notifications for mentions come with Inbox (feature 11).
- **Data (additive migration 0002):** `projects.created_by` (nullable, existing rows stay empty); `brief` JSON grows to `{ problem, goals[], constraints, outOfScope }` (old `{ problem }` rows read fine); new `comments` table (id, project_id, target `project` for now, author_id, body ≤ 5000 chars, mentions text[], created_at, updated_at).
- **Endpoints (API board):** `GET /projects/:id` (O/E/V), `PATCH /projects/:id` title, status, lead, target date, brief, tags (O/E); `GET /comments?target=project:<id>` and `POST /comments` (O/E/V); `PATCH` and `DELETE /comments/:id` (author only). Every one resolves the project's workspace from the caller's membership: other workspace → 404. Mentions must be members of that workspace. Comment posting rate-limited per person.
- **Tests first:** each endpoint's roles and cross-workspace 404; lead must be a member; brief/tags validation and size limits; author-only comment edit/delete; mentions restricted to members. Browser: open a project, edit a section, change status, star, post/edit/delete a comment with a mention, viewer read-only, loading/error states. Compare with 401 and 104.
- **Open questions:** (1) in-place editing per section as above (not drawn; recommended), (2) project URL uses the id (simplest; key-based URLs like `/northwind/projects/PORTAL` can come later), (3) mention notifications wait for feature 11.
- **Out of scope:** Plan, Tasks, Diagrams, Activity tabs, Share dialog, project team, delete/restore, mobile brief (702), drafting from the brief.

## 2026-11-13: Feature 6 Tasks — approved 2026-11-13 (with the three recommendations)
Screens: 404 list + side panel, 405 board, 406 New task dialog. Tasks tab and "x/y tasks" progress in the project header become live.
- **List (404):** grouped In progress / To do / Completed (Completed collapsed), row = checkbox (toggles done), PORT-36 key, title, priority bars, assignee avatar, due date. Filters: Assignee, Priority chips. Click row opens side panel.
- **Board (405):** three columns with counts and "+" (opens dialog with that status). Drag a card between/within columns (native HTML drag and drop, keyboard fallback via the panel's Status field). List/Board choice kept in the URL.
- **Side panel:** key, copy link, close; title, Status, Assignee, Priority, Due editable inline by owners/editors; description; comments on the task (reuses feature 5 comments, target `task:<id>`, @mentions). ⋯ menu: Delete task (owner/editor, confirm).
- **New task (406):** title, description, status, assignee, priority, due; "Create another" keeps the dialog open.
- **Permissions (board 1007):** owner/editor create, edit, assign, delete; viewer reads and comments.
- **Table `tasks`** (migration 0003, additive): id uuid v7, project_id, number (per project, shown KEY-n), title ≤200, description ≤10000, status todo|in_progress|done, priority low|medium|high (default medium), assignee_id nullable (workspace member), due_date, position int, created_by, timestamps. Unique (project_id, number); number assigned under a project row lock.
- **Endpoints (board 1005):** GET /projects/:id/tasks (status, assignee, priority filters) and GET /tasks/:id (O/E/V); POST /projects/:id/tasks, PATCH /tasks/:id (status, assignee, priority, due, title, description, position), DELETE /tasks/:id (O/E). Comments: GET/POST /comments accept `task:<id>`. Every endpoint: other-workspace member gets 404; viewer gets 403 on writes; assignee must be a workspace member.
- **Open questions:** (1) Milestone chip, filter and field wait for feature 7 (milestones table comes with Plan), recommend hiding them until then. (2) Board 1007 says owners may edit/delete any comment; feature 5 shipped author-only. Recommend fixing that here for both brief and task comments. (3) Delete task is a hard delete (board has no soft delete for tasks).
- **Out of scope:** milestones, My tasks page (10), assignment notifications (11), tracker sync (19), bulk actions on checked rows beyond toggling done.

## 2026-11-14: Feature 7 Project › Plan + drafts — approved 2026-11-14 (split 7a/7b, both deps approved for 7b, polling, undo as reverse decision)
Screen: 402 (Plan tab). Flow: board 1006 A. Tables/endpoints: boards 1004/1005. Recommend shipping in two PRs on separate branches.

**7a: Plan (no drafting), branch `feat/plan`**
- **Page:** "Last changed <date> by <name>", "On this page" outline. Sections: Requirements (R1…), User stories (S1…), Milestones (M1…, status planning|in-progress|completed, due date), Risks (R1…, severity, owner, decide-by), Tech stack (tags), Estimate (big number + note). Owners/editors edit in place (same pattern as the brief); viewers read.
- **Tasks link-up:** tasks get `milestone_id` (nullable, same project); the Milestone chip, filter and field hidden in feature 6 come back.
- **Tables (migration 0004, additive):** `plan_sections` (project_id, kind requirements|stories|stack|estimate, content jsonb, version int, updated_by), `milestones` (project_id, code, title, status, due_date, position), `risks` (project_id, code, title, severity low..critical, owner_id, decide_by), `tasks.milestone_id`.
- **Endpoints:** GET /projects/:id/plan (O/E/V); PATCH /projects/:id/plan/sections/:kind (O/E, `version` check so two editors can't overwrite each other: 409 on stale); POST /projects/:id/milestones, PATCH/DELETE /milestones/:id; same for risks (O/E). Cross-workspace 404 tests on all.

**7b: Drafts and decision log, branch `feat/plan-drafts`**
- **UI:** "Draft plan from brief" button (O/E), draft banner ("x of 6 sections reviewed. Nothing changes until you accept a section", Discard draft, Accept remaining), per-section diff card (− removed / + added lines, Accept / Reject), outline shows Accepted/Pending, toast with Undo after accept. Decision log readable by all roles.
- **Flow (rule 3):** POST /projects/:id/drafts saves a queued draft and returns 202; a job asks the model for the plan as JSON, validates it with Zod, compares with the current plan and saves `draft_changes`. Accepting runs one transaction: apply change, mark accepted, write `decisions` row.
- **Tables (migration 0005):** `drafts`, `draft_changes`, `decisions` as on board 1004. Endpoints as board 1005 (drafts, changes accept/reject, accept-all, delete, decisions). Limit 20 drafts/hour/workspace.

**Open questions**
1. Split into 7a and 7b as above? (recommended)
2. 7b needs two new dependencies: `@anthropic-ai/sdk` (claude-opus-5-5, structured output) and Trigger.dev for the job (board 1001). Approve both? Without keys (local dev, tests) a built-in fake drafter returns a fixed plan, so the app still runs (rule 9).
3. Progress updates: board says SSE stream; recommend simple polling of GET /drafts/:id every 2s first (SSE later if needed).
4. Undo after accept: recommend it writes a reverse decision rather than deleting history.
- **Out of scope:** Export, plan drift (403 → feature 20), diagram drafts (8), Share.

## Feature order (agreed 2026-10-29)
Each feature: plan → worktree → build → verify → review + security → ship. Empty, loading and error states ship inside each feature.

| # | Feature | Screens | Status |
|---|---|---|---|
| 0 | Design system | Foundations, Components | shipped |
| 1 | Auth and workspace | Sign in/up, Enter code, onboarding (3), No access | shipped 2026-11-05 |
| 2 | App shell and Home | Sidebar, workspace switcher, Home | shipped 2026-11-12 |
| 3 | Members | Members, Invite dialog | shipped 2026-11-13 |
| 4 | Projects list and New project | Projects, New project dialog, starring, saved views | shipped 2026-11-13 |
| 5 | Project › Brief | Brief, project header, comment column | shipped 2026-11-13 |
| 6 | Tasks | List, board, New task dialog, task side panel | shipped 2026-11-13 |
| 7 | Project › Plan + drafts | Plan, draft diff accept/reject, decision log | 7a shipped 2026-11-14, 7b next |
| 8 | Diagrams | React Flow + ELK canvas, versions, draft diagram | |
| 9 | Activity | Timeline, filters | |
| 10 | My tasks | My tasks | |
| 11 | Inbox | Mentions, assignments, replies | |
| 12 | ⌘K search | Search overlay | |
| 13 | Workspace settings | General, share links, danger zone | |
| 14 | Account settings | Account | |
| 15 | Share links + public share page | Share dialog, public page | |
| 16 | Mobile | Projects, Brief, Share page (390px) | |
| 17 | Landing page | Landing | |
| 18 | Stakeholder approval | Share page review banner | |
| 19 | Tracker sync | Settings › Integrations | |
| 20 | Drift detection | Plan drift card | |
| 21 | Weekly status email | Monday email | |
| 22 | 404 and states pass | 404, states audit | |
