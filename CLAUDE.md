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
- `pnpm wt <name>` / `pnpm wt rm <name>` / `pnpm wt ls`: feature worktrees.
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

## Team and workflows

- Agents in `.claude/agents/`: `builder` (Sonnet), `reviewer` (Opus), `security` (Opus), `qa` (Sonnet). The main session is the lead.
- `/feature <screen>`: plan → worktree → build → verify → review + security → ship. User approves the plan and the ship.
- `/fix <bug>`: failing test → fix → review (+ security if it touches auth, data or input) → ship.
- `/ship`: checks, migrate, deploy, smoke test.
- One worktree per feature or fix, created with `pnpm wt`. All agents for that work run inside it.

## Git
- Repo: `github.com/Ramreddy6363/planfrojex` (public: never commit secrets, keys or customer data). `main` is protected: changes land only through a pull request with green CI (`.github/workflows/ci.yml`: check, build, audit).
- Branches: `feat/<name>` for features, `feat/fix-<name>` for fixes (created by `pnpm wt`). Squash merge, branch deleted after merge.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- No AI attribution: no `Co-Authored-By: Claude` trailers and no "Generated with Claude Code" lines in commits or PR bodies. `.githooks/commit-msg` rejects them.
- Only the lead commits, pushes and opens PRs, inside `/ship`. Agents never run git write commands.
- Guardrails (never bypass): `.githooks/pre-push` blocks pushes to `main` and runs `pnpm check` before any push; `pnpm merge <branch>` is the only way to merge and refuses unless CI passed; `.claude/hooks/guard-git.sh` blocks `gh pr merge`, pushes to `main`, force pushes and `--no-verify`.
- Deploys are manual through `/ship` from `main`; CI never deploys.
