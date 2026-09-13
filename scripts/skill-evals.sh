#!/usr/bin/env bash
# Runs the eval suite in evals/ against skills/refs, with the CLI built from this checkout.
#
# Every case drives `refs` through Bash, and Bash in an eval run is sandboxed: the child sees the
# operator's PATH but none of the other variables refs reads. So this puts a directory of wrappers
# first on PATH instead:
#   - `refs` runs the freshly built bundle, not whatever version is installed globally, with the
#     `file://` escape hatch the local fixtures need and the npm update check off (no network).
#   - on macOS, `git` and the transport helpers it spawns exec the real binaries. The /usr/bin
#     stubs go through xcrun, which the sandbox stops from reading its own cache.
# The wrappers live under node_modules/ because the sandbox cannot read the system temp dirs.
#
# Extra arguments pass through (`--runs 1`, `--case 'add-*'`, `--model sonnet`, `--json out.json`),
# but the flags after them keep the suite offline-safe: reports stay local and there is no
# no-plugin arm, which cannot run a `/refs` prompt at all.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/node_modules/.cache/skill-evals/bin"

pnpm --dir "$root" --filter @kaisers-io/refs build >/dev/null

rm -rf "$bin"
mkdir -p "$bin"
wrap() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$bin/$1"
  chmod +x "$bin/$1"
}
wrap refs "REFS_ALLOW_FILE_URLS=1 REFS_UPDATE_CHECK=0 exec $(printf %q "$(command -v node)") $(printf %q "$root/packages/cli/bin/refs.mjs") \"\$@\""
if command -v xcrun >/dev/null; then
  for tool in git git-upload-pack git-receive-pack git-upload-archive; do
    wrap "$tool" "exec $(printf %q "$(xcrun --find "$tool")") \"\$@\""
  done
fi

PATH="$bin:$PATH" exec claude plugin eval "$root" "$@" \
  --scaffold --allow-tools Bash Write Edit --ablation none --no-publish
