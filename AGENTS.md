# PlanFrojex: instructions for Codex

Read `CLAUDE.md` first: product, stack, layout, commands and the non-negotiable rules 1-8 apply to you unchanged. This file adds how Codex runs the work, because Claude's `/feature`, `/fix`, `/ship` skills and `.claude/hooks` don't run here.

## Before any code

1. Read `docs/plans/progress.md` (what's shipped, feature order) and the feature's plan in `docs/plans/<date>-<name>.md`.
2. **Plan gate:** the plan's `Status:` line must say **approved**. If it says "awaiting approval", or decisions are open, stop and ask the user. Never start building on an unapproved plan. No plan yet: write one (screens, endpoints, tables, tasks with their tests, out of scope) and ask for approval.
3. **Never work on `main`.** Run `pnpm wt <name>` (creates `../planforjex-worktrees/<name>` on `feat/<name>`; fixes use `fix-<name>`) and do all work inside that worktree. Check with `git branch --show-current` before the first edit.

## Building

- **Tests first** for every behaviour change (rule 8): write the failing test, see it fail, then the code. API: every workspace endpoint gets a test that a member of another workspace gets 404, plus role tests from the Permissions board.
- **Screens:** `design/exports/*.png` (numbered) are the source; the exact values are in `design/planfrojex.pen` via the Pencil MCP if connected. Screen not drawn: stop and ask.
- **Design system:** build screens only from `apps/web/src/ui/` (Button, Input, Textarea, Select, Checkbox, Tabs, Status, Avatar, Progress, Dialog, Menu, Toast, EmptyState, SkeletonRow, Brand, Icon) and the tokens in `apps/web/src/styles.css`. See them at `http://localhost:5173/design.html` (`pnpm dev`). Need a new primitive: add it to `src/ui/` and the gallery, don't style one-offs. `src/design-rules.test.ts` fails the build on raw colours, gradients, purple, extra shadows, radius > 8, emoji, "AI" wording.
- **Dependencies:** exact versions only (`"1.2.3"`, never `^`/`~`). Ask before adding one.
- **Dev without secrets:** the app must run locally without third-party keys (e.g. no `RESEND_API_KEY` → print the email code to the API log in dev only).
- Plan wrong mid-build: stop and update the plan with the user. Don't improvise.

## Verify (all must pass before review)

- `pnpm check` (lint + typecheck + unit tests)
- `pnpm --filter @planfrojex/web e2e` (Playwright) for any screen change
- Screens compared with their PNG in `design/exports/`

## Review

If subagents are available, run reviewer and security on the diff (`git diff main`) with only the plan and the code, never your build notes. Role instructions: `.claude/agents/reviewer.md`, `security.md`, `qa.md` (ignore their `model`/tools frontmatter). Fix high and agreed medium findings, re-run checks. Without subagents, do the same passes yourself as separate steps and list findings.

| Role | Default | Stronger option | Instructions |
| --- | --- | --- | --- |
| Builder | `gpt-6.1-sol`, medium | `gpt-6.1-terra`, high | `.claude/agents/builder.md` |
| Reviewer | `gpt-6.1-sol`, medium | `gpt-6.1-terra`, xhigh | `.claude/agents/reviewer.md` |
| Security | `gpt-6.1-sol`, medium | `gpt-6.1-terra`, xhigh | `.claude/agents/security.md` |
| QA | `gpt-6.1-sol`, medium | `gpt-6.1-terra`, high | `.claude/agents/qa.md` |

Do not use `gpt-6-astra` for any role.

## Ship gate

Stop and give the user: what was built, `pnpm check` + e2e output, review/security findings (fixed and open), migrations. Ship only after they approve:

1. Commit in the worktree (Conventional Commits, no AI attribution: `.githooks/commit-msg` rejects it), `git push -u origin feat/<name>` (pre-push runs `pnpm check`).
2. `gh pr create --base main`, then `gh pr checks --watch`. Red CI: fix and push again.
3. `pnpm merge feat/<name>`: the only way to merge. Never `gh pr merge`, never push to `main`, never `--force` or `--no-verify`.
4. Add a line to `docs/plans/progress.md` and mark the feature in the Feature order table.
5. `pnpm wt rm <name>`.

No deploys yet: there is no production environment until the domain decision in feature 1 (D4).
