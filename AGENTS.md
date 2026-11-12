# PlanFrojex: instructions for Codex

Read `CLAUDE.md` first: product, stack, commands, rules 1-8 and the Git rules apply unchanged. Claude's skills and `.claude/hooks` don't run here, so follow this flow yourself:

1. **Plan note → user OK.** Read `docs/plans/progress.md`. Add a short section for the feature (screens from `design/exports/*.png`, endpoints, tables, open questions) and wait for the user's OK. Screen not drawn: ask.
2. **Branch:** `git switch -c feat/<name>` from an up-to-date `main`. Never edit on `main`.
3. **Build test-first** from `apps/web/src/ui/` primitives and the tokens in `apps/web/src/styles.css` (gallery: `http://localhost:5173/design.html`). Exact dependency versions; ask before adding one. Runs locally without third-party keys.
4. **Verify:** `pnpm check`, `pnpm --filter @planfrojex/web e2e`, and compare changed screens with their PNG.
5. **Review:** one pass using `.claude/agents/reviewer.md` on `git diff main` with only the plan note (a subagent if available). Fix high and agreed medium findings.
6. **Ship:** mark the feature in the progress table, commit (Conventional Commits, no AI attribution), push the branch, open a PR against main, then `pnpm merge feat/<name>`, the only way to merge. Never push to `main`, never `--force` or `--no-verify`.

No deploys until production exists.
