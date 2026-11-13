#!/usr/bin/env bash
# Git credential helper for this repo: always authenticate as the repo owner, whichever gh account is active.
[[ $1 == get ]] || exit 0
echo username=Ramreddy6363
echo "password=$(gh auth token -u Ramreddy6363)"
