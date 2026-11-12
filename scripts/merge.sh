#!/usr/bin/env bash
# The only way a PR reaches main. GitHub CI is off, so the full check runs here first, then squash merge.
set -euo pipefail
branch=${1:?usage: pnpm merge <branch>}

[[ $(git branch --show-current) == "$branch" ]] || { echo "merge: switch to $branch first" >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo "merge: commit or stash changes first" >&2; exit 1; }
git fetch -q origin "$branch"
[[ $(git rev-parse HEAD) == $(git rev-parse "origin/$branch") ]] || { echo "merge: push $branch first" >&2; exit 1; }

# Throwaway Postgres for the integration tests unless one is given.
if [[ -z ${PLANFROJEX_TEST_DATABASE_URL:-} ]]; then
  pg=$(docker run -d --rm -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=planfrojex_test -p 127.0.0.1::5432 postgres:17)
  trap 'docker stop "$pg" >/dev/null' EXIT
  until docker exec "$pg" pg_isready -U postgres -d planfrojex_test -q; do sleep 1; done
  sleep 2 # the image restarts once after init
  until docker exec "$pg" pg_isready -U postgres -d planfrojex_test -q; do sleep 1; done
  export PLANFROJEX_TEST_DATABASE_URL="postgres://postgres@$(docker port "$pg" 5432)/planfrojex_test"
fi
export CI=1 # integration suites fail instead of skipping

pnpm check --force
pnpm build
pnpm --filter @planfrojex/web e2e
pnpm audit --audit-level high

gh pr merge "$branch" --squash --delete-branch
