# refs commands

The `--json` contract for the CLI version pinned in `SKILL.md`'s frontmatter. Shapes below
are the `data` payload only — always wrapped in the envelope.

Every JSON block here is illustrative output, showing the shape a command returns. The
keys, urls, and paths in them are placeholders (`example-org/…`) — not repositories this
skill fetches, tracks, or suggests. Real ones come from the user's own config, via
`refs list`, `refs resolve`, or `refs show`.

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
migrates `config.toml`, writes the git hooks guard. Everything it touches lives inside the
refs home; it changes nothing elsewhere on the machine. Idempotent.

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
  "key": "github.com/example-org/example-lib",
  "packages": { "example-lib": { "path": "." } },
  "tag_format_candidate": "v{version}",
  "url": "https://github.com/example-org/example-lib.git"
}
```

`description` starts `""`. A package with no detected description has **no `description`
key at all** — test for key presence, never falsiness. `tag_format_candidate` is `null`
when none was detected; it finalizes to a ref with no `tag_format`, which is a valid entry.
Don't fill one in to make it look complete (`ADD.md` §3).

`--proposal` / `--description` `data` (the finalized entry):

```json
{
  "entry": {
    "default_branch": "master",
    "description": "Pads a string on the left.",
    "packages": { "example-lib": { "description": "Pads a string on the left.", "path": "." } },
    "tag_format": "v{version}",
    "url": "https://github.com/example-org/example-lib.git"
  },
  "key": "github.com/example-org/example-lib"
}
```

Exit codes: `2` (no mode flag, more than one, or missing `<source>`), `3` (bad proposal
shape, an invalid `tag_format_candidate`, or `--description` with an undescribed package),
`4` (finalizing with no checkout on disk), `5` (ref already configured).

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
    "key": "github.com/example-org/example-monorepo",
    "last_fetched_at": "2026-07-05T06:28:47.633Z",
    "missing": false,
    "packages_count": 4,
    "stale": false
  }
]
```

`last_fetched_at` is absent for a ref that has never been synced. `--packages` adds a
sorted `packages: string[]` to each item. It is off by default because
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
`dirty-checkouts`, `config-drift`, `orphans`, `locks`, `skill`, `cli-update`, `ssh-auth` (the last only when some ref
uses an ssh url). `status` is `ok` | `warn` | `fail`; `MAINTAIN.md` explains each check.

The `skill` check reports whether this skill and the running CLI are in step. Every
non-`ok` `detail` carries the command that fixes it, but only a version mismatch it can
order names which side is behind — _not found in any checked location_ and _predates the
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
{ "key": "github.com/example-org/example-monorepo", "removed_checkout": true }
```

An already-missing checkout is a warning, not an error; removal still proceeds.

Exit codes: `2` (ambiguous suffix), `4` (no ref matches).

## `refs resolve`

```
refs resolve <query> [--ref <ref>] [--project <dir>] [--sync-if-stale] [--json]
```

Routes a git URL, npm package name, import path, or unique ref-key suffix to the one ref (and,
where applicable, package) it denotes.

| Option            | Use it when                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--sync-if-stale` | Always, for investigation. Fetches or clones only when needed, and everything reported describes the checkout **after** that — which is why there is no longer a second `resolve` call. |
| `--ref <ref>`     | A package name is registered by more than one ref. The ambiguity error names this flag; it scopes the query to that ref's packages.                                                     |
| `--project <dir>` | You need the version the user's project has installed. `<dir>` is the importing directory — the workspace package in a monorepo, not the repo root.                                     |

`--json` data:

```json
{
  "key": "github.com/colinhacks/zod",
  "local_path": "/…/sources/github.com/colinhacks/zod",
  "checkout": { "status": "managed" },
  "missing": false,
  "stale": false,
  "last_fetched_at": "2026-08-30T10:00:00.000Z",
  "sync": { "status": "updated" },
  "package": {
    "name": "zod",
    "path": "packages/zod",
    "local_path": "/…/packages/zod",
    "status": "verified"
  },
  "installed": {
    "status": "found",
    "name": "zod",
    "version": "3.23.8",
    "package_json": "/…/node_modules/zod/package.json"
  }
}
```

`sync` appears only when a sync ran; `installed` only with `--project`; `package` is `null` when
the query resolves to the ref itself.

**Gate on `checkout.status` before reading anything.** `managed` means the path really is this
ref's checkout. `unmanaged` (`reason`: `no_refs_marker`, `origin_mismatch`, `no_origin`,
`git_is_file`, `git_is_symlink`, `outside_sources`) means something else is there — do not read it
and do not sync it. `unverifiable` (`path_unreadable`, `git_unreadable`, `config_unreadable`,
`config_malformed`, `duplicate_config_values`) means it could not be inspected. Package verification is gated on the
same thing, so anything but `managed`/`missing` yields `package.status: "unverifiable"`.

`installed.status` is one of `found`, `not_materialized` (nothing installed there),
`unsupported_layout` (Yarn PnP), `unverifiable` (`manifest_unreadable`, `manifest_has_no_version`,
`slot_unreadable`, `unsupported_package_name`). None
of the last three is a reason to read a lockfile instead — say the version is unknown and ask.

Package statuses (`verified`, `relocated`, `unmaterialized`, `unverifiable`, `ambiguous`,
`missing`) are unchanged; see `INVESTIGATE.md` §1 for how to act on each.

