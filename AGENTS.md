# PlanFrojex

Instructions for every coding agent (Claude Code, Codex, Cursor, Copilot, Gemini, Windsurf, Aider…). This file is the single source; `CLAUDE.md` and `GEMINI.md` only point here. If your tool's own habits conflict with this file, this file wins.

Planning tool for small product teams: a rough brief becomes a reviewed plan with owners and dates, tracked against real work. Rebuilt from scratch; the old app in `../planforjex-backup-2026-10-29.zip` is reference only, never copy its code.

## Sources of truth

- **Screens:** PNGs in `design/exports/` (numbered), exact values in `design/planfrojex.pen` via the Pencil MCP if your tool has it. Build what is drawn; screen missing: stop and ask.
- **Design rules and tokens:** `docs/specs/2026-10-13-redesign-design.md` section 5; tokens in `apps/web/src/styles.css`.
- **API, data model, permissions, flows:** the "Backend: stack and API" boards in Pencil.
- **Progress and plans:** `docs/plans/progress.md`.

## Layout

- `apps/api`: Hono + Zod OpenAPI on Cloudflare Workers, Drizzle on Neon Postgres, Better Auth inside the API. Exports `AppType`.
- `apps/web`: React 19, Vite, TanStack Router/Query, Tailwind v4, React Flow + ELK. Calls the API only through the typed client in `src/api.ts`.
- UI building blocks: `apps/web/src/ui/` (Button, Input, Select, Tabs, Status, Avatar, Dialog, Menu, Toast, EmptyState, …). Gallery: `http://localhost:5173/design.html`.

## Commands

- First time: `pnpm install` (also turns on the git hooks).
- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`
- `pnpm check`: lint + typecheck + tests. Must pass before anything counts as done.
- `pnpm --filter @planfrojex/web e2e`: Playwright, for any screen change.
- `pnpm --filter @planfrojex/api db:generate` then `db:migrate`.
- `pnpm merge <branch>`: the only way to merge (runs the full check locally, then squash merges).

## Rules (non-negotiable)

1. **Workspace isolation:** every query on workspace-owned data filters by `workspace_id` from the session, never from the body or URL alone. Every new endpoint gets a test that a member of another workspace gets 404.
2. **Permissions** follow the Permissions board (owner / editor / viewer; project lead), checked on the server.
3. **Drafts never write directly.** Model output becomes `draft_changes`; accepting runs in one transaction that also writes the decision log.
4. **Tokens** (share links, reviewer links, invites, email codes) are stored only as hashes.
5. **Auth is passwordless:** Google or a 6-digit email code via Better Auth. Never add password login.
6. **Validate at the boundary** with Zod. No raw SQL string building. No secrets in code or logs.
7. **Look:** build screens only from `apps/web/src/ui/` and tokens (no raw hex), IBM Plex, radius 6/8, one accent, status glyphs not dots. Banned: gradients, glows, sparkle/wand/bot icons, "AI" wording, emoji, purple. Need a new primitive: add it to `src/ui/` and the gallery. `src/design-rules.test.ts` enforces this.
8. **Tests first** for every behaviour change: write the failing test, see it fail, then the code. Vitest for logic and API, Playwright for screens.
9. **Code:** reuse what exists before writing new; no speculative abstractions; exact dependency versions (no `^`/`~`), ask before adding one; the app runs locally without third-party keys.

## Workflow

One approval: the plan.

1. **Plan note → user OK.** Add a short section to `docs/plans/progress.md` (screens, endpoints, tables, open questions). Wait for the user's OK. Plan wrong mid-build: stop and ask.
2. **Branch:** `git switch -c feat/<name>` (fixes: `feat/fix-<name>`) from an up-to-date `main`. Never edit on `main`.
3. **Build test-first.** Then `pnpm check`, e2e, and compare changed screens with their PNG.
4. **Review:** one fresh-eyes pass following `.claude/agents/reviewer.md` on `git diff main` with only the plan note (a separate subagent if your tool has one; otherwise a separate step). Includes the security pass when auth, permissions, tokens or user data change. Fix high and agreed medium findings.
5. **Ship:** mark the feature in the progress table, commit, push the branch, open a PR against `main`, `pnpm merge <branch>`, then switch to `main` and pull. Tell the user what shipped and any finding left open.

No deploys until production exists.

## Git

- Repo `github.com/Ramreddy6363/planfrojex` is public: never commit secrets, keys or customer data.
- **GitHub account is always `Ramreddy6363`.** `pnpm install` makes git push as it (`scripts/git-auth.sh`) and `pnpm merge` uses it. Run other `gh` commands as `GH_TOKEN=$(gh auth token -u Ramreddy6363) gh …`. Never switch the active gh account or push as another account.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Squash merge, branch deleted after merge.
- No AI attribution of any tool in commits or PR bodies (no `Co-Authored-By` bot trailers, no "Generated with …" lines). `.githooks/commit-msg` rejects them.
- Every PR body includes one line stating what the review pass found and what was fixed, or `Review: No findings`.
- Never push to `main`, never `gh pr merge` directly, never `--force` or `--no-verify`. `.githooks/pre-push` blocks pushes to `main` and runs `pnpm check`.
