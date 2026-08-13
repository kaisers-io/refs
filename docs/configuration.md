# Configuration

`refs` keeps all of its state under one directory, the **refs home**. Everything else in
this document — `config.toml`, `state.json`, the `sources/` checkouts, locks, hooks — lives
inside it.

## `REFS_HOME`

The refs home defaults to:

```
~/.kaisers-io/refs
```

Set `REFS_HOME` to override it. Every path `refs` uses, meaning the config, the state file,
the checkouts, the locks and the hooks, is derived from this one root, so overriding it
relocates the whole tool:

```bash
export REFS_HOME=/path/to/somewhere
```

On Windows, PowerShell needs its own syntax, and the obvious form only lasts as long as the
window stays open:

```powershell
$env:REFS_HOME = "C:\refs"      # this session only
```

To keep it, write it to your user environment once:

```powershell
[Environment]::SetEnvironmentVariable('REFS_HOME', 'C:\refs', 'User')
```

Sessions started before that call keep the old value, so open a new shell afterwards.

The default is deliberately `~/.kaisers-io/refs`, not the shorter `~/.refs`: "refs" is a
generic word that overlaps git's own `refs/` terminology (branches, tags, `refs/heads/`,
`refs/remotes/`, …), which makes an unqualified `~/.refs` ambiguous in agent-facing
contexts — a coding agent reasoning about "refs" in a prompt has no way to tell whether it
means this tool or git's own ref namespace. The org-namespaced default keeps every path
this tool touches unambiguous. `REFS_HOME` always overrides this default, so you are never
stuck with it.

## Other environment variables

`REFS_HOME` is the only one meant for everyday use. Four others are read:

| Variable                | Read by                | Effect                                                                                                                                       |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CONFIG_DIR`     | `refs doctor` only     | Moves where the `skill` check looks for a Claude Code install, replacing `~/.claude`. Set by the skill installer's own convention, not by refs. |
| `CODEX_HOME`            | `refs doctor` only     | The same, for Codex, replacing `~/.codex`.                                                                                                     |
| `REFS_UPDATE_CHECK`     | `refs sync`, `refs doctor` | `0` never contacts the npm registry, `1` always does. Overrides `[updates].check`; any other value is ignored. See [`[updates]`](#updates). |
| `REFS_ALLOW_FILE_URLS`  | `refs add`, `refs sync` | Set to `1` to accept `file://` sources. **A test-only escape hatch** — real remotes are `https`/`ssh`, and this exists so the suite and the packaged-CLI smoke tests can work against a local fixture repository without a network. Do not set it in normal use. |

## Home directory layout

```
$REFS_HOME/
├── config.toml     # user-authored: refs, settings, updates, meta
├── state.json      # machine-managed: per-ref fetch/head state (self-healing, never hand-edit)
├── sources/         # managed checkouts, one directory tree per ref key
├── locks/           # advisory lock files (per-ref and a shared 'home' lock)
├── cache/           # discardable: the last answer from the npm update check
└── hooks/           # the pre-commit/pre-push guard scripts refs installs into every checkout
```

`refs init` creates the config (seeded or migrated) and the three directories, writing the
guard scripts into `hooks/` as it goes. It does **not** create `state.json` — that appears
the first time a ref is added or synced. `init` is safe to re-run, and is what a fresh
clone of this repo's own dev environment should run first.

## `config.toml`

This is the exact template `refs init` seeds when no config exists yet (`cli_version` is
stamped with whatever `refs` version ran the seed):

