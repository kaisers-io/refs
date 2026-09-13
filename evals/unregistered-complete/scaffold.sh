#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
readable_refs_home
toolkit_fixture
register_toolkit
# Upstream then adds two members. Discovery completes this time: nobody has decided about cache,
# and the user already declined legacy, so doctor reports the first and only counts the second.
repo=fixtures/toolkit
manifest "$repo/packages/cache" '{"name":"@toolkit/cache","version":"1.0.0"}'
manifest "$repo/packages/legacy" '{"name":"@toolkit/legacy","version":"0.9.0"}'
git -C "$repo" add -A
(cd "$repo" && commit "add cache and legacy")
refs sync --json >/dev/null
refs edit --package=@toolkit/legacy --decline --path=packages/legacy local/fixtures/toolkit --json >/dev/null
