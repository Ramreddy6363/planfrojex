#!/usr/bin/env bash
# The only way a PR reaches main: wait for CI, refuse unless every check passed, then squash merge.
set -euo pipefail
branch=${1:?usage: pnpm merge <branch>}

if ! gh pr checks "$branch" --watch --fail-fast; then
  echo "merge: CI did not pass for $branch; not merging." >&2
  exit 1
fi
# Guard against a PR that has no checks at all (CI not triggered).
passed=$(gh pr checks "$branch" --json name,bucket --jq '[.[] | select(.bucket == "pass")] | length')
if [[ $passed -eq 0 ]]; then
  echo "merge: no passing CI checks found on $branch; not merging." >&2
  exit 1
fi
gh pr merge "$branch" --squash --delete-branch
