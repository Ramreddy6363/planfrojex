@AGENTS.md

## Claude Code only

- Skills: `/feature`, `/fix`, `/ship` run the workflow above.
- Agents in `.claude/agents/`: `builder` (Sonnet) writes code, `reviewer` (Opus) reviews. The main session is the lead; only the lead runs git write commands.
- `.claude/hooks/guard-git.sh` blocks `gh pr merge`, pushes to `main`, force pushes and `--no-verify`; `format.sh` formats on edit.
