---
name: feature
description: Build one PlanFrojex feature from its Pencil screen - plan note, build, review, merge. Use when the user says /feature, "build <screen>", or asks to implement anything already designed in Pencil.
---

# /feature <name or screen>

One approval: the plan.

1. **Plan note → user OK.** Read the screen (Pencil MCP or `design/exports/`) and the backend boards. Add a short section to `docs/plans/progress.md`: screens, endpoints, tables, open questions. No screen drawn: stop and ask. Wait for the user's OK.
2. **Branch:** `git switch -c feat/<name>` from an up-to-date `main`.
3. **Build:** spawn **builder** with the plan note (or build it yourself if small). Tests first. Then run `pnpm check` and e2e yourself, and screenshot changed screens against their PNGs.
4. **Review:** spawn **reviewer** on `git diff main` with only the plan note. Ask for the security pass too when auth, permissions, tokens or user data changed. Fix high and agreed medium findings.
5. **Ship:** run `/ship`. Then tell the user what shipped, test results and any finding left open.

If the plan turns out wrong mid-build, stop and ask. Never call a step done while `pnpm check` fails.
