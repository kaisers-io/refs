#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
fixed_dates
refs init --json >/dev/null
# v1.0.0 -> v1.1.0 changes one default in the code. v1.1.1 is tagged on a commit that only edits
# the README, so its code diff against v1.1.0 is empty. There is no v1.2.0.
repo=fixtures/retrylib
new_fixture retrylib
manifest "$repo" '{"name":"retrylib","version":"1.0.0"}'
printf '# retrylib\n\nRetry a promise-returning function.\n' >"$repo/README.md"
write_retry() {
  cat >"$repo/index.js" <<JS
// Calls fn until it resolves, waiting twice as long after each rejection.
export const retry = async (fn, attempts = $1, delayMs = 100) => {
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
}
write_retry 3
git -C "$repo" add -A
(cd "$repo" && commit "initial retrylib" && git tag v1.0.0)
write_retry 5
manifest "$repo" '{"name":"retrylib","version":"1.1.0"}'
git -C "$repo" add -A
(cd "$repo" && commit "retry five times by default" && git tag v1.1.0)
printf '# retrylib\n\nRetry a promise-returning function, with exponential backoff.\n' >"$repo/README.md"
git -C "$repo" add -A
(cd "$repo" && commit "readme: mention backoff" && git tag v1.1.1)
register_fixture retrylib "Retry helper."
