#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
fixed_dates
refs init --json >/dev/null
# Two refs with the same relative file, src/limit.js, that behave differently. The question is
# about alpha; an answer or a citation taken from beta is wrong however well it reads.
new_fixture alpha
manifest fixtures/alpha '{"name":"alpha","version":"1.0.0"}'
mkdir -p fixtures/alpha/src
cat >fixtures/alpha/src/limit.js <<'JS'
// Page size for list requests.
const MAX_PAGE_SIZE = 50;
export const limit = (n) => Math.min(Math.max(1, n), MAX_PAGE_SIZE);
JS
new_fixture beta
manifest fixtures/beta '{"name":"beta","version":"1.0.0"}'
mkdir -p fixtures/beta/src
cat >fixtures/beta/src/limit.js <<'JS'
// Page size for list requests.
const MAX_PAGE_SIZE = 100;
export const limit = (n) => {
  if (n > MAX_PAGE_SIZE) throw new RangeError(`page size ${n} exceeds ${MAX_PAGE_SIZE}`);
  return n;
};
JS
for repo in alpha beta; do
  git -C "fixtures/$repo" add -A
  (cd "fixtures/$repo" && commit "initial $repo" && git tag v1.0.0)
  register_fixture "$repo" "The $repo list client."
done
