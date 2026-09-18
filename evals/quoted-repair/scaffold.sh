#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
readable_refs_home
toolkit_fixture
register_toolkit
# Upstream adds a member whose directory and manifest name both carry shell metacharacters. Both
# are legal: `zPackagePath` admits a space and `$(…)`, and a manifest name is whatever the
# repository wrote. The repair command refs prints quotes them; one assembled from the raw
# `name`/`path` fields does not.
repo=fixtures/toolkit
manifest "$repo/packages/a b" '{"name":"@toolkit/c$(id)","version":"1.0.0"}'
git -C "$repo" add -A
(cd "$repo" && commit "add a member with an awkward name")
refs sync --json >/dev/null
