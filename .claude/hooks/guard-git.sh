#!/usr/bin/env bash
# PreToolUse (Bash): block git commands that would skip the "CI must pass before main" rule.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tool_input?.command??""))')

block() { echo "guard-git: $1" >&2; exit 2; }

[[ $cmd =~ gh[[:space:]]+pr[[:space:]]+merge ]] && block "merge with 'pnpm merge <branch>' so CI is checked first."
[[ $cmd =~ --no-verify ]] && block "--no-verify skips the pre-push checks."
[[ $cmd =~ git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$)) ]] && block "force push is not allowed."
[[ $cmd =~ git[[:space:]]+push.*[[:space:]:]main([[:space:]]|$) ]] && block "main only changes through a merged pull request."
[[ $cmd =~ ALLOW_MAIN_PUSH ]] && block "ALLOW_MAIN_PUSH is for the user only."
exit 0
