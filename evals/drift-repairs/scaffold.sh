#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
readable_refs_home
toolkit_fixture
register_toolkit
# Upstream then deletes one registered package and moves the other within its workspaces.
repo=fixtures/toolkit
git -C "$repo" rm -rq packages/slugify
git -C "$repo" mv packages/retry packages/retry-policy
(cd "$repo" && commit "drop slugify, rename retry's directory")
