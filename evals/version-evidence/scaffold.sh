#!/usr/bin/env bash
case_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$case_dir/../behavior-lib.sh"
behavior_repo retry "$case_dir/fixtures/before"
git -C fixtures/retry tag '@fixture/retry@1.0.0'
cp -R "$case_dir/fixtures/after/." fixtures/retry/
git -C fixtures/retry add -A
(cd fixtures/retry && GIT_AUTHOR_DATE=2026-01-02T00:00:00Z GIT_COMMITTER_DATE=2026-01-02T00:00:00Z commit 'increase retry delay')
git -C fixtures/retry tag '@fixture/retry@1.1.0'
# Deliberately misleading: a later-looking release tag points at exactly the same commit.
git -C fixtures/retry tag '@fixture/retry@1.2.0'
cp -R "$case_dir/fixtures/docs-only/." fixtures/retry/
git -C fixtures/retry add -A
(cd fixtures/retry && GIT_AUTHOR_DATE=2026-01-03T00:00:00Z GIT_COMMITTER_DATE=2026-01-03T00:00:00Z commit 'document retry without changing code')
git -C fixtures/retry tag '@fixture/retry@1.3.0'
# @fixture/retry@9.9.9 deliberately does not exist.
behavior_register retry
