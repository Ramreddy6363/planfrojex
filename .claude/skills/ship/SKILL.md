---
name: ship
description: Ship a reviewed PlanFrojex feature or fix branch - commit, PR, merge on green CI, update progress. Deploy steps apply once production exists.
---

# /ship

1. `pnpm check` must pass.
2. Mark the feature in the `docs/plans/progress.md` table. Commit (Conventional Commits, no AI attribution), push the branch, open a PR against main with a short body: what, tests, review outcome, migrations.
3. `pnpm merge <branch>` (waits for CI, refuses unless green). Red CI: fix, push, retry. Then switch to main and pull.
4. **Once production exists:** `pnpm --filter @planfrojex/api db:migrate` (additive only unless the user says so), deploy API (`pnpm --filter @planfrojex/api deploy`) and web (`wrangler pages deploy apps/web/dist`), check `GET /health`. Failure: tell the user and propose `wrangler rollback`.
