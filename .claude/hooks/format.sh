#!/usr/bin/env bash
# PostToolUse: format the file Claude just edited. Never blocks.
f=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tool_input?.file_path??""))')
case "$f" in
  *.ts|*.tsx|*.js|*.json|*.jsonc|*.css) pnpm exec biome check --write "$f" >/dev/null 2>&1 ;;
esac
exit 0
