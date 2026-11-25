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

## 2026-11-14: Feature 8 Diagrams — approved 2026-11-14 (with the four recommendations)
Screen: 407. Tables/API: boards 1004/1005 (diagrams, diagram_versions). Uses the installed @xyflow/react 12.12.0 and elkjs 0.12.1; no new dependencies.
- **Layout:** left list of diagrams (name, type, vN, "+" to create: name + type flowchart|architecture|sequence|entity relationship); canvas with toolbar Select, Pan, Rectangle, Diamond, Arrow, Text; "Saved hh:mm", zoom %, Save version; right panel "Draft a diagram" + Versions (vN, author, date, Current / Restore). Diagrams tab count goes live.
- **Canvas:** shapes are our own React Flow node components built from tokens (rectangle, diamond, cylinder, actor, entity table, text); edges with arrows; ELK auto-layout for drafts and a "Tidy up" action. Owners/editors edit; viewers get a read-only canvas (pan and zoom only).
- **Saving:** the working copy autosaves (debounced PUT /diagrams/:id with a version check, 409 on stale so two editors can't overwrite each other). "Save version" creates a named version. Restore creates a new version from an old one (history is never rewritten). Keep the last 50 unnamed versions plus all named ones; older unnamed ones are pruned on save.
- **Draft a diagram:** reuses the 7b draft pipeline (drafts kind `diagram`, draft_changes, decisions, fake drafter without keys, 20/hour limit). The model returns nodes and edges as JSON, validated by Zod and laid out with ELK. It opens as a preview with Accept (becomes a new version, decision logged) or Discard; nothing is saved to the diagram until accepted (rule 3).
- **Tables (migration 0006, additive):** `diagrams` (project_id, name, type, current_version, scene jsonb working copy, scene_version int, created_by, deleted_at), `diagram_versions` (diagram_id, version, scene jsonb, label nullable, created_by, created_at; unique (diagram_id, version)). Scene size capped at 1 MB.
- **Endpoints (board 1005):** GET/POST /projects/:id/diagrams; GET/PUT/DELETE /diagrams/:id; GET/POST /diagrams/:id/versions; POST /diagrams/:id/versions/:v/restore. Diagram drafts through POST /projects/:id/drafts with kind `diagram`. Reads O/E/V, writes O/E; other-workspace member gets 404 on all.

**Open questions**
1. Freehand pen tool (last toolbar icon): recommend leaving it out; it doesn't fit node/edge diagrams or ELK. Add later if wanted.
2. Large scenes in R2 (over 1 MB): recommend a 1 MB cap now and R2 later; no R2 setup needed yet.
3. Delete diagram: recommend soft delete (deleted_at), restore UI later.
4. Sequence diagrams: recommend drawing them with the same node/edge canvas (actors + arrows) rather than a separate sequence renderer.
- **Out of scope:** pen tool, R2 storage, export to PNG/SVG, comments on diagrams, real-time co-editing, Share.

## 2026-11-14: Feature 9 Activity — approved 2026-11-14 (with the three recommendations)
Screen: 408 (Activity tab). Table/API: boards 1004 (`activity`) and 1005 (GET /projects/:id/activity). No new dependencies.
- **Page:** filters "Everyone" (workspace members) and "All changes" (Comments, Tasks, Plan and drafts, Diagrams, Project details); timeline grouped Today / Yesterday / date, each row = avatar, name, sentence, time, and an optional detail line (comment quote, `v2 → v3`, status glyph → glyph, `Nov 28 → Dec 12`). Load more at the bottom (cursor). Everyone in the workspace can read it (O/E/V).
- **What gets recorded** (written in the same transaction as the change, so activity never lies): project status/lead/target date/name/brief section edits; task created, status/assignee/priority/due/milestone changed, deleted ("took PORT-36" when someone assigns themselves); comment added on brief or task; plan section, milestone and risk changes; draft started, section accepted/rejected, accept-all, undo; diagram created, version saved, restored, draft accepted, deleted.
- **Table (migration 0007, additive):** `activity` (id uuid v7, workspace_id, project_id, actor_id, type, subject (e.g. task id), payload jsonb with before/after, created_at). Index (project_id, created_at desc, id). Autosaves of a diagram's working copy are not recorded (only versions).
- **Endpoint:** GET /projects/:id/activity?actor=&category=&cursor=&limit≤100 (O/E/V); member of another workspace gets 404; actor filter must be a workspace member.
- **Header tab:** Activity tab becomes live.

**Open questions**
1. History before this ships is not backfilled; the timeline starts empty for existing projects (recommended; the decision log already covers plan history).
2. Comments: the row stores the comment id and shows the current text; a deleted comment's row shows "deleted a comment" with no quote, so deleted text never lingers (recommended).
3. Brief/plan text edits show only "edited the Problem section", not the full before/after text (recommended, keeps rows short and payloads small).
- **Out of scope:** Inbox and notifications (11, which will read this table), workspace-wide activity feed, realtime updates, export.

## 2026-11-15: Feature 10 My tasks — approved 2026-11-15 (with the three recommendations)
Screen: 305. API: board 1005 (GET /me/tasks). No new tables, no new dependencies.
- **Page `/:ws/my-tasks`:** tabs Assigned (open tasks assigned to me), Created by me (open tasks I created), Completed (done tasks assigned to me, newest first); each with a count. Group by Due date (Overdue in danger colour, Today, This week, Later, No due date) | Project | Priority. Project filter "All projects" or one project. Row = checkbox, task key (PORT-31), title, priority bars, due date (overdue in danger colour). Clicking a row opens the task's side panel in its project's Tasks tab.
- **Checkbox:** marks the task done / not done through the existing PATCH /tasks/:id (owners and editors only; disabled with a tooltip for viewers).
- **Sidebar:** the My tasks count (open tasks assigned to me in this workspace) becomes live; it updates after any task change.
- **Endpoint:** GET /me/tasks?ws=<slug>&view=assigned|created|completed&project=&cursor=&limit≤100. Only tasks in projects of that workspace (membership from the session, not deleted projects); returns counts for the three tabs. Member of another workspace gets 404; project filter must be a project in that workspace.
- **Dates:** grouping by Today / This week uses the browser's time zone, done on the client from the due dates (no server time-zone logic yet).
- **Index (migration 0008, additive):** tasks (assignee_id, status, due_date) and tasks (created_by, status) for the three tabs.

**Open questions**
1. Scope is the current workspace only, matching the sidebar (recommended), not all workspaces at once.
2. Completed tab shows the last 90 days with Load more (recommended).
3. Group by Project and Priority are in the dropdown on the screen; build all three (recommended).
- **Out of scope:** Inbox (11), editing other task fields from this page, drag to reorder, time-zone setting (14).

## 2026-11-15: Feature 11 Inbox — approved 2026-11-15 (with the three recommendations)
Screen: 306. Table/API: boards 1004 (`notifications`) and 1005 (GET /inbox, POST /inbox/:id/read, POST /inbox/read-all). No new dependencies.
- **Page `/:ws/inbox`:** left list, newest first: avatar, "<name> mentioned you" / "assigned you" / "replied to your comment" / "accepted your plan draft", time, context line (task key + title, or project + Brief/Plan section), and a one-line quote. Unread rows bold, read rows grey. "Mark all as read" top right; Load more.
- **Right panel:** breadcrumb (project, task key), title, task status and due (for task items), the comment thread with the triggering comment highlighted, a reply box ("Reply to <name>", posts a normal comment on the same brief or task, with @mentions), "Mark as read", and "Open task" / "Open brief" / "Open plan". Opening an item marks it read.
- **Sidebar:** Inbox unread count becomes live.
- **What creates a notification** (written in the same transaction as the change, through the feature 9 activity helper so they can't drift):
  - **mention:** a comment @mentions you (also when an edit adds you; never twice for the same comment).
  - **assigned:** someone else assigns a task to you (not when you take it yourself).
  - **reply:** someone comments on a brief or task where you commented before (skipped if that same comment already mentions you).
  - **draft decision:** someone else accepts or rejects a section of a draft you started.
  Never notify yourself. Members only: a person removed from the workspace stops seeing its items.
- **Table (migration 0009, additive):** `notifications` (id uuid v7, user_id, workspace_id, type mention|assigned|reply|draft_decision, activity_id → activity, read_at nullable, created_at). Unique (user_id, activity_id, type). Index (user_id, workspace_id, read_at, created_at desc).
- **Endpoints:** GET /inbox?ws=<slug>&cursor=&limit≤100 (returns items + unread count); POST /inbox/:id/read; POST /inbox/read-all?ws=. Only the owner of a notification can see or mark it (others get 404). A deleted comment's notification shows "deleted a comment" with no quote (same rule as Activity).

**Open questions**
1. "Reply" means a later comment in a thread you took part in, because comments have no reply-to field (recommended; no schema change to comments).
2. Inbox scope is the current workspace (recommended, same as My tasks).
3. Email and Slack notifications and notification settings wait for later features (recommended); in-app only now.
- **Out of scope:** email/Slack delivery, GET/PUT /me/notification-settings, drift notifications (20), push/realtime updates (the count refreshes on navigation and every 60 s).

## 2026-11-15: Feature 12 ⌘K search — approved 2026-11-15 (with the three recommendations)
Screen: 304. API: board 1005 (GET /workspaces/:ws/search?q=). Postgres full-text search (board 1001). No new dependencies.
- **Overlay:** opens with ⌘K / Ctrl+K or the sidebar Search box; input with "esc" hint; results in three groups: Projects (folder icon, name, status), Tasks (status glyph, key, title, project name), Commands (icon, label, shortcut). ↑/↓ move, ↵ opens, esc closes; footer shows those hints. Mouse hover and click work too. Empty query shows recent projects and the commands. "No results" state. Built as a new `ui/command-palette.tsx` primitive on the existing Dialog, added to the gallery.
- **Commands (client-side, filtered by the query):** Create project (C, owners/editors only), Go to Home (G H), Go to My tasks (G T), Go to Inbox (G I), Go to Projects (G P), Go to Members (G M). The single-key shortcuts also work outside the overlay, but never while typing in an input.
- **Search:** projects by name, key, brief text and tags; tasks by key ("BILL-12"), title and description. Prefix matching ("bill" finds "Billing"). Up to 5 projects and 8 tasks, best match first. Only the current workspace's non-deleted projects and their tasks.
- **Database (migration 0010, additive):** generated `search` tsvector columns on projects and tasks (simple config, so names and keys match as typed) with GIN indexes. No data copied; existing rows are indexed automatically.
- **Endpoint:** GET /workspaces/:ws/search?q= (1–100 chars, O/E/V); member of another workspace gets 404; query is passed as a parameter (no SQL building). Rate limit 60 requests/minute per person (board 1005 limits).

**Open questions**
1. Search results stay to projects and tasks (as drawn); comments, plan text and diagrams later (recommended).
2. Keyboard shortcuts outside the overlay (C, G T…) ship now since the screen shows them (recommended).
3. Results update as you type, waiting 150 ms after the last key (recommended).
- **Out of scope:** searching comments, plan, diagrams or people; search across workspaces; a full search results page.

## 2026-11-15: Feature 13 Workspace settings — approved 2026-11-15 (with the three recommendations)
Screen: 503. API: board 1005 (PATCH/DELETE /workspaces/:ws). No new dependencies, no migration.
- **Page:** /:ws/settings, sidebar "Settings" item (exists in the drawing, link it). Three blocks as drawn: General, Share links, Delete workspace. Owners edit; editors and viewers see General read-only and no Delete block.
- **General:** Workspace name (1–60, no links, same rules as onboarding) and Workspace URL (slug rules and reserved list reused from `workspaces/validation.ts`), hint "Changing the URL breaks links people have saved." Save changes is disabled until something changes. Taken slug: inline "That URL is taken". After a slug change the app moves to the new URL.
- **Share links:** the share links table arrives in feature 15. Now: the heading, description and an EmptyState "No share links yet". Feature 15 fills the table and Revoke.
- **Delete workspace:** confirm Dialog that asks the owner to type the workspace name; text shows the real project count. Hard delete in one statement (every workspace-owned table cascades). Personal workspace can't be deleted (button hidden, API 409). Afterwards go to the person's next workspace, or onboarding if none.
- **Endpoints:** PATCH /workspaces/:ws {name?, slug?} owner only (editor/viewer 403, other workspace 404, taken slug 409). DELETE /workspaces/:ws owner only, body {confirm: name} must match (400). No activity entries (activity belongs to projects, which are deleted too). Rate limit 10/min per person on both.

**Open questions**
1. Share links block shows an empty state now and is filled in feature 15 (recommended).
2. Delete is a hard delete with type-the-name confirmation, no undo window (recommended; matches "This can't be undone").
3. Old slugs don't redirect after a rename (recommended; the hint already warns).
- **Out of scope:** logo upload, transfer ownership, billing, Integrations tab (feature 19), deleting the personal workspace.

## 2026-11-15: Feature 14 Account settings — approved 2026-11-15 (with the three recommendations)
Screen: 505. API: board 1005 (GET/PATCH /me, GET/PUT /me/notification-settings, DELETE /me). No new dependencies.
- **Page:** /:ws/account, opened from the sidebar user menu ("..." next to the name). Tabs Profile / Notifications jump to their sections on the one page. One "Save changes" bar at the bottom for name, time zone and notification toggles, disabled until something changes.
- **Profile:** avatar with initials (or the Google photo), Full name (1–80), Email with Change, Time zone Select (browser list via `Intl.supportedValuesOf('timeZone')`, defaults to the browser's zone).
- **Change email:** Dialog asks for the new address, sends a 6-digit code to it through the existing email-code sender (dev: logged locally), and switches only after the code is entered. Code stored as a hash, 10 minutes, 5 tries; taken address shows "That email is already in use". Other sessions are signed out after the change.
- **Notifications:** five rows × Email / In app as drawn (mention, assigned, draft ready, drift, weekly summary). In-app toggles take effect now (inbox skips turned-off types); email toggles are saved for features 20–21. Defaults match the drawing.
- **Delete account:** confirm Dialog (type "delete"). Blocked with a list while you are the only owner of a workspace that has other members ("Make someone else owner first"). Otherwise: memberships and sessions removed, workspaces where you were the only member deleted, and your name shows as "Deleted user" on comments, activity and tasks. Signs you out to the sign-in page.
- **Database (migration 0011):** `notification_settings` (user_id, type, email, in_app; PK user+type). Change user FKs that block deletion: invites.invited_by → cascade; projects.lead_id → set null; activity.actor_id and comments.author_id → nullable, set null (comments kept, shown as "Deleted user"). Not applied to Neon.
- **Endpoints:** PATCH /me {name?, timezone?}; POST /me/email/start {email}, POST /me/email/verify {code}; GET/PUT /me/notification-settings; DELETE /me {confirm}. All act only on the session user. Rate limits: email start 3/hour, verify 5 tries per code, others 20/min.

**Open questions**
1. "Change photo" waits until file storage exists (feature 15+); now we show initials or the Google photo, and Remove clears it (recommended; no storage provider yet).
2. The Security tab isn't drawn; hide it until it is (recommended).
3. Deleting an account keeps your comments as "Deleted user" instead of deleting them (recommended; threads stay readable).
- **Out of scope:** photo upload, Security tab (sessions list, sign out everywhere), email delivery of notifications (20–21), data export.

## 2026-11-15: Feature 15 Share links + public page — approved 2026-11-15 (with the three recommendations)
Screens: 409 (Share dialog), 601 (public page), 503 (Settings › Share links table). API: board 1005. No new dependencies.
- **Share dialog (409):** project header "Share" button. "Public read-only link" toggle; when on: link field + Copy, "Include" checkboxes Brief / Plan / Diagrams / Tasks (default first three), "Opened N times, last …" line, "Turn off link" in the footer, Done. Owners and editors only; viewers don't see Share. The "Ask for approval" block and "Send for review" are feature 18 (hidden now).
- **Public page (601):** /share/:token, no sign-in, no app shell. Header: logo, workspace name, "Read-only link shared by <name>". Title, status, lead name, target date, updated date; then only the included sections: Brief, Milestones (+ estimate), Diagrams (read-only canvas, latest version of each non-deleted diagram), Tasks (key, title, status, no assignee emails). Footer "Made with planfrojex". `noindex` meta and `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`. Unknown, revoked or deleted-project link: plain "This link doesn't work anymore" page (same response for all three).
- **Settings › Share links (503):** fills the empty state from feature 13: Project, Created by, Created, Views, Revoke (owners only; editors see the list read-only).
- **Database (migration 0012):** `share_links` (id, workspace_id, project_id unique, token_hash unique, include text[], created_by → set null, view_count, last_viewed_at, created_at, revoked_at). Token: 32 random bytes, base64url, shown once in the dialog and kept only as a SHA-256 hash (rule 4). Turning a link off sets revoked_at; turning it on again makes a new token.
- **Endpoints:** GET/PUT/DELETE /workspaces/:ws/projects/:key/share (O/E; PUT {enabled, include} returns the token only when a new one is made); GET /workspaces/:ws/share-links (O/E/V list, revoke = DELETE above, owner from settings); public GET /share/:token returns only the included sections and never ids, emails or comments. Public endpoint: rate limit 60/min per IP, view count +1 per request.

**Open questions**
1. The link is shown in full only right after it's made (we store only the hash); later the dialog shows "Link is on" with Copy disabled and a "Make a new link" action (recommended; follows rule 4). Alternative: store the token encrypted so Copy always works.
2. Approval ("Ask for approval", "Send for review") waits for feature 18 (recommended).
3. Views count every page load, no unique-visitor tracking (recommended; no cookies or IP storage).
- **Out of scope:** approvals and reviewer emails (18), mobile layout (16), password-protected or expiring links, comments on the public page.

## 2026-11-15: Fix search shortcut flake — approved 2026-11-15
Screen: existing search overlay 304. Endpoints: none. Tables: none. Open questions: none.
- Keep the workspace shortcut listener attached across renders and ready before a navigated screen is visible. Preserve editable-field guards and all existing shortcuts.
- Verify the full Playwright suite three times consecutively, then run `pnpm check`.

## 2026-11-18: Feature 16 Mobile — approved (all 3 recommendations)
Screens: 701 (Projects), 702 (Project › Brief), 703 (Share page), all 390px. No API, no migration, no new dependencies.
- **Breakpoint:** below 768px (`md`) the sidebar is hidden and a bottom tab bar shows Home, My tasks, Inbox, Projects (active tab in accent, inbox count badge). Desktop is unchanged.
- **Projects (701):** header with workspace logo, "Projects", search icon (opens ⌘K overlay full screen) and + (New project, owners/editors). Saved-view tabs scroll sideways. Each project is a row: name, star, lead avatar; status glyph, progress bar, done/total, due date. "Draft · No plan yet" when there are no tasks.
- **Project › Brief (702):** back link "‹ Projects", share icon (opens Share dialog), "…" menu. Title, status, lead, due, progress bar. Tabs Brief / Plan / Tasks / Diagrams / Activity scroll sideways. The comment column becomes a bottom bar "N comments" + avatars that opens comments in a full-height sheet.
- **Share page (703):** public page from feature 15 in one column with smaller type and padding; diagram canvas fits the width and can be panned.
- **Everything else** (Home, My tasks, Inbox, Plan, Tasks, Diagrams, Activity, Members, Settings, Account): no sideways page scroll at 390px and every action reachable. Not redrawn, just usable. Dialogs become full-width sheets.
- **Tests:** Playwright "mobile" project at 390×844 running a new mobile spec (tab bar navigation, projects list, brief + comments sheet, share page, no horizontal overflow check on every main route).

**Open questions**
1. Breakpoint 768px (Tailwind `md`), tablets get desktop (recommended).
2. Pages without a drawing get the "usable, not redrawn" pass only (recommended; feature 22 polishes states).
3. Diagram editing on phones is view-only (pan/zoom); editing stays desktop (recommended).
- **Out of scope:** native app, offline, push notifications, swipe gestures.

## 2026-11-20: Feature 17 Landing page — approved (all 3 recommendations)
Screen: 801 (1440px). Spec section 5 landing exception. No API, no migration, no new dependencies. Sections drawn: nav, hero with Plan window and milestone-ruler background, "It's about the whole team agreeing on one", templates, "Draft the plan. Keep the decisions.", roles, "Don't plan twice", "What else", closing call to action, footer.
- **Route:** `/` shows the landing page to signed-out visitors. Signed-in visitors still go straight to their workspace (`enterApp` today). "Sign in" goes to `/sign-in`, "Start planning free" and "Get started" to `/sign-up`.
- **Product window:** built from `src/ui/` components with fixed sample data (a Plan view), not a screenshot. Floating callouts are hidden below `md`.
- **Look exception:** the milestone ruler and the soft accent glow are allowed on the landing only. They use token colours (`color-mix` on `--color-accent`), no raw hex. `design-rules.test.ts` gets a test-first exemption for gradient/shadow in `src/landing/` only; every other rule (hex, emoji, "AI", radius, purple) still applies there.
- **Mobile:** no 390px design exists; sections stack to one column, nav collapses to logo + Sign in + Get started. Overflow check added to the mobile spec.
- **Page head:** title and meta description in `index.html`.
- **Tests:** Playwright for signed-out `/` (all sections, CTAs go to sign-up/sign-in, templates tabs filter), signed-in `/` still redirects, 1440 and 390 no horizontal overflow; unit test for the design-rules exemption.

**Content fixes versus the drawing (the page may only claim what exists)**
- No Pricing, Changelog, Careers, Press kit, Help center, API or Status pages exist and the spec rules out marketing pages beyond this one. Nav keeps in-page anchors (Product, Templates, Teams) plus Sign in and Get started; footer keeps logo, one-line description and Sign in.
- Newsletter "Subscribe" box dropped (no endpoint).
- Cards for features that have not shipped are dropped: "Export" (Markdown/PDF), "Redraft one section", the "New: Redraft a single section" pill, and anything about tracker sync. They return with their features.
- "Free for one person. Bring the team in when the plan is ready." stays as copy, with no prices and no pricing page (still a placeholder pending your decision).
- Templates grid uses the real list from the New project dialog; the drawing's eight cards are cut to the templates that exist.

**Open questions**
1. Signed-in visitors on `/` go to the app (recommended) or see the landing.
2. Nav and footer: only working links, as above (recommended) or keep the drawn labels as dead links.
3. Drop the unshipped feature cards (recommended) or keep them as drawn.
- **Out of scope:** pricing page, blog, docs, analytics, newsletter, SEO beyond title and description.

## 2026-11-20: Feature 18 Stakeholder approval — approved (all recommendations)
Screens: 602 (share page with review banner), 409 (Share dialog, "Ask for approval" block and "Send for review", hidden since feature 15). Builds on feature 15 public page. Next migration number.
- **Flow:** owner/editor asks outside reviewers (emails, optional due date) to approve. Each reviewer gets an email link, confirms their email, then sees the share page with the banner "X asked you to review this plan by <date>". They approve sections (Brief, Milestones, each diagram) or the whole plan, or request changes with a comment. "Your review" bar shows "1 of 3 sections approved".
- **Tables:** `review_requests` (project, due date, created by, cancelled), `reviewers` (request, email, token hash, verified at), `review_approvals` (reviewer, section, approved or changes requested, comment). Tokens and email codes stored only as hashes.
- **Endpoints (board):** `POST` and `GET /projects/:id/review-requests`, `DELETE /review-requests/:id`; public `POST /public/share/:token/verify-email`, `GET .../review`, `POST .../approvals`. Owners/editors create and cancel, viewers read, reviewers only act on their own review. Another workspace gets 404.
- **Effects:** an approval or change request writes an activity and decision-log entry and an inbox item for the project lead. Share dialog shows reviewers and their progress. Emails go through existing `email.ts` (dev prints to the outbox).
- **Tests:** API tests per endpoint, role and cross-workspace 404, token hash, expiry, one reviewer cannot read another's review, rate limits; Playwright for the reviewer flow and the dialog.
- **Open questions:** 1. Reviewer link expires after 14 days or the due date, whichever is later (recommended). 2. Section list is Brief, Milestones and each diagram, other plan sections are not separately approvable (recommended). 3. A change request does not block later approval; the lead sees it in Inbox (recommended).
- **Out of scope:** reviewer accounts, reminders, e-signatures.

## 2026-11-20: Feature 19 Tracker sync (Linear) — approved (all recommendations)
Screen: 504 (Settings › Integrations). Next migration number. Needs feature 13 settings tabs.
- **Scope:** Linear only. GitHub, Jira and Slack cards stay as "Coming soon" with no Connect button, because the page may only offer what works. They return with their own features.
- **Behaviour:** owner connects Linear (OAuth, per the API board). Options: push accepted milestones as Linear projects/issues with the same owner and due date, pull issue status back into tasks, optionally import new issues as tasks outside the plan. Status mapping (Planning, In progress, Completed, Archived) to Linear states. "Sync now", "Disconnect", "Synced N min ago".
- **Tables:** `integrations` (workspace, provider, encrypted access token, status mapping, options, last synced), `external_links` (task or milestone to Linear id). Access token is encrypted with a key from env (it must be reusable, so not hashed); never logged.
- **Endpoints (board):** `GET /workspaces/:ws/integrations`, `POST .../:provider/connect`, `GET /integrations/:provider/callback`, `PATCH /integrations/:id`, `POST /integrations/:id/sync`, `DELETE /integrations/:id`, signed `POST /webhooks/linear` (signature checked, replay-safe). Owner only. Another workspace 404.
- **Local and tests:** the app must run without third-party keys, so a fake Linear provider is used in dev and tests, and production shows "Linear is not set up" when keys are missing.
- **Tests:** API tests incl. webhook signature, status mapping, two-way sync idempotency, disconnect removes the token; Playwright for connect (fake), options, sync, disconnect.
- **Open questions:** 1. Linear only now (recommended). 2. OAuth as drawn on the board, with a fake provider locally (recommended) or a pasted API key. 3. Sync runs on webhook plus manual "Sync now", with a daily catch-up job (recommended).
- **Out of scope:** GitHub, Jira, Slack, two-way comment sync.

## 2026-11-20: Feature 20 Drift detection — approved (all recommendations)
Screen: 403 (Plan with "The plan has drifted" card). Depends on 19. Next migration number.
- **Checks (rules, no model):** a milestone behind (done vs total tasks against its due date), tasks added in Linear outside the plan, a risk decision past its date. Works from PlanFrojex tasks alone; tracker facts are added when Linear is connected.
- **Suggested update:** a diff (milestone date moved, tasks added to a milestone, risk severity raised). It is stored as `draft_changes` and never writes directly. "Accept update" runs in one transaction that also writes the decision log, with the optional "Why?" reason. "Review each" accepts or rejects change by change. "Dismiss" hides it until something new drifts.
- **Tables:** `drift_reports` (project, found items, status open/accepted/dismissed, checked at). Reuse `draft_changes` and the decision log.
- **Endpoints (board):** `GET /projects/:id/drift`, `POST /projects/:id/drift/check`. Owners/editors check and accept, viewers see the card read-only.
- **When it runs:** after each tracker sync, on "check now", and in the daily job.
- **Tests:** unit tests per rule, API tests incl. transaction + decision log, viewer read-only, cross-workspace 404; Playwright for the card states.
- **Open questions:** 1. Rule-based, no model (recommended). 2. Milestone counts as late only when behind by 2 or more days (recommended). 3. Dismissed drift returns only when the findings change (recommended).
- **Out of scope:** Slack drift alerts, predicting delays.

## 2026-11-20: Feature 21 Weekly status email — approved (all recommendations)
Screen: 603. Depends on 19 and 20. Next migration number.
- **Content (from data, no model):** status On track / At risk / Off track from drift, one-paragraph summary from the drift items, milestone progress bars with moved dates ("was Nov 21"), decisions this week from the decision log, next week from due tasks and open risks, "Open the plan" button, footer with Unsubscribe.
- **Recipients:** project reviewers who verified their email, plus project members who have it on. Per-person opt-out through a hashed unsubscribe token and the existing notification settings.
- **Schedule:** Mondays 09:00 in a fixed zone, only for projects that are in progress and had activity. A Workers cron trigger runs it; no new dependency.
- **Tables:** `status_reports` (project, week, status, body snapshot, sent at, recipients count), `email_unsubscribes`.
- **Endpoints (board):** `GET /projects/:id/status-reports`, `POST /projects/:id/status-reports/preview` (owners/editors). Dev prints to the outbox. Another workspace 404.
- **Tests:** unit tests for status and wording per case, a send test with the outbox, unsubscribe, no duplicate send in one week; Playwright for the preview.
- **Open questions:** 1. Monday 09:00 UTC for all (recommended; per-person time zones later). 2. Email text built from templates, not a model (recommended). 3. Skip quiet projects instead of sending an empty email (recommended).
- **Out of scope:** daily digests, Slack delivery, custom templates.

## 2026-11-20: Feature 22 404 and states pass — approved (all recommendations)
Screens: 507 (404), 506 (no access, already built), 704 (states). Front-end only, no API or migration.
- **404:** router-level not-found page for any unknown path, signed in or out, with a way back to the workspace or sign-in. Unknown project or workspace content still shows the correct no-access or 404.
- **States audit:** go through every route and check the drawn states in 704: empty (Home, Projects, My tasks, Inbox, others), loading skeleton, error with "Try again", drafting progress, and saved with Undo toast. Fix every gap with the existing `EmptyState`, `SkeletonRow` and `Toast` primitives; add a primitive only if none fits.
- **Errors:** one app-level error boundary so a crash shows the error state, not a blank page.
- **Tests:** Playwright for 404 (in and out), a table-driven spec visiting each route in empty, loading (delayed response) and error (failed response) states; extend `qa-screens.spec.ts` rule scan.
- **Open questions:** 1. Undo only where the drawing shows it, plus rejecting a section (recommended). 2. Audit covers desktop and the 390px layout (recommended).
- **Out of scope:** new features, copy rewrites beyond the drawn states.

## Still open before production
- Apply migrations 0001–0015 to Neon before the first deploy.
- Fix the fake-drafter fallback: in production a missing ANTHROPIC_API_KEY or TRIGGER_SECRET_KEY must show "drafting is not set up" instead of returning the fixed sample plan or diagram. Fake drafter only in local dev and tests.

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
| 7 | Project › Plan + drafts | Plan, draft diff accept/reject, decision log | shipped 2026-11-14 |
| 8 | Diagrams | React Flow + ELK canvas, versions, draft diagram | shipped 2026-11-14 |
| 9 | Activity | Timeline, filters | shipped 2026-11-14 |
| 10 | My tasks | My tasks | shipped 2026-11-15 |
| 11 | Inbox | Mentions, assignments, replies | shipped 2026-11-15 |
| 12 | ⌘K search | Search overlay | shipped 2026-11-15 |
| 13 | Workspace settings | General, share links, danger zone | shipped 2026-11-15 |
| 14 | Account settings | Account | shipped 2026-11-15 |
| 15 | Share links + public share page | Share dialog, public page | shipped 2026-11-18 |
| 16 | Mobile | Projects, Brief, Share page (390px) | ready for review 2026-11-20 |
| 17 | Landing page | Landing | shipped 2026-11-20 |
| 18 | Stakeholder approval | Share page review banner | shipped 2026-11-23 |
| 19 | Tracker sync | Settings › Integrations | shipped 2026-11-24 |
| 20 | Drift detection | Plan drift card | shipped 2026-11-24 |
| 21 | Weekly status email | Monday email | plan approved |
| 22 | 404 and states pass | 404, states audit | shipped 2026-11-25 |
