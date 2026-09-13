# Shared scaffold helpers, sourced by each case's scaffold.sh. Not a case: no case.yaml here.
#
# A scaffold runs in the run's empty working directory, as the operator and outside the sandbox,
# with the run's throwaway HOME. Everything it builds stays inside that run.

set -euo pipefail

# The suite only means something against the wrappers scripts/skill-evals.sh puts on PATH.
if [[ "$(command -v refs)" != */node_modules/.cache/skill-evals/bin/refs ]]; then
  echo "run the suite through scripts/skill-evals.sh (refs resolves to $(command -v refs || echo nothing))" >&2
  exit 1
fi

# refs keeps its home under $HOME, which a grader cannot read. A case that grades config.toml calls
# this first, and it points the home into the working directory. A case where the agent clones must
# not: the sandbox refuses writes to .git/hooks and .git/config anywhere under the working directory.
readable_refs_home() {
  mkdir -p .refs-home
  ln -s "$PWD/.refs-home" "$HOME/.kaisers-io"
}

commit() {
  git -c user.name=fixture -c user.email=fixture@example.com commit -q -m "$1"
}

manifest() {
  mkdir -p "$1"
  printf '%s\n' "$2" >"$1/package.json"
}

# A three-package workspace. Each member's manifest describes something its source is not, so a
# description copied from a manifest can be told apart from one written from the code.
toolkit_fixture() {
  refs init --json >/dev/null
  local repo=fixtures/toolkit
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  manifest "$repo" '{"name":"toolkit-root","private":true,"workspaces":["packages/*"]}'
  printf '# toolkit\n\nSmall string and async helpers.\n' >"$repo/README.md"
  manifest "$repo/packages/slugify" \
    '{"name":"@toolkit/slugify","version":"1.0.0","description":"Color palette helpers."}'
  cat >"$repo/packages/slugify/index.js" <<'JS'
// Lower-cases a title and joins its words with dashes, for use in URLs.
export const slugify = (title) =>
  title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
JS
  manifest "$repo/packages/retry" \
    '{"name":"@toolkit/retry","version":"1.0.0","description":"Date formatting utilities."}'
  cat >"$repo/packages/retry/index.js" <<'JS'
// Calls fn until it resolves, waiting twice as long after each rejection.
export const retry = async (fn, attempts = 3, delayMs = 100) => {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i + 1 >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** i));
    }
  }
};
JS
  git -C "$repo" add -A
  (cd "$repo" && commit "initial toolkit" && git tag v1.0.0)
  printf 'file://%s/%s\n' "$PWD" "$repo" >fixtures/toolkit.url
}

# Registers the fixture the way an approved add would: a real dry-run, descriptions filled in,
# finalized from the proposal.
register_toolkit() {
  refs add "$(cat fixtures/toolkit.url)" --dry-run --json 2>/dev/null >proposal.tmp.json
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const proposal = JSON.parse(fs.readFileSync(file, "utf8")).data;
    proposal.description = "Small string and async helpers.";
    for (const [name, entry] of Object.entries(proposal.packages)) {
      entry.description = `The ${name} package.`;
    }
    fs.writeFileSync(file, JSON.stringify(proposal));
  ' proposal.tmp.json
  refs add --proposal proposal.tmp.json --json >/dev/null
  rm proposal.tmp.json
}
