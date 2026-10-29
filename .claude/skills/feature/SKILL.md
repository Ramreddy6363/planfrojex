---
name: feature
description: Build one PlanFrojex feature from its Pencil screen to production - plan, worktree, build, verify, review and security, ship. Use when the user says /feature, "build <screen>", or asks to implement anything already designed in Pencil.
---

# /feature <name or screen>

The main session is the lead. Agents do the work; the lead plans, hands off, checks and talks to the user. Two approval gates: the plan and the ship.

## 1. Scope

- Find the Pencil screen(s) for the feature (Pencil MCP, or `design/exports/`) and the endpoints, tables, flows and permissions on the backend boards.
- If no screen exists, stop: design it in Pencil with the user first, then come back.
- Check `docs/plans/progress.md` for what this depends on. If a dependency isn't built, say so and propose building it first.

## 2. Plan → **Gate 1**

Write `docs/plans/<YYYY-MM-DD>-<name>.md`:
- **Screens:** Pencil frame names and export paths.
- **Endpoints:** method, path, request, response, who may call it (from the boards).
- **Tables:** new or changed, with migration notes.
- **Tasks:** small, ordered, each with its test.
- **Tests:** API (including the cross-workspace 404 and role tests), Playwright main path.
- **Out of scope.**

Show the user a short summary with the file path. Wait for approval. Do not continue without it.

## 3. Worktree

`pnpm wt <name>` from the repo root. Every agent below gets this worktree path.

## 4. Build

Spawn **builder** with the worktree path and plan path. When it returns, run `pnpm check` in the worktree yourself. Do not trust the report alone.

## 5. Verify

Spawn **qa** with the worktree and plan. Failures go back to **builder**, then re-run qa.

## 6. Review and security (in parallel)

Spawn **reviewer** and **security** in the same message, each with the worktree path, base branch and plan path. Never pass the builder's notes to them.
- High findings, and medium findings you agree with, go to **builder** as one list. Then re-run `pnpm check` and whichever agent raised them.
- Disagree with a finding? Say why in the gate summary; don't drop it silently.

## 7. Ship → **Gate 2**

Give the user:
- what was built (screens, endpoints, tables)
- test results (`pnpm check`, Playwright)
- review and security outcome, with any finding left open and why
- migrations that will run

On approval, run `/ship <name>`. Then add a line to `docs/plans/progress.md`.

## Rules

- One feature per worktree. Don't mix features.
- If the plan turns out wrong mid-build, stop and update the plan with the user. Don't let the builder improvise.
- Report failures as they are. Never mark a stage done while `pnpm check` fails.
