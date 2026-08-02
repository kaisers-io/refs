# refs commands

The `--json` contract for the CLI version pinned in `SKILL.md`'s frontmatter. Shapes below
are the `data` payload only — always wrapped in the envelope.

## Envelope, streams, exit codes

```
{"ok":true,"data":<command-specific>,"warnings":[<string>]}
{"ok":false,"error":{"code":"<code>","message":"<string>"}}
```

In `--json` mode **both** envelopes go to stdout as one line — parse stdout only. (stderr
carries nothing but `refs add`'s progress lines.) `error.code` is `unexpected` | `usage` |
`validation` | `not_found` | `conflict`, matching exit `1` | `2` | `3` | `4` | `5`. `0` is
success.

Global flags: `--json` (always pass it) and `--verbose` (stack traces on error — omitted
from the per-command lists below; you never need it). `-h`/`--help` and `-V`/`--version`
are likewise omitted throughout.

Two failures reach almost every command and are **not** repeated in the per-command lists:

- **Unreadable config** — every command except `init`, `migrate`, and `doctor` reads
  `config.toml` to do its work, so each can exit `4` when no config exists yet (the
  message points at `refs init`) or `3` when the TOML is malformed or its schema version is
  one this CLI can't read. Don't assume the read comes first: `edit` reads inside the home
  lock, and `remove` re-reads under that lock after the checkout is already deleted. `init` and `migrate` create or migrate the config instead of
  requiring one, but still exit `3` if it is malformed beyond automatic migration. `doctor`
  reports the same condition as a `fail` on its `config` check rather than exiting.
- **Lock contention** — `init`, `migrate`, `add`, `edit`, and `remove` take the home (or a
  per-ref) lock, so each can exit `5` when another refs process holds it. `sync` is the
  exception: it reports a lock timeout as a per-item `failed` result, not a command failure.

Every command can exit `1` on an unexpected error; beyond that and the two above, only the
extra codes are listed per command.

## `refs init`

```
refs init
```

Creates the refs home and its `sources/`, `locks/`, and `hooks/` subdirectories, seeds or
migrates `config.toml`, installs the git hooks guard. Idempotent.

```json
{ "config": "seeded", "home": "/Users/you/.kaisers-io/refs", "skill_hint": "…" }
```

`config` is `"seeded"` | `"migrated"` | `"noop"`. No command-specific exit codes beyond the
shared `3`/`5` above.

## `refs add`

```
refs add <source> --dry-run
refs add --proposal <file|->
refs add <source> --description <text>
```

Two-phase by design: `--dry-run` proposes, `--proposal` finalizes. Exactly one mode flag
is required. `<source>` is a git url or `npm:<package>`; omit it with `--proposal`.
See `ADD.md` for the flow and the approval rule.

- `--dry-run` — resolve, clone, detect metadata, emit a proposal. Nothing is written to
  config yet; the checkout does exist afterwards.
- `--proposal <file>` — finalize from a completed proposal. `-` reads stdin. Accepts the
  bare proposal object **or** the whole `{ok, data, warnings}` envelope from the dry-run.
- `--description <text>` — one-shot dry-run + finalize, using `<text>` as the **top-level**
  description only. Fails (exit `3`) if any detected package lacks its own description.

`--dry-run` `data` (a proposal):

```json
{
  "default_branch": "master",
  "description": "",
  "key": "github.com/stevemao/left-pad",
  "packages": { "left-pad": { "path": "." } },
  "tag_format_candidate": "v{version}",
  "url": "https://github.com/stevemao/left-pad.git"
}
```

`description` starts `""`. A package with no detected description has **no `description`
key at all** — test for key presence, never falsiness. `tag_format_candidate` is `null`
when none was detected; finalizing then requires you to supply one.

`--proposal` / `--description` `data` (the finalized entry):

```json
{
  "entry": {
    "default_branch": "master",
    "description": "Left-pad a string.",
    "packages": { "left-pad": { "description": "Left-pad a string.", "path": "." } },
    "tag_format": "v{version}",
    "url": "https://github.com/stevemao/left-pad.git"
  },
  "key": "github.com/stevemao/left-pad"
}
```

Exit codes: `2` (no mode flag, more than one, or missing `<source>`), `3` (bad proposal
shape, missing `tag_format`, or `--description` with an undescribed package), `4`
(finalizing with no checkout on disk), `5` (ref already configured).

## `refs edit`

```
refs edit settings <key> <value>
refs edit <ref> <field> <value> [--package <name>]
```

Mutates exactly one field. `<ref>` is a full ref key or a unique suffix.

- settings keys: `clone_mode`, `git_transport`, `sync_ttl`.
- ref fields: `clone_mode`, `default_branch`, `description`, `git_transport`, `sync_ttl`,
  `tag_format`, `url` (the settings three are per-ref overrides). `packages` is not
  editable as a field — use `--package`.
- `--package <name>` fields: `description`, `path`, `tag_format`. Discover `<name>` with
  `refs show <ref> --packages --json`.

```json
{ "field": "sync_ttl", "key": "settings", "new": "2h", "old": "1h" }
```

`old`/`new` are `null` (never absent) for a previously unset field. Editing `url` must
derive the same ref key, else exit `3`. A ref whose suffix is literally `settings` is
shadowed by settings mode; that emits a `note:` warning.

Exit codes: `2` (unknown setting/field, or `--package` with `settings`), `3` (value fails
validation, or a re-keying `url`), `4` (ref/package not found).

## `refs list`

```
refs list [--packages]
```

`data` is an array, one item per ref, sorted by `key`:

```json
[
  {
    "clone_mode": "blobless",
    "description": "…",
    "key": "github.com/colinhacks/zod",
    "missing": false,
    "packages_count": 4,
    "stale": false
  }
]
```

`--packages` adds a sorted `packages: string[]` to each item. It is off by default because
a monorepo ref can carry 140 names; you almost never need them here. Reach for
`refs resolve <query> --json` instead — it does the package matching for you and returns
the single hit.

No command-specific exit codes beyond the shared `3`/`4` above — an unreadable config is a
top-level error, not a per-ref one.

## `refs doctor`

```
refs doctor
```

```json
{
  "checks": [{ "detail": "git version 2.50.1", "name": "git", "status": "ok" }]
}
```

Checks always run in this order: `git`, `node`, `config`, `hooks-guard`,
`dirty-checkouts`, `orphans`, `skill`, `ssh-auth` (the last only when some ref uses an ssh
url). `status` is `ok` | `warn` | `fail`; `MAINTAIN.md` explains each check.

The `skill` check reports whether this skill and the running CLI are in step. Every
non-`ok` `detail` carries the command that fixes it, but only a version mismatch it can
order names which side is behind — _not found in either agent home_ and _predates the
version gate_ name just the install command, and an unorderable pair (a prerelease on
either side) says to reinstall both.

Exit codes: `1` when any check is `fail` — even though the envelope stays `ok: true`.

## `refs migrate`

```
refs migrate
```

Migrates `config.toml` to the current schema, seeding it if absent — `init`'s config half,
standalone.

```json
{ "backup": "/Users/you/.kaisers-io/refs/config.toml.bak", "result": "migrated" }
```

`result` is `"seeded"` | `"migrated"` | `"noop"`; `backup` is `null` unless `"migrated"`.
No command-specific exit codes beyond the shared `3`/`5` above.

## `refs remove`

```
refs remove <ref>
```

**Destructive**: deletes the config/state entry _and_ the checkout directory. No partial
mode. Confirm with the user first (`MAINTAIN.md`).

```json
{ "key": "github.com/colinhacks/zod", "removed_checkout": true }
```

An already-missing checkout is a warning, not an error; removal still proceeds.

Exit codes: `2` (ambiguous suffix), `4` (no ref matches).

## `refs resolve`

```
refs resolve <query>
```

The routing command — start here. `<query>` is a git url, an exact npm package name, an
import path (`react/jsx-runtime`, `@scope/pkg/sub/path` — longest segment prefix wins), or
a unique ref-key suffix, tried in that order.

```json
{
  "key": "github.com/colinhacks/zod",
  "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod",
  "missing": false,
  "package": {
    "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod/packages/zod",
    "name": "zod",
    "path": "packages/zod"
  },
  "stale": false
}
```

`package` is `null` when the query resolved to the ref itself rather than one of its
packages.

Exit codes: `2` (matches more than one ref/package), `3` (looks like a git url but is not
a supported form), `4` (no match — the ref isn't tracked; see `ADD.md`).

## `refs show <ref>`

```
refs show <ref> [--packages] [--tags]
```

`data` is the ref's config entry **minus** `packages`, plus `key`, `local_path`,
`packages_count`, and `state`.

- `--packages` adds the full `packages` map (`path`, `description`, optional `tag_format`
  per package). This is the only way to discover package names for
  `refs edit <ref> <field> --package <name>`.
- `--tags` adds `sample_tags` (up to five recent tags) in `--json` mode. Off by default
  because producing it costs a `git tag` subprocess. Human output always probes for them,
  but only prints a `tags:` line when the probe found any.

```json
{
  "default_branch": "main",
  "description": "…",
  "key": "github.com/colinhacks/zod",
  "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod",
  "packages_count": 4,
  "state": {
    "effective_clone_mode": "blobless",
    "head_sha": "2fca6157fcca165438e0f9495cf0e5a4e6f71349",
    "last_fetched_at": "2026-07-05T06:28:47.633Z"
  },
  "tag_format": "v{version}",
  "url": "https://github.com/colinhacks/zod.git"
}
```

Every `state` field is optional (`{}` for a never-synced ref); it can also carry
`last_error` and `pending_proposal_at`. A ref may additionally carry `clone_mode`,
`git_transport`, or `sync_ttl` overrides. If tags were requested but unlistable,
`sample_tags` degrades to `[]` plus a warning.

Exit codes: `2` (ambiguous suffix), `4` (no ref matches).

## `refs sync`

```
refs sync [refs...] [--stale-only]
```

Fetches, or re-clones a missing checkout. Defaults to every configured ref; name keys or
unique suffixes to narrow. `--stale-only` skips refs still inside their `sync_ttl` that
also have a checkout — a missing checkout is always re-cloned. Up to 4 refs at a time.

```json
{
  "results": [
    { "key": "github.com/colinhacks/zod", "status": "updated" },
    { "key": "github.com/stevemao/left-pad", "error": "…", "status": "failed" }
  ]
}
```

`status` is `updated` | `fresh` | `cloned` | `restored` | `failed`. `error` is present only
on `failed`; `warning` (branch rename, partial-clone fallback) only on the others. A
ref filtered out by `--stale-only` produces no item at all.

Exit codes: `1` when any item is `failed` — the envelope stays `ok: true`, so check both.
`2`/`4` for an ambiguous/unmatched `[refs...]` argument, which aborts before any sync runs.

## `refs tag`

```
refs tag <ref> <version> [--package <name>]
```

Resolves a version to the git tag it maps to, by rendering the applicable `tag_format` and
verifying the tag exists in the checkout. `--package <name>` uses that package's
`tag_format` when it overrides the ref's.

```json
{
  "key": "github.com/colinhacks/zod",
  "ref_path": "refs/tags/v4.1.0",
  "tag": "v4.1.0",
  "version": "4.1.0"
}
```

Always pass tags to git as `ref_path` (`refs/tags/<tag>`) — a bare tag starting with `-`
parses as an option.

Exit codes: `2` (ambiguous suffix), `4` (ref/package not found, checkout missing, or no
such tag — see `INVESTIGATE.md` before concluding the release doesn't exist).
