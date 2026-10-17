#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
readable_refs_home
refs init --json >/dev/null

# Two tracked repositories with the same relative file, src/size.js, line for line the same except
# line 7: which unit a bare number means. alpha reads "4" as 4 bytes, beta as 4 megabytes. An answer
# about beta that cites alpha's copy is a wrong citation even though its relative path is right.
size_fixture() {
  local repo="fixtures/$1"
  mkdir -p "$repo/src"
  git -C "$repo" init -q -b main
  manifest "$repo" "{\"name\":\"$1-size\",\"version\":\"1.0.0\",\"type\":\"module\"}"
  printf '# %s-size\n\nParses human-readable sizes.\n' "$1" >"$repo/README.md"
  cat >"$repo/src/size.js" <<JS
// Parses a human-readable size such as "4kb" or "2 mb" into a number of bytes.
const UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

export const parseSize = (input) => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(String(input));
  if (!match) throw new TypeError(\`not a size: \${input}\`);
  const unit = match[2].toLowerCase() || '$2';
  if (!(unit in UNITS)) throw new TypeError(\`unknown unit: \${unit}\`);
  return Math.round(Number(match[1]) * UNITS[unit]);
};
JS
  git -C "$repo" add -A
  (cd "$repo" && commit "initial $1-size")
  printf 'file://%s/%s\n' "$PWD" "$repo" >"fixtures/$1.url"
  register_fixture "$1" 'Parses human-readable sizes.'
}

size_fixture alpha b
size_fixture beta mb
