#!/usr/bin/env bash
# Feature worktrees live next to the repo: ../planforjex-worktrees/<name>, branch feat/<name>.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
base="$root/../planforjex-worktrees"

case "${1:-}" in
  "" | -h | --help) echo "usage: pnpm wt <name> | pnpm wt rm <name> | pnpm wt ls"; exit 1 ;;
  ls) git worktree list; exit 0 ;;
  rm)
    name=${2:?name required}
    git worktree remove "$base/$name"
    git branch -d "feat/$name" || echo "branch feat/$name is not merged; kept it"
    exit 0
    ;;
esac

name=$1
dir="$base/$name"
[[ $name =~ ^[a-z0-9-]+$ ]] || { echo "name must be kebab-case"; exit 1; }
git worktree add "$dir" -b "feat/$name"

# Copy local env files listed in .worktreeinclude (they are gitignored).
while read -r f; do
  [[ -z $f || $f == \#* ]] && continue
  if [[ -f "$root/$f" ]]; then
    mkdir -p "$dir/$(dirname "$f")"
    cp "$root/$f" "$dir/$f"
  fi
done <"$root/.worktreeinclude"

(cd "$dir" && pnpm install --frozen-lockfile)
echo "$dir"
