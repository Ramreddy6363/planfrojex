---
name: ship
description: Ship an approved PlanFrojex feature or fix from its worktree - final checks, database migration, deploy API and web to Cloudflare, smoke test, clean up. Use only after the user approved shipping in /feature or /fix.
---

# /ship <worktree name>

Only run this after the user approved the ship gate.

1. **Checks:** in the worktree, `pnpm check` and `pnpm build`. Any failure stops the ship.
2. **Commit:** in the worktree, add a line to `docs/plans/progress.md`, then commit everything on `feat/<name>` with a Conventional Commit message (`feat: …` or `fix: …`).
3. **Pull request:** `git push -u origin feat/<name>`, then `gh pr create --base main` with a body listing what was built, tests, review and security outcome, and migrations. Then `gh pr checks --watch`. If CI fails, fix it through the builder and push again; never merge red.
4. **Merge:** `pnpm merge feat/<name>`. It waits for CI and refuses to merge unless every check passed (raw `gh pr merge` is blocked by a hook). Then in the repo root: `git switch main && git pull --ff-only`. Everything below runs from the root on `main`, so what is deployed is exactly what is on `main`.
5. **Migrate:** if the change has migrations, `pnpm --filter @planfrojex/api db:migrate` against the production database. Migrations must be additive or have a backfill step; never ship a destructive one without the user saying so.
6. **Deploy:** API with `pnpm --filter @planfrojex/api deploy`; web with `pnpm --filter @planfrojex/web build` then `wrangler pages deploy apps/web/dist`.
7. **Smoke test:** `GET /health` returns `{ ok: true }`, and the feature's main path works on production.
8. **Clean up:** `pnpm wt rm <name>`. Squash merges don't look merged to git, so after confirming the PR state is MERGED (`gh pr view feat/<name> --json state`), delete the local branch with `git branch -D feat/<name>`.

If the smoke test fails, tell the user right away with the error, and propose a rollback (`wrangler rollback`).
