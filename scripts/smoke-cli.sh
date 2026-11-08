#!/usr/bin/env bash
# Smoke test of an INSTALLED `refs`: whatever is first on PATH, which each caller installs its own
# way first (a packed tarball in ci.yml `smoke` and release.yml `verify`, the registry in
# `verify-published`). That is the minified bundle a user runs, which the unit suite never
# touches. It takes one reference through its whole lifecycle against a local fixture repository
# and checks what each step reports, not only that it exited 0.
#
# Usage: bash scripts/smoke-cli.sh <expected-version>
#
# Runs under bash on Linux and macOS, and under Git Bash on Windows. There, every path handed to
# refs is spelled natively (`cygpath -w`): refs is a native program, and a POSIX `/tmp/...` path
# inside a `file://` URL is not rewritten for it.
set -euo pipefail

EXPECTED="${1:?usage: smoke-cli.sh <expected-version>}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

native() {
  if command -v cygpath > /dev/null; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}

# expect <what> <json> <condition>: <condition> is a JavaScript expression over the parsed
# envelope `o` (and `process.env`). Fails, printing the envelope, when it does not hold.
expect() {
  # The script is JavaScript: its `${...}` are template literals, not shell expansions.
  # shellcheck disable=SC2016
  node -e '
    const [what, json, condition] = process.argv.slice(1);
    const o = JSON.parse(json);
    if (!new Function("o", `return (${condition});`)(o)) {
      console.error(`smoke FAILED: ${what}: expected ${condition}, got ${json}`);
      process.exit(1);
    }
    console.log(`ok: ${what}`);
  ' "$1" "$2" "$3"
}

REFS_HOME="$(native "$SCRATCH/home")"
export REFS_HOME
export REFS_ALLOW_FILE_URLS=1

VERSION="$(refs --version)"
if [ "$VERSION" != "$EXPECTED" ]; then
  echo "smoke FAILED: refs --version printed '$VERSION', expected '$EXPECTED'" >&2
  exit 1
fi
echo "ok: refs --version is $VERSION"

expect 'init' "$(refs init --json)" 'o.ok && o.data.config === "seeded"'
expect 'doctor reports node ok' "$(refs doctor --json)" \
  'o.data.checks.some((check) => check.name === "node" && check.status === "ok")'

FIXTURE="$SCRATCH/fixture"
git init -q -b main "$FIXTURE"
git -C "$FIXTURE" -c user.email=smoke@refs -c user.name=smoke commit -q -m init --allow-empty
git -C "$FIXTURE" tag v1.0.0
URL="$(node -e 'console.log(require("node:url").pathToFileURL(process.argv[1]).href)' "$(native "$FIXTURE")")"
export URL

ADDED="$(refs add "$URL" --description 'smoke fixture' --json)"
expect 'add' "$ADDED" 'o.ok && typeof o.data.key === "string" && o.data.entry.url === process.env.URL'
KEY="$(node -e 'console.log(JSON.parse(process.argv[1]).data.key)' "$ADDED")"
export KEY

expect 'list shows the reference' "$(refs list --json)" \
  'o.ok && o.data.length === 1 && o.data[0].key === process.env.KEY'
expect 'sync' "$(refs sync --json)" \
  'o.ok && o.data.results.length === 1 && o.data.results[0].key === process.env.KEY'
RESOLVED="$(refs resolve "$KEY" --json)"
expect 'resolve' "$RESOLVED" \
  'o.ok && o.data.key === process.env.KEY && o.data.checkout.status === "managed"'
CHECKOUT="$(node -e 'console.log(JSON.parse(process.argv[1]).data.local_path)' "$RESOLVED")"
export CHECKOUT
expect 'the checkout exists' '{}' 'require("node:fs").existsSync(process.env.CHECKOUT)'

expect 'remove' "$(refs remove "$KEY" --json)" 'o.ok && o.data.key === process.env.KEY'
expect 'list is empty after remove' "$(refs list --json)" 'o.ok && o.data.length === 0'
expect 'the checkout is gone' '{}' '!require("node:fs").existsSync(process.env.CHECKOUT)'
# Exit 4 is refs' "not found"; anything else, success included, is a failure here.
STATUS=0
GONE="$(refs resolve "$KEY" --json)" || STATUS=$?
if [ "$STATUS" != 4 ]; then
  echo "smoke FAILED: resolve after remove exited $STATUS, expected 4: $GONE" >&2
  exit 1
fi
expect 'resolve after remove' "$GONE" '!o.ok && o.error.reason === "unmatched_query"'
echo "smoke OK: refs $VERSION"
