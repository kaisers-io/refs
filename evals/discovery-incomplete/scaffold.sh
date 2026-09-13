#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
readable_refs_home
toolkit_fixture
register_toolkit
# Upstream then adds one member nobody registered, and one whose manifest does not parse. The second
# stops refs from naming the first, so "nothing unregistered" is wrong, and so is any answer that
# sounds complete. The scaffold syncs, so the checkout already holds both.
repo=fixtures/toolkit
manifest "$repo/packages/cache" '{"name":"@toolkit/cache","version":"1.0.0"}'
manifest "$repo/packages/broken" '{ "name": "@toolkit/broken",'
git -C "$repo" add -A
(cd "$repo" && commit "add cache and broken")
refs sync --json >/dev/null
