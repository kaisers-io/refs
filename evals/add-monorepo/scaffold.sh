#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
# The nothing-registered grader reads config.toml, so refs' home goes into the working directory.
readable_refs_home
toolkit_fixture
