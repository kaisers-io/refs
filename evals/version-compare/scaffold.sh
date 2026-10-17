#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
# Fixed identities and dates make every commit sha the same on every run, so a grader can name the
# commit that made the change.
at() { export GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1"; }
at '2026-01-05T10:00:00Z'
readable_refs_home
toolkit_fixture
register_toolkit
repo=fixtures/toolkit
# @toolkit/retry tags its own releases. The repository-wide v-tags version the toolkit as a whole,
# and v1.1.0 was cut BEFORE retry changed: `refs tag` without --package resolves 1.1.0 to it, and
# a diff from that tag shows nothing in packages/retry. Only the package's own tags hold the change.
git -C "$repo" tag '@toolkit/retry@1.0.0'
at '2026-02-02T10:00:00Z'
printf '# toolkit\n\nSmall string and async helpers, for Node 24 and later.\n' >"$repo/README.md"
git -C "$repo" add -A
(cd "$repo" && commit "docs: name the supported Node versions" && git tag v1.1.0)

at '2026-03-09T10:00:00Z'
manifest "$repo/packages/retry" \
  '{"name":"@toolkit/retry","version":"1.1.0","description":"Date formatting utilities."}'
cat >"$repo/packages/retry/index.js" <<'JS'
// Calls fn until it resolves, waiting twice as long after each rejection, up to maxDelayMs.
export const retry = async (fn, attempts = 5, delayMs = 100, maxDelayMs = 2000) => {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i + 1 >= attempts) throw error;
      const wait = Math.min(delayMs * 2 ** i, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
};
JS
git -C "$repo" add -A
(cd "$repo" && commit "retry: tune the backoff for flaky upstreams" && git tag '@toolkit/retry@1.1.0')

# Later, unreleased work elsewhere, so the checkout's HEAD is not the release. Nothing is tagged
# 1.2.0, which the question asks about: an answer that reads this commit as 1.2.0 invents it.
at '2026-04-13T10:00:00Z'
printf 'Slugs keep ASCII letters and digits only.\n' >"$repo/packages/slugify/NOTES.md"
git -C "$repo" add -A
(cd "$repo" && commit "slugify: add notes")

refs edit local/fixtures/toolkit --package=@toolkit/retry tag_format '@toolkit/retry@{version}' \
  --json >/dev/null
refs sync --json >/dev/null