```toml
# refs configuration
#
# Every global setting under [settings] can also be set per-ref: add the same
# key directly inside a [refs."host/owner/repo"] table to override it just for
# that ref — every global setting is per-ref overridable.

[meta]
schema_version = 1
cli_version = "0.1.0"

[settings]
# Clone strategy for newly added refs. One of "blobless" (partial clone, default) or "full".
clone_mode = "blobless"
# Transport for npm:-resolved adds: their clone url is rewritten to this before cloning.
# One of "https" (default) or "ssh" (for private-package setups with forge ssh keys).
# Explicitly-typed git urls are always used verbatim.
git_transport = "https"
# How long a ref's fetched state is considered fresh before refs re-fetches it.
# Format: <n>m, <n>h, or <n>d (e.g. "30m", "1h", "1d"). Default: "1h".
sync_ttl = "1h"

[refs]
# Add refs here, one table per ref, keyed by "host/owner/repo". Example:
#
# [refs."github.com/owner/repo"]
# description = "Short description of the repo."
# url = "https://github.com/owner/repo"
# default_branch = "main"
# tag_format = "v{version}"   # optional — omit it if the repo has no usable tag pattern
# # Per-ref overrides of [settings] go in the same table, e.g.:
# # clone_mode = "full"
```

`refs add` is what actually populates `[refs]` (see [`docs/commands.md`](commands.md)'s
two-phase add contract) — you rarely hand-write a `[refs."..."]` table yourself, but the
shape is worth knowing since `refs edit` and `refs show --json` operate on it directly —
though `refs show --json` reports only `packages_count` by default and returns the full
`[refs."...".packages]` map under `--packages`. A fully-populated ref entry, including a
registered package and a per-ref settings override, looks like this:

```toml
[refs."github.com/colinhacks/zod"]
description = "TypeScript-first schema validation"
url = "https://github.com/colinhacks/zod.git"
default_branch = "main"
tag_format = "v{version}"
# Per-ref override: this ref always uses a full clone, regardless of [settings].clone_mode.
clone_mode = "full"

[refs."github.com/colinhacks/zod".packages.zod]
description = "TypeScript-first schema validation"
path = "packages/zod"
# A package can override the ref's own tag_format; omitted here, so it inherits the ref's.
```

### `[meta]`

| Field            | Meaning                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | Config schema version. `refs migrate` seeds/migrates it; a version older or newer than the CLI's own is a validation error telling you which of `refs migrate`/upgrading `refs` to run. |
| `cli_version`    | The `refs` version that last wrote this file. Restamped by `refs init` and `refs migrate` when it differs; other commands leave it as they found it, so after an upgrade it lags until one of those runs. Never hand-edit.                                    |

### `[refs."host/owner/repo"]` fields

| Field            | Required | Meaning                                                                                                                                                                                                                                                              |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`    | yes      | Short human/agent-facing description.                                                                                                                                                                                                                                |
| `url`            | yes      | The canonical clone URL (rewritten by `refs edit <ref> url <value>`, which refuses a URL that would derive a different ref key).                                                                                                                                     |
| `default_branch` | yes      | The ref's default branch, detected at `add` time (auto-updated by `sync` if the remote's default branch is renamed).                                                                                                                                                 |
| `tag_format`     | no       | A template containing `{version}`, e.g. `v{version}`, used by `refs tag` to resolve a version to a git tag. Absent for a repository that publishes no tags, or none in a describable shape: `refs tag` then exits `3`, and nothing else is affected. `refs edit` can set one but has no unset — removing a recorded format means deleting the line from this file.  |
| `packages`       | no       | A map of package name → `{ description, path, tag_format? }`, for repos (typically monorepos) that register one or more importable packages. A package's `tag_format` overrides the ref's own for that package only; when absent it inherits the ref's `tag_format`. |
| _(settings)_     | no       | `clone_mode` or `sync_ttl` — see below. (`git_transport` is expressible here but has no effect; see the note under `[settings]`.)                                                                                                                                    |

### `[settings]` reference

**The rule: every global setting under `[settings]` is per-ref overridable.** This isn't a
convention documented alongside a schema that could drift from it — it's structural. The
per-ref override schema (`zRefSettingsOverride` in `packages/core/src/schemas/config.ts`)
is _derived_ from the global settings schema (`zSettings`) by stripping each field's
default and making it optional, rather than hand-written as a separate list of fields.
There is no way for a setting to exist globally without also being expressible per-ref:
adding a new global setting to `zSettings` automatically makes it per-ref overridable too.

A per-ref override lives directly inside that ref's `[refs."..."]` table (see the
`zod` example above, which overrides `clone_mode`). Resolution is: **ref override, if
present, else the global setting** — this is `resolveSetting(key, ref, settings)`, read
that way by `add`, `list`, `sync`, `resolve` and `show`.

**`git_transport` is the exception, and structurally so.** Being expressible per-ref does
not make it effective per-ref: it is only ever consulted while `refs add` rewrites an
`npm:`-resolved URL, and at that moment there is no existing ref whose override could be
read — `add` refuses a key that is already configured. A `git_transport` written into a
`[refs."..."]` table is therefore accepted, stored and echoed back by `refs show`, and
changes nothing. Set it globally under `[settings]`.

| Setting         | Values             | Default    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clone_mode`    | `blobless`, `full` | `blobless` | Clone strategy for newly added refs. `blobless` is a partial clone (`--filter=blob:none`) — fast, and lazily fetches blob contents on demand; `full` clones everything up front.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `git_transport` | `https`, `ssh`     | `https`    | Transport applied to **`npm:`-resolved** clone URLs at `refs add` time: the registry's repository URL is rewritten to this transport before cloning and before being stored as the entry's `url` (`ssh` yields the scp form `git@host:path.git`; the canonical ref key is never changed by the rewrite). An explicitly-typed git URL is **never** rewritten — typing the URL is choosing the transport. A URL whose non-default port can't survive the rewrite is rejected with a validation error. Changing this setting later affects only future adds: existing refs keep their stored `url` (and their checkout's remote) until `refs edit <ref> url …` rewrites it. |
| `sync_ttl`      | duration string    | `1h`       | How long a ref's last-fetched state is considered fresh before `refs sync`/`refs list`/`refs resolve`/`refs show` treat it as stale. Format: `<n>m`, `<n>h`, or `<n>d` (e.g. `30m`, `1h`, `1d`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Change a global setting with `refs edit settings <key> <value>`; change a per-ref override
with `refs edit <ref> <field> <value>` (same field names — see
[`docs/commands.md`](commands.md)).

