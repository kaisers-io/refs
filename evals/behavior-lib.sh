# Shared setup for source-answer cases. Expected content lives in source-controlled fixtures;
# postflight never trusts an answer or a baseline file the agent can rewrite.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
readable_refs_home
refs init --json >/dev/null
refs edit settings clone_mode full --json >/dev/null

behavior_repo() {
  local name="$1" files="$2"
  mkdir -p "fixtures/$name"
  cp -R "$files/." "fixtures/$name/"
  git -C "fixtures/$name" init -q -b main
  git -C "fixtures/$name" add -A
  (cd "fixtures/$name" && GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z commit initial)
}

behavior_register() {
  refs add "file://$PWD/fixtures/$1" --dry-run --json > proposal.tmp.json
  node -e '
    const fs = require("node:fs");
    const proposal = JSON.parse(fs.readFileSync("proposal.tmp.json", "utf8")).data;
    proposal.description = "Deterministic source investigation fixture.";
    for (const entry of Object.values(proposal.packages)) entry.description = "Fixture source package.";
    fs.writeFileSync("proposal.tmp.json", JSON.stringify(proposal));
  '
  refs add --proposal proposal.tmp.json --json >/dev/null
  rm proposal.tmp.json
}
