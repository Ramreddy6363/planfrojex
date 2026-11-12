# PlanFrojex

Planning tool for small product teams: a rough brief becomes a reviewed plan with owners and dates, tracked against real work. Rebuilt from scratch; the old app is in `../planforjex-backup-2026-10-29.zip` (reference only, never copy its code).

## Sources of truth

- **Screens:** Pencil file `design/planfrojex.pen` (read via the Pencil MCP) and PNGs in `design/exports/`. Build what is drawn; if a screen is missing, stop and ask.
- **Design rules and tokens:** `docs/specs/2026-10-13-redesign-design.md` section 5. Tokens live in `apps/web/src/styles.css`.
- **API, data model, permissions, flows:** the "Backend: stack and API" boards in Pencil (System architecture, Data model, API endpoints, Key flows, Permissions).
- **Progress:** `docs/plans/progress.md`. Update it when a feature ships.

## Layout

- `apps/api`: Hono + Zod OpenAPI on Cloudflare Workers, Drizzle on Neon Postgres, Better Auth (runs inside the API; tables in our Postgres). Exports `AppType`.
- `apps/web`: React 19, Vite, TanStack Router/Query, Tailwind v4, React Flow + ELK. Calls the API through the typed Hono client in `src/api.ts`.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`
- `pnpm check`: lint + typecheck + tests. Must pass before any stage counts as done.
- `pnpm --filter @planfrojex/api db:generate` then `db:migrate`.

## Rules (non-negotiable)

1. **Workspace isolation:** every query on workspace-owned data filters by `workspace_id` taken from the session, never from the request body or URL alone. Every new endpoint gets a test proving a member of another workspace gets 404.
2. **Permissions** follow the Permissions board (owner / editor / viewer; project lead). Checked on the server, not only hidden in the UI.
3. **Drafts never write directly.** Model output becomes `draft_changes`; accepting runs in one transaction that also writes the decision log.
4. **Tokens** (share links, reviewer links, invites, email codes) are stored only as hashes.
5. **Auth is passwordless:** Google or a 6-digit email code through Better Auth. Never add password login (it doesn't fit the Workers free CPU limit and adds a secret to protect).
6. **Validate at the boundary** with Zod. No raw SQL string building. No secrets in code or logs.
7. **Look:** tokens only (no raw hex in components), IBM Plex, radius 6/8, one accent, status glyphs not dots. Banned in the app: gradients, glows, sparkle/wand/bot icons, "AI" wording, emoji, purple.
8. **Tests first** for every behaviour change. Vitest for logic and API, Playwright for screens.

## Workflow (keep it short)

- Agents in `.claude/agents/`: `builder` (Sonnet) writes code, `reviewer` (Opus) reviews it, including a security pass when auth, permissions, tokens or user data change. The main session is the lead.
- `/feature <screen>`: plan note, user OK, branch, build test-first, one review, PR, merge on green CI. One approval: the plan.
- `/fix <bug>`: failing test, fix, review, PR, merge on green CI.
- `/ship`: commit, PR, merge; migrate and deploy once production exists.
- Plans are a short section in `docs/plans/progress.md`, not separate files.

## Git
- Repo: `github.com/Ramreddy6363/planfrojex` (public: never commit secrets, keys or customer data). `main` is protected: changes land only through a pull request with green CI (`pnpm merge` runs check, integration tests, build, e2e and audit locally; GitHub CI is off).
- Branches: `feat/<name>` for features, `feat/fix-<name>` for fixes (plain `git switch -c` in the main checkout). Squash merge, branch deleted after merge.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- No AI attribution: no `Co-Authored-By: Claude` trailers and no "Generated with Claude Code" lines in commits or PR bodies. `.githooks/commit-msg` rejects them.
- Only the lead commits, pushes and opens PRs. Agents never run git write commands.
- Guardrails (never bypass): `.githooks/pre-push` blocks pushes to `main` and runs `pnpm check` before any push; `pnpm merge <branch>` is the only way to merge and refuses unless the local checks pass; `.claude/hooks/guard-git.sh` blocks `gh pr merge`, pushes to `main`, force pushes and `--no-verify`.
- Deploys are manual through `/ship` from `main`; CI never deploys.