### `[updates]`

```toml
[updates]
check = true    # ask npm whether a newer refs is published
notify = true   # let a routine command mention it
```

Both default to `true`, and the table is absent from a config that wants those defaults.

`check` governs the network request. With it off, refs never contacts the registry. `notify`
governs only whether a routine command interrupts with the news: with `check = true` and
`notify = false`, `refs sync` stays quiet and `refs doctor` still answers — asking for a health
report is asking.

`REFS_UPDATE_CHECK` overrides `check`: `0` off, `1` on. Any other value falls through to the config,
so a typo cannot silently disable it. Without either, the check is on everywhere except CI, which
is detected from a `CI` variable set to anything but `false` or `0`.

The request goes to `registry.npmjs.org` — hardcoded, not read from npm configuration — at most once
a day, and its answer is cached in `<refs home>/cache/update-check.json`. That file is discardable:
deleting it costs one round-trip. A failed or unreachable request changes nothing and is never
reported as a fault.

## `state.json`

Machine-managed, self-healing — never hand-edit it, and never rely on any particular
formatting: a missing file, unparsable JSON, or a schema-invalid document all fall back
silently to empty state (`{"refs":{}}`) rather than erroring, since there's nothing a user
could meaningfully "fix" in response to a thrown error here.

Shape: `{ "refs": { "<ref-key>": <RefState>, ... } }`, where each `RefState` is:

| Field                  | Meaning                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `effective_clone_mode` | The clone mode actually used for this ref's checkout (may differ from the resolved setting if a blobless clone fell back to full). |
| `head_sha`             | The checkout's HEAD commit at last successful fetch/clone.                                                                         |
| `last_fetched_at`      | ISO-8601 timestamp of the last successful `sync`/`add`/`add --proposal` — this, plus `sync_ttl`, is what determines staleness.     |
| `last_error`           | The last sync failure's message, if the most recent `sync` attempt for this ref failed.                                            |
| `pending_proposal_at`  | Set by `refs add --dry-run` while a proposal is awaiting `--proposal`/`--description` finalization; cleared once finalized.        |

Every field is optional — a ref with no state entry yet (just added, never synced) is
simply absent from `state.refs`.
