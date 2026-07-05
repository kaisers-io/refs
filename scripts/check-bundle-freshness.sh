#!/usr/bin/env bash
set -euo pipefail
# Paths below are repo-root relative — make invocation from any subdirectory work.
cd "$(git rev-parse --show-toplevel)"
pnpm build
if ! git diff --exit-code packages/cli/bin || [ -n "$(git status --porcelain packages/cli/bin)" ]; then
  echo 'bundle stale or untracked — run pnpm build and commit packages/cli/bin' >&2
  exit 1
fi
