---
name: fix
description: Fix one PlanFrojex bug - failing test, fix, review, merge. Use when the user says /fix, reports a bug, or a test fails.
---

# /fix <bug>

1. **Understand:** trace every caller of the suspect code; fix the root cause.
2. **Branch:** `git switch -c feat/fix-<name>` from `main`.
3. **Reproduce:** a test that fails because of the bug. Can't reproduce: stop and tell the user what you tried.
4. **Fix**, then `pnpm check`.
5. **Review:** spawn **reviewer** (security pass included if auth, data or input are touched).
6. **Ship:** `/ship`, then tell the user cause, fix and the proving test.

Needs a new screen, endpoint or table: it's a feature, use `/feature`.
