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
