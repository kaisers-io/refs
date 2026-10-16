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
behavior_register retry
