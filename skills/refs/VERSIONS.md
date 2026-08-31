# Versions — "what changed between vA and vB"

Read [INVESTIGATE.md](INVESTIGATE.md) first. Its routing (§1), hard rules, blob-cost guidance
(§2) and citation contract (§3) all apply here; this file is only the version-specific part.

## 1. Which version is installed

Ask refs — do **not** parse a lockfile:

```bash
refs resolve <package> --project <dir> --json
```

`<dir>` is the directory that imports the dependency: in a monorepo the workspace package,
not the repo root, because that is where Node's own lookup starts. The answer is in
`installed`. `status: "found"` carries `version` and the manifest's own `name`, which differs
from the query when the dependency was installed under an alias. `not_materialized` (nothing
installed there), `unsupported_layout` (Yarn PnP) and `unverifiable` all mean the version is
unknown — say so and ask. None of them is a reason to go read a lockfile by hand; that is
exactly what this replaces.

## 2. Which tag each version is

```bash
refs tag <ref> <version> --json      # --package <name> in monorepos
```

Returns `{key, version, tag, ref_path}`, where `ref_path` is a git ref (`refs/tags/<tag>`),
not a filesystem path. Add `--package <name>` when the versions belong to one package of a
monorepo ref — tag conventions differ per package.

Two exits carry information rather than an error:

- **`4`** — no tag exists for that version under the applicable `tag_format`. Double-check
  the version string, then list nearby tags:
  `git tag -l '<prefix><major>.<minor>*' --sort=-version:refname`. Some releases are
  reachable only as version-bump commits in `git log`, never as tags.
- **`3`** — nothing maps versions onto tags for this ref at all. Look at the real tags
  (`git tag -l`); if a pattern is there, offer it to the user.
  `refs edit <ref> tag_format '<format>'` sets it for the whole ref (inherited by every
  package without its own), the `--package <name>` form for that package alone — in a
  monorepo tagging as `pkg@{version}` only the package form is right. If the repo simply
  does not tag, say so and answer from `git log`. Never invent a format.

**Sanity-check the resolved tags.** Tags can lie: a similarly-named tag may predate the actual
release. If a diff looks wrong for the claimed range — a zero diff, say — verify before
trusting it. `git show refs/tags/<tag>:<path-to-manifest>` should report the version you asked
about.

## 3. Diff the two tags

Read-only git in the checkout, worker or inline per the dosing rule (`SKILL.md` §6). Spell
tags fully qualified as `refs/tags/<tag>` (the returned `ref_path`) — a tag starting with `-`
would otherwise parse as an option.

```bash
# 1. Shape, from commit/tree metadata only — fetches nothing:
git log refs/tags/<old-tag>..refs/tags/<new-tag> --oneline --no-merges
git diff refs/tags/<old-tag>..refs/tags/<new-tag> --name-status --no-renames
#    ... add -- <package-path> in monorepos

# 2. Then content, where the question points (reads blobs; may fetch):
git show refs/tags/<new-tag>:CHANGELOG.md
git show <sha> -- <path>
git diff refs/tags/<old-tag>..refs/tags/<new-tag> -- <path>
```

If targeted content does not answer the question, a full diff is always available.
`--no-renames` is what keeps step 1 content-free: similarity detection would otherwise read
contents to find renames. `--stat` belongs in step 2, and scoping to `-- packages/<name>` in a
monorepo cuts fetching rather than only noise — both follow from the cost model in
`INVESTIGATE.md` §2.

## 4. Synthesize

As in `INVESTIGATE.md` §3. A worker returns only the compact output contract from §2 there —
commit list plus `path:line` highlights, never a pasted raw diff; inline, hold yourself to the
same discipline.