Exit codes: `0`, `2` (ambiguous package name, or `--project` on a query that names a ref rather
than a package), `3` (a `--sync-if-stale` refused because the checkout is not this ref's), `4` (no
match), `5` (a `--sync-if-stale` that could not take the ref's lock, or lost it mid-operation).

## `refs show <ref>`

```
refs show <ref> [--packages] [--tags]
```

`data` is the ref's config entry **minus** `packages`, plus `key`, `local_path`, `missing`,
`packages_count`, `stale`, and `state`.

- `--packages` adds the full `packages` map (`path`, `description`, optional `tag_format`
  per package), which is one way to discover package names for
  `refs edit <ref> <field> --package <name>` — `refs list --packages --json` gives the same
  names for every ref at once, and `refs resolve <pkg> --json` returns just the matching one.
- `--tags` adds `sample_tags` (up to five recent tags) in `--json` mode. Off by default
  because producing it costs a `git tag` subprocess. Human output always probes for them,
  but only prints a `tags:` line when the probe found any.

```json
{
  "default_branch": "main",
  "description": "…",
  "key": "github.com/example-org/example-monorepo",
  "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/example-org/example-monorepo",
  "missing": false,
  "packages_count": 4,
  "stale": false,
  "state": {
    "effective_clone_mode": "blobless",
    "head_sha": "0000000000000000000000000000000000000000",
    "last_fetched_at": "2026-07-05T06:28:47.633Z"
  },
  "tag_format": "v{version}",
  "url": "https://github.com/example-org/example-monorepo.git"
}
```

Every `state` field is optional (`{}` for a never-synced ref); it can also carry
`last_error` and `pending_proposal_at`. A ref may additionally carry `clone_mode`,
`git_transport`, or `sync_ttl` overrides — though a per-ref `git_transport` is inert, since
only `refs add` reads it and that runs before the ref exists. If tags were requested but the
checkout is missing, `sample_tags` is `[]` with no warning; the warning appears only when
`git tag` itself fails.

Exit codes: `2` (ambiguous suffix), `4` (no ref matches).

## `refs sync`

```
refs sync [refs...] [--stale-only]
```

Fetches, or re-clones a missing checkout. Defaults to every configured ref; name keys or
unique suffixes to narrow. `--stale-only` skips refs still inside their `sync_ttl` that
also have a checkout — a missing checkout is always re-cloned. Up to 4 refs at a time.

This is also where a newer published CLI surfaces: at most once a day, `warnings` may carry
one line naming the version and the command to install it. Relay it to the user and carry on
— it says nothing about the refs that were synced, and nothing about it is yours to run.

```json
{
  "results": [
    {
      "key": "github.com/example-org/example-monorepo",
      "status": "updated",
      "structure": {
        "packages": [
          { "configured_path": "packages/old", "name": "@example/old", "status": "missing" }
        ],
        "status": "drift"
      }
    },
    { "key": "github.com/example-org/example-lib", "error": "…", "status": "failed" }
  ]
}
```

`status` is `updated` | `fresh` | `cloned` | `restored` | `failed`. `error` is present only
on `failed`; `warning` (branch rename, partial-clone fallback) only on the others. A
ref filtered out by `--stale-only` produces no item at all.

`structure` is on every non-`failed` item: whether the ref's configured package paths still
match the checkout that was just synced. Nothing is persisted, and only refs that actually
sync are probed. `structure.status` is `ok` (no `packages` key at all), `drift`, or
`unknown`. Each entry in `packages` says what to do about one package:

| `status`       | Means                                              | Tell the user                                           |
| -------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `missing`      | declared nowhere in the repo's workspaces any more | remove the entry, unless it moved out of the workspaces |
| `relocated`    | now declared at `path` instead                     | change the entry's `path` to `path`                     |
| `ambiguous`    | several `candidates` declare that name             | pick one and set it                                     |
| `unverifiable` | could not be checked (`reason`)                    | nothing — it is not a claim about the package           |

Never treat `missing` and `relocated` alike: `relocated` names the new path, so there is
nothing to look for. `missing` means the name is not in any _declared workspace_ — usually a
deletion, occasionally a move to a directory the workspace patterns no longer cover, which
`git log --diff-filter=D -- <configured path>` settles in one command. Drift does not affect
the exit code.

Exit codes: `1` when any item is `failed` — the envelope stays `ok: true`, so check both.
`2`/`4` for an ambiguous/unmatched `[refs...]` argument, which aborts before any sync runs.

## `refs tag`

```
refs tag <ref> <version> [--package <name>]
```

Resolves a version to the git tag it maps to, by rendering the applicable `tag_format` and
verifying the tag exists in the checkout. `--package <name>` uses that package's
`tag_format` when it overrides the ref's.

`tag_format` is optional, so a ref may have none — this is the only command that needs it.

```json
{
  "key": "github.com/example-org/example-monorepo",
  "ref_path": "refs/tags/v4.1.0",
  "tag": "v4.1.0",
  "version": "4.1.0"
}
```

Always pass tags to git as `ref_path` (`refs/tags/<tag>`) — a bare tag starting with `-`
parses as an option.

Exit codes: `2` (ambiguous suffix), `3` (no `tag_format` configured for the ref, or for the
named package with none to inherit), `4` (ref/package not found, checkout missing, or no
such tag — see `INVESTIGATE.md` before concluding the release doesn't exist).

The `3`/`4` split is the useful one: `3` means this ref cannot resolve any version, `4`
means this particular version was never tagged.
