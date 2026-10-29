---
name: fix
description: Fix one PlanFrojex bug through the short flow - reproduce with a failing test, fix in a worktree, review, ship. Use when the user says /fix, reports a bug, or a test or deploy fails.
---

# /fix <bug>

One approval gate: before shipping.

1. **Understand:** read the report, find the code, trace every caller of the function you suspect. Fix the root cause, not the symptom.
2. **Worktree:** `pnpm wt fix-<short-name>`.
3. **Reproduce:** write a test that fails because of the bug (Vitest, or Playwright for a UI bug). Run it and see it fail. If you can't reproduce it, stop and tell the user what you tried.
4. **Fix:** spawn **builder** with the worktree path, the failing test and your root-cause notes. Then run `pnpm check` yourself.
5. **Review:** spawn **reviewer**. If the fix touches auth, permissions, workspace data, tokens, user input or webhooks, spawn **security** in the same message.
6. **Gate:** tell the user the cause, the fix, the test that proves it, and the review outcome. On approval, run `/ship fix-<short-name>`.

If the fix needs a schema change, a new screen or a new endpoint, it isn't a fix: switch to `/feature`.
