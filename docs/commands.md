# Command reference

`refs --help` and `refs <command> --help` are always the authoritative, up-to-date
synopsis — this document mirrors them and adds the `--json` data shapes and exit codes
that `--help` doesn't show.

Every command accepts these global options, in addition to its own:

| Option      | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `--json`    | Emit a machine-readable JSON envelope on stdout instead of human text. |
| `--verbose` | Include stack traces in error output.                                  |
| `-V`, `--version` | Print the CLI version and exit — what the skill's capability gate reads. |
| `-h`, `--help`    | Print usage for the CLI or for one command.                              |

## The JSON envelope

With `--json`, every command emits exactly one line of JSON on stdout:

- Success: `{"ok":true,"data":<command-specific>,"warnings":[<string>, ...]}`
- Failure: `{"ok":false,"error":{"code":"<ErrorCode>","message":"<string>"}}`

Errors always go to stdout in `--json` mode (never stderr), so a script only ever needs to
read one stream. In human mode, output goes to stdout, warnings go to stderr as
`refs: warning: <text>`, and errors go to stderr as `refs: <message>`.

## Exit codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | OK                                                                                       |
| `1`  | Unexpected error (including: a `sync`/`doctor` batch with per-item failures — see below) |
| `2`  | Usage error (bad arguments/flags)                                                        |
| `3`  | Validation error (bad input value, malformed config)                                     |
| `4`  | Not found (no matching ref/package/checkout)                                             |
| `5`  | Conflict (e.g. `refs add` on an already-configured ref)                                  |

**`sync` and `doctor` are special.** Both run a batch of independent checks/operations
that are individually allowed to fail without aborting the rest — a per-item failure is
not itself a _command_ failure, so the JSON envelope is still `{"ok":true,...}`. But the
process still exits `1` if anything in the batch failed, so a caller that only checks the
exit code (rather than inspecting `data`) still sees the failure. **Always check both**:
the envelope's `ok`/`data` for what happened, and the exit code for whether to treat the
whole invocation as failed.

---

## `refs init`

```
refs init
```

Seeds the refs home directory (config, `sources/`, `locks/`, `hooks/`) if absent —
`state.json` is written later, by the first `add`/`sync` —
migrates the config to the current schema if it's older, installs the git hooks guard,
and is safe to re-run — a repeat call is a no-op wherever nothing needed to change.

```bash
refs init
```

```
home: /Users/you/.kaisers-io/refs
config: seeded

Install the agent skill: npx skills add kaisers-io/refs   (from a local clone: npx skills add <path-to-this-repo> --skill refs)
```

A blank line separates the `home:`/`config:` block from the skill-install hint. On a
repeat call where nothing changed, human output prints `config: unchanged` — the `--json`
envelope still reports `"noop"` for the same case (see below); the human word and the JSON
value are deliberately not the same string, the same way `path:` in `show`/`resolve`
corresponds to the JSON field `local_path`.

```bash
refs init --json
```

```json
{
  "ok": true,
  "data": {
    "config": "seeded",
    "home": "/Users/you/.kaisers-io/refs",
    "skill_hint": "Install the agent skill: npx skills add kaisers-io/refs   (from a local clone: npx skills add <path-to-this-repo> --skill refs)"
  },
  "warnings": []
}
```

`data.config` is one of `"seeded"` (no config existed), `"migrated"` (an older schema was
upgraded, with a `.bak` backup left alongside it), or `"noop"` (already current). Human
output renders `"noop"` as `config: unchanged` — see the human example above.

Exit codes: `0`, `3` when an existing config can't be migrated (malformed TOML, a schema
newer than this CLI supports, or a shape beyond automatic migration), or `1` for an
unexpected error. There is no `4` here — an absent config is seeded, not an error.

---

## `refs add`

```
refs add [source] [--dry-run] [--proposal <file>] [--description <text>]
```

Adds a git reference in **two phases**: propose, then finalize. Exactly one of
`--dry-run`, `--proposal`, or `--description` is required.

1. **Propose** (`refs add <source> --dry-run`): resolves `<source>` (a git URL, or
   `npm:<package>` — an npm-resolved clone URL is rewritten to the configured
   `git_transport` first; an explicitly-typed URL is used verbatim), clones it
   (idempotently — a healthy existing checkout is reused, not re-cloned), detects its
   default branch, tag-format candidate, and any workspace packages, and writes a
   reviewable `Proposal` — nothing is added to `config.toml` yet. The checkout itself,
   however, does exist on disk after this step.
2. **Finalize** (`refs add --proposal <file|->`): reads a completed proposal (edited by a
   human/agent to fill in `description`), re-verifies the checkout's identity, and writes
   the ref into `config.toml`/`state.json`.

`--description <text>` is a one-shot convenience that runs both phases in one process,
using `<text>` as the **top-level** ref description and skipping proposal review — for
when you already know what you want. It only works when every DETECTED package (if any)
already carries its own **non-empty** description from its manifest (an empty
`"description": ""` — the `npm init -y` scaffold — counts as missing): `<text>` is never
used as a per-package fallback. If one or more detected packages lack a description —
including a single-package repo whose lone package has none — the one-shot fails with a
validation error naming every affected package; run the two-phase flow instead, filling
in each package's description in the proposal file before finalizing. A source with no
detected packages (a plain, non-workspace repo) is unaffected — there's nothing to check.
Note that an `npm:<pkg>` source without detected workspace packages can effectively never
use the one-shot: its single seeded package entry is derived from the npm resolution
alone and never carries a description, so such sources always need the two-phase flow.

### Examples

```bash
# Phase 1: propose
refs add npm:zod --dry-run --json > proposal.json

# (edit proposal.json — fill in description)

# Phase 2: finalize
refs add --proposal proposal.json --json
# or finalize from stdin:
cat proposal.json | refs add --proposal - --json

# One-shot (skips proposal review; works here because left-pad is a plain,
# non-workspace repo — there are no per-package descriptions to check):
refs add https://github.com/stevemao/left-pad --description "Left-pad a string." --json
```

### `--json` data shape

**`--dry-run`** — a `Proposal`:

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "url": "https://github.com/stevemao/left-pad",
    "default_branch": "master",
    "tag_format_candidate": "v{version}",
    "description": "",
    "packages": {}
  },
  "warnings": []
}
```

`tag_format_candidate` is `null` when no reliable tag format was detected — either the
repository publishes no tags, or its tags follow no pattern a format can express. It
finalizes to a ref with no `tag_format`, which is a complete entry: only `refs tag` reads
the field, and it reports the absence itself. Supplying one is worthwhile when you know the
convention and the detector missed it, and wrong when the repository simply has no
releases. `packages` entries are partial (`description` optional) until finalized.

**`--proposal`/`--description`** — the finalized entry:

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "entry": {
      "description": "Left-pad a string.",
      "url": "https://github.com/stevemao/left-pad",
      "default_branch": "master",
      "tag_format": "v{version}",
      "packages": {}
    }
  },
  "warnings": []
}
```

### Proposal file shape (for hand-editing between phases)

The file passed to `--proposal` must validate as a `FinalProposal`: `key`, `url`,
`default_branch`, `tag_format_candidate` (a real tag format, or `null`), a non-empty
`description`, and a `packages` map whose entries each have a
non-empty `description` and a `path`. `--proposal` accepts either that bare object, or the
full `--json` envelope wrapping it (`{ok, data, warnings}`) — the exact stdout of
`refs add ... --dry-run --json`, so it can be piped straight through without stripping the
envelope first.

Exit codes: `2` (neither/more than one of `--dry-run`/`--proposal`/`--description` given,
or `<source>` missing), `3` (invalid proposal JSON/shape, or — `--description` only — one
or more detected packages lack a description), `4` (finalizing
a source whose checkout is missing), `5` (the ref is already configured).

---

## `refs edit`

```
refs edit settings <key> <value>
refs edit <ref> <field> <value> [--package <name>]
```

Mutates exactly one field, in one of three modes:

- `refs edit settings <key> <value>` — a global setting (`clone_mode`, `git_transport`,
  `sync_ttl`).
- `refs edit <ref> <field> <value>` — a top-level ref field (`description`, `url`,
  `default_branch`, `tag_format`, or a per-ref settings override).
- `refs edit <ref> <field> <value> --package <name>` — a field on one of the ref's
  registered packages (`description`, `path`, `tag_format`).

Editing `url` re-canonicalizes the value and rejects it if it would derive a _different_
ref key (use `refs remove` + `refs add` to re-key a ref); if a checkout already exists, its
`origin` remote is rewritten to match.

### Examples

```bash
refs edit settings sync_ttl 2h --json
refs edit zod description "TypeScript-first schema validation" --json
refs edit zod clone_mode full --json          # per-ref settings override
refs edit zod description "..." --package zod --json
```

### `--json` data shape

```json
{
  "ok": true,
  "data": { "key": "settings", "field": "sync_ttl", "old": "1h", "new": "2h" },
  "warnings": []
}
```

```json
{
  "ok": true,
  "data": {
    "key": "github.com/colinhacks/zod",
    "field": "description",
    "old": "...",
    "new": "..."
  },
  "warnings": []
}
```

`old`/`new` are `null` (never `undefined`) for a field that wasn't previously set. A ref
reachable by the literal suffix `settings` (e.g. `github.com/acme/settings`) can never be
addressed via `refs edit settings ...` — that always dispatches to the global settings —
so the response may carry a `note:` warning naming the shadowed ref.

Exit codes: `2` (unknown setting/field name, `--package` combined with `settings` mode),
`3` (value fails schema validation, new `url` derives a different key), `4` (ref/package
not found).

---

## `refs list`

```
refs list [--packages]
```

Lists every configured ref with its resolved clone mode, staleness, and missing-checkout
status.

```bash
refs list
```

```
ref: github.com/colinhacks/zod
description: TypeScript-first schema validation
synced: 3 hours ago
status: stale

ref: github.com/vercel/next.js
description: Next.js, the React framework by Vercel
synced: 12 minutes ago
```

One blank line between entries, none after the last one. An empty config prints
`no refs configured — run: refs add <source>` instead. `list` never shows `url:` or
`path:` — that's what `show` is for.

Each entry's state lines follow the same rule used by `show` and `resolve`, up to three
lines, in this order, each shown only when it applies:

| Line | When |
| --- | --- |
| `synced: <when>` | always — `never`, `just now`, or `N minutes/hours/days/years ago`, always rounded down |
| `status: stale` | only past the ref's effective `sync_ttl`, and never together with `synced: never` |
| `missing: checkout not found — run: refs sync` | only when the checkout directory has no `.git` |

```bash
refs list --json
```

```json
{
  "ok": true,
  "data": [
    {
      "key": "github.com/colinhacks/zod",
      "description": "TypeScript-first schema validation",
      "clone_mode": "blobless",
      "missing": false,
      "stale": false,
      "last_fetched_at": "2026-07-05T06:28:47.633Z",
      "packages_count": 1
    }
  ],
  "warnings": []
}
```

`packages_count` is the number of registered packages — enough to tell a monorepo from a
single-package ref. The names themselves are off by default; `--packages` adds a sorted
`packages` array of package names to each item (human output is unaffected either way).
`last_fetched_at` is the ISO 8601 timestamp `stale` is derived from; it's absent when the
ref has never been fetched (human output renders that as `synced: never`).

Exit codes: `0`, `4` (no config yet — run `refs init`), `3` (malformed or unmigrated
config), or `1` for an unexpected error (no per-item failure state here — a
missing/unreadable config is a top-level error, not a per-ref one).

---

## `refs doctor`

```
refs doctor
```

Runs the environment/integrity checks, always in this order: `git`, `node`, `config`,
`hooks-guard`, `dirty-checkouts`, `orphans`, `locks`, `skill`, `cli-update`, `ssh-auth` (the last one only runs
when a configured ref uses an `ssh` transport URL). Every check runs to completion
regardless of earlier failures.

```bash
refs doctor --json
```

```json
{
  "ok": true,
  "data": {
    "checks": [
      { "name": "git", "status": "ok", "detail": "git version 2.50.1 (Apple Git-155)" },
      { "name": "node", "status": "ok", "detail": "v24.12.0" },
      {
        "name": "config",
        "status": "ok",
        "detail": "config is present and matches the current schema"
      },
      {
        "name": "hooks-guard",
        "status": "ok",
        "detail": "hooks/pre-commit, hooks/pre-push present; 0 checkout(s) guarded"
      },
      { "name": "dirty-checkouts", "status": "ok", "detail": "no local changes in any checkout" },
      { "name": "orphans", "status": "ok", "detail": "no orphaned checkouts under sources/" },
      {
        "name": "skill",
        "status": "warn",
        "detail": "refs skill not found in the locations this check knows about (~/.agents, ~/.claude, ~/.codex, ./.agents, ./.claude) — an install anywhere else is invisible here and still works; if it really is missing: npx skills add kaisers-io/refs"
      },
      {
        "name": "cli-update",
        "status": "ok",
        "detail": "this CLI (0.9.0) is npm's latest published release"
      }
    ]
  },
  "warnings": []
}
```

`cli-update` is always present, including when the check is switched off — it then reports `ok`
with a detail saying which switch did it (`[updates].check`, `REFS_UPDATE_CHECK`, or CI
detection). It never `fail`s: an unreachable registry is not a fault of your setup, and a `fail`
would make `refs doctor` exit non-zero over it.

Each check's `status` is `ok`, `warn`, or `fail`. As with `sync` (see
[Exit codes](#exit-codes) above), the envelope is `{"ok":true,...}` even when a check
reports `fail`
— but the process exits `1` in that case.

### The `skill` check

The agent skill and the CLI ship through different channels (`npx skills add` from git,
`npm i -g` from npm), so they can drift apart silently. The skill pins the CLI version it
was written against in its frontmatter (`metadata.cli_version`), and this check is the
only thing that compares the two. Six outcomes:

| Situation                                                  | Status | `detail` says                                      |
| ---------------------------------------------------------- | ------ | -------------------------------------------------- |
| No `SKILL.md` in any location it knows about               | `warn` | names the locations searched; install: `npx skills add kaisers-io/refs` |
| The pinned version equals the running CLI                  | `ok`   | the skill matches this CLI                         |
| The skill targets a **newer** CLI                          | `warn` | update the CLI: `npm i -g @kaisers-io/refs@latest` |
| The skill targets an **older** CLI                         | `warn` | update the skill: `npx skills add kaisers-io/refs` |
| The skill has no `cli_version` (installed before the gate) | `warn` | it predates the version gate — update the skill    |
| Either version is not a plain `x.y.z` (a prerelease, say)  | `warn` | direction unknown — reinstall both                 |

Ordering is only computed for plain three-part numeric versions (`0.6.0`). Anything else —
a prerelease, a build-metadata suffix — lands in the last row, where the check names
neither side and asks you to reinstall both rather than guess an ordering. Exact string
equality is checked first, though, so two identical non-plain versions still report `ok`.

Five installation locations are checked, in this order:

| Location                                                   | `detail` label      | What puts it there                                  |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| `~/.agents/skills/refs/SKILL.md`                           | `shared ~/.agents`  | `skills add -g` — the canonical global copy         |
| `~/.claude/skills/refs/SKILL.md` (or `$CLAUDE_CONFIG_DIR`) | `Claude Code`       | a symlink into `~/.agents`, or a real copy          |
| `~/.codex/skills/refs/SKILL.md` (or `$CODEX_HOME`)         | `Codex`             | same; also where older `skills` versions installed  |
| `<cwd>/.agents/skills/refs/SKILL.md`                       | `project ./.agents` | `skills add` without `-g` — the installer's default |
| `<cwd>/.claude/skills/refs/SKILL.md`                       | `project ./.claude` | `skills add -a claude-code` without `-g` — a single-agent project install |

The `detail` names the one it is reporting on. A location that does not exist is skipped
silently, and the locations are deduplicated by resolved real path — `skills add -g` keeps
one real copy in `~/.agents` and symlinks each agent's directory at it, so the usual
install is reported once, under the shared label, not once per agent.

They can still be independent copies rather than symlinks: a single-target install
(`skills add … -a claude-code`, with or without `-g`) writes a real copy, and so does a
symlink failure on a filesystem without symlink support. At project scope that copy is the
*only* thing written — copy mode skips the canonical `.agents` directory entirely, which is
what the last row above covers. Note that the last row takes no env override: unlike the
global directory, the installer's project path is a literal relative `.claude/skills`, so
`$CLAUDE_CONFIG_DIR` does not move it. Codex needs no counterpart row — it is a universal
agent, so its project install lands in `./.agents/skills` in every mode.

A problem in any of the surviving copies wins over an `ok` in the others: `doctor` cannot
know which agent is about to read the skill, so a stale copy in `~/.claude` is never hidden
by a current shared one.

**This list is best-effort, not exhaustive.** None of those paths is a documented, stable
contract — they are the `skills` installer's implementation detail, the canonical directory
has moved before, and 74 agents carry a global skills directory of their own. A skill
installed for some other agent, or into a project directory you are not currently in,
works fine and this check simply will not see it; that is why "not found" says which places
it looked rather than claiming the skill is absent, and why the result is a `warn` and never
a `fail`. Nothing depends on it: the skill's own capability gate runs `refs --version` and
compares it against the pin in the file the agent already loaded. That "not found" list is
built from the paths actually searched, so it names `$CLAUDE_CONFIG_DIR`/`$CODEX_HOME` when
either is set rather than the `~/.claude`/`~/.codex` the override replaced. The three global
locations resolve from `os.homedir()` — the same call the installer makes, deliberately not
`$HOME`, which native Windows typically leaves unset. Until 0.8.1 the variable was read
instead, so on Windows all three dropped out and a correctly installed skill was reported
as missing.

Exit codes: `0` (all checks `ok`/`warn`), `1` (any check `fail`, or an unexpected error).

---

## `refs migrate`

```
refs migrate
```

Migrates `config.toml` to the current schema, seeding it if absent — the same
config-handling `refs init` does, exposed standalone (e.g. to re-run after upgrading
`refs` without touching hooks/directories).

```bash
refs migrate --json
```

```json
{ "ok": true, "data": { "result": "seeded", "backup": null }, "warnings": [] }
```

```json
{
  "ok": true,
  "data": { "result": "migrated", "backup": "/Users/you/.kaisers-io/refs/config.toml.bak" },
  "warnings": []
}
```

`data.result` is `"seeded"`, `"migrated"`, or `"noop"`; `data.backup` is the `.bak` path
when `"migrated"`, else `null`.

Exit codes: `0`, `3` when an existing config can't be migrated (malformed TOML, a schema
newer than this CLI supports, or a shape beyond automatic migration — the `.bak` is
preserved in that last case), or `1` for an unexpected error. There is no `4` here — an
absent config is seeded, not an error.

---

## `refs remove`

```
refs remove <ref>
```

Removes a configured ref: **both** its config/state entry and its checkout directory —
there is no partial-removal option. The checkout is deleted first (containment-checked
against `sources/`), then the config/state entry is dropped; if the checkout was already
missing, that's reported as a warning, not an error, and removal still proceeds.

```bash
refs remove zod --json
```

```json
{
  "ok": true,
  "data": { "key": "github.com/colinhacks/zod", "removed_checkout": true },
  "warnings": []
}
```

Exit codes: `4` (no ref matches `<ref>`), `2` (`<ref>` matches more than one ref
ambiguously — resolve it with a longer suffix or the full key).

---

## `refs resolve`

```
refs resolve <query> [--ref <ref>] [--project <dir>] [--sync-if-stale]
```

The agent-routing command: resolves a git URL, an exact npm package name, an import path
(e.g. `@scope/pkg/sub/path`), or a unique ref-key suffix to the one ref (and, where applicable,
package) it denotes. Precedence, in order: (1) a parseable git URL, matched against a
configured ref's canonical identity; (2) an exact package-name match; (3) a longest
segment-prefix package match (so `react/jsx-runtime` resolves to package `react`); (4) a
unique ref-key suffix match (same rule `refs show`/`refs remove`/`refs tag` use).

| Option | Meaning |
| --- | --- |
| `--ref <ref>` | Resolve `<query>` as a package **within this ref** (full key or unique suffix). Package routing only — the query never falls through to ref routing, since the caller has already said which ref they mean. This is the remedy the ambiguity error names when one package name is registered by several refs. |
| `--project <dir>` | Also report the version `<dir>` has **installed** of the routed package, read from `node_modules` (never from a lockfile). `<dir>` is the importing directory — in a monorepo the workspace package, not the repo root, since that is where Node's own lookup starts. Requires a query that names a package; on a ref query it is a usage error. |
| `--sync-if-stale` | Fetch, or clone when the checkout is absent, before answering — and only when the ref is stale or missing. Everything reported then describes the checkout **after** that sync. Refuses, rather than syncing, when the checkout is `unmanaged` or `unverifiable`: `sync` hard-resets and cleans, so it must never run against a directory whose identity was not established. |

```bash
refs resolve zod/mini
```

```
ref: github.com/colinhacks/zod
path: /Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod
synced: 3 hours ago
status: stale
package: zod
package path: /Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod/packages/zod
```

The state lines (`synced:`, `status:`, `missing:`) follow the same rule as `refs list`
(see above) and come right after `path:`. The `package:`/`package path:` pair only
appears when the query resolved to a specific package, and always comes after the state
lines; `package path:` is the package's own directory, as distinct from `path:` for the
ref checkout as a whole.

A verified package adds nothing further — the output above is the ordinary case. When the
package's location could **not** simply be confirmed, extra lines follow it
(`package status:`, and where applicable `configured path:`, `candidates:`, `reason:`),
because each of those changes what `package path:` means. See
[Package location verification](#package-location-verification) below.

### Checkout identity

Every reply carries `checkout: {status, reason?}`, answering a question presence alone does not:
is the path really this ref's checkout? `add` and `sync` have always checked this before mutating;
`resolve` now checks it before reporting, because its answer is what a consumer reads source from.

| `checkout.status` | Meaning |
| --- | --- |
| `managed` | The refs marker and the configured origin both match. Proceed. |
| `missing` | The directory itself does not exist. `missing: true` is exactly this case, kept for callers that predate the field. A directory that exists without a `.git` is `unmanaged` (`no_git`), not missing — it is an occupied path, and treating it as absent would let verification run against whatever it holds. |
| `unmanaged` | Something is there that is not this ref's checkout. `reason` is a stable slug: `no_refs_marker`, `origin_mismatch`, `no_origin`, `git_is_file`, `git_is_symlink`, `outside_sources`. |
| `unverifiable` | The path could not be inspected: `path_unreadable`, `git_unreadable`, `config_unreadable`, `config_malformed`, `duplicate_config_values`. |

`no_refs_marker` covers a `core.hooksPath` that is absent **or** set to something other than this
home's hooks directory — a manual clone that sets it for its own purposes is not refs-managed.
`config_malformed` means the file is one git itself would reject (an unterminated quote, an escape
git does not define, an assignment before any section); it is not partially read, because a file
git would not accept is not evidence of identity.

The origin URL is never echoed back in `reason` — it can carry credentials. Both values are read
straight out of `.git/config`; `resolve` spawns no subprocess.

**Package verification is gated on this.** A manifest read inside an unrelated checkout can report
`verified` for a package that has nothing to do with the query, so anything other than `managed` or
`missing` yields `package.status: "unverifiable"` rather than a confident answer.

### `installed` (with `--project`)

| `installed.status` | Meaning |
| --- | --- |
| `found` | `version` plus the manifest's own `name` and `package_json`. The name differs from the query when the installed slot is itself an alias (`node_modules/x` whose manifest says `y`). An alias declared the other way round — `"my-zod": "npm:zod@3"`, where the slot is `node_modules/my-zod` — is **not** discovered, since nothing reads the project's own manifest; such a query reports `not_materialized`. |
| `not_materialized` | Nothing installed under that name anywhere up the tree. |
| `unsupported_layout` | Yarn Plug'n'Play (`reason: "yarn_pnp"`). `.pnp.cjs` is detected, never loaded: reading a version out of it would mean executing project code. |
| `unverifiable` | An installation slot exists but its manifest is unusable (`manifest_unreadable`, `manifest_has_no_version`), the slot itself could not be inspected (`slot_unreadable`), or the package name cannot safely become a path (`unsupported_package_name`). |

The walk stops at the first `node_modules/<name>` that **exists**, not the first readable manifest:
falling through to an ancestor would report a shadowed installation Node would not have loaded.
There is deliberately no lockfile fallback — a lockfile says what should be installed,
`node_modules` says what is, and the second is the question being asked.

### `sync` (with `--sync-if-stale`)

Present only when a sync actually ran, as `{status}` — one of `updated`, `fresh`, `cloned`,
`restored`, the same vocabulary `refs sync` uses. A ref inside its `sync_ttl` with a present
checkout produces no `sync` field at all.

A failing sync fails the whole command with the ordinary error envelope, rather than returning a
success envelope containing a stale path: a caller that asked for freshness and did not get it is
being handed something it did not ask for. Exit `3` when the sync was refused because the checkout
is not this ref's, and `5` when the ref's lock could not be taken or was lost mid-operation.

```bash
refs resolve zod/mini --json
refs resolve left-pad --json
refs resolve https://github.com/stevemao/left-pad --json
```

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/stevemao/left-pad",
    "missing": false,
    "stale": false,
    "last_fetched_at": "2026-07-05T06:28:47.633Z",
    "package": {
      "name": "left-pad",
      "path": ".",
      "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/stevemao/left-pad",
      "status": "verified"
    }
  },
  "warnings": []
}
```

`package` is `null` when the query resolved to a ref only (no specific package), e.g. a
plain git-URL or suffix match with no package involved. `last_fetched_at` is the same
optional ISO 8601 field `refs list` carries, absent when the ref has never been fetched.

### Package location verification

A configured `path` is only a **locator**; the package **name** is its identity. Upstream
repos restructure on their own schedule, so `resolve` does not trust the stored path blindly:
it reads the manifest sitting there and compares its `name` against the configured package
name. Without that check, a package that moved — or a different package that took over its
directory — would be handed back silently, and an agent would read the wrong source while
answering confidently. `package.status` reports what was established:

| `status` | Meaning | `local_path` |
| --- | --- | --- |
| `verified` | the manifest at the configured path declares this package | the configured path |
| `relocated` | the package moved; found at exactly one new path, in a scan that inspected every candidate | the **new** path; `configured_path` names the old one |
| `unmaterialized` | the checkout is not present (`missing: true`) — nothing was verified | the configured path |
| `unverifiable` | verification could not complete — `reason` says why: an unreadable manifest, a workspace scan that could not inspect everything, or the ref lock being unavailable | the configured path |
| `ambiguous` | the name exists at several paths; `candidates` lists them | `null` |
| `missing` | the name appears nowhere, in a scan that inspected every candidate | `null` |

The last row's qualifier is load-bearing, and so is `relocated`'s. Neither absence nor
uniqueness can be concluded from a scan that skipped something — an unreadable manifest, an
unsupported workspace pattern, a package directory reachable only through a symlink, a
declaration in a YAML form the reader cannot parse. Any of those turns both answers into
`unverifiable` instead, because a second package of the same name could be sitting in the part
that was not inspected.

The scan also only covers what the repo's **workspace declaration** points at. A package
registered by `refs add`'s npm fallback — at `path: "."`, or at the packument's `directory` —
is outside that coverage: workspace detection can never see it. If such a package moves,
`resolve` reports `unverifiable`, not `missing`, because a scan with nowhere to look is no
evidence of absence.

**All six exit `0`.** `resolve` is a routing command: the ref resolved, and only the
package's location inside it is in question. A caller that needs the path must therefore
check `status` (or test `local_path` for `null`) rather than treating a zero exit as "here is
a usable directory" — before this existed, `local_path` was always a string.

`relocated` corrects the answer for **this call only** and never writes to `config.toml`. To
persist it: `refs edit <ref> --package <name> path <new-path>`. Automatic reconciliation is
not implemented yet.

Exit codes: `3` (`<query>` looks like a git URL but isn't a supported/canonicalizable
form), `2` (matches more than one ref/package ambiguously), `4` (no match at all — the
query matched no ref, which is distinct from a package whose location could not be
established).

---

## `refs show`

```
refs show <ref> [--packages] [--tags]
```

Shows a configured ref's entry, current state, resolved local checkout path, and package
count, plus up to 5 recent tags (only when the checkout exists and is readable — always in
human output, and in `--json` only under `--tags`).

```bash
refs show zod
```

```
ref: github.com/colinhacks/zod
description: TypeScript-first schema validation
url: https://github.com/colinhacks/zod
path: /Users/you/.kaisers-io/refs/sources/github.com/colinhacks/zod
synced: 3 hours ago
status: stale
tags: v4.1.5, v4.1.4
```

The state lines follow the same rule as `refs list` (see above), directly after `path:`.
`tags:` stays last and only appears when the probe found any tags — unchanged from
before.

```bash
refs show left-pad --json
```

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "description": "Left-pad a string.",
    "url": "https://github.com/stevemao/left-pad",
    "default_branch": "master",
    "tag_format": "v{version}",
    "packages_count": 0,
    "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/stevemao/left-pad",
    "missing": false,
    "stale": false,
    "state": {
      "effective_clone_mode": "blobless",
      "head_sha": "2fca6157fcca165438e0f9495cf0e5a4e6f71349",
      "last_fetched_at": "2026-07-05T06:28:47.633Z"
    }
  },
  "warnings": []
}
```

`data` is the ref's config entry minus `packages`, plus `key`, `local_path`,
`packages_count`, `missing`, `stale`, and `state`. `--packages` adds the full `packages`
map back; `--tags` adds `sample_tags`. Human output is unchanged: it always probes for
tags, and prints the `tags:` line only when the probe found any. `missing` and `stale` are
the same booleans the human `missing:`/`status: stale` lines are derived from — `show`
resolves the ref's effective `sync_ttl` itself (it can differ per ref), which is why they
are carried as their own fields rather than left for a consumer to recompute from
`state.last_fetched_at` alone.

`--tags` is also what makes the `git tag` subprocess run at all in `--json` mode — without
it, `show --json` never touches the checkout. If the checkout exists but its tags can't be
listed (a corrupt `.git`, detached remote, etc.), `sample_tags` degrades to `[]` and a
warning is added instead of failing the whole command.

`--packages` is the discovery path for `refs edit <ref> <field> --package <name>`: it is
how you find the package names that command expects.

Exit codes: `4` (no ref matches), `2` (ambiguous suffix).

---

## `refs sync`

```
refs sync [refs...] [--stale-only]
```

Fetches (or re-clones, if the checkout is missing) every requested ref — every configured
ref by default, or only the given ref keys/suffixes. `--stale-only` skips any ref that is
both within its `sync_ttl` **and** has an existing checkout (a missing checkout is always
re-cloned regardless of TTL).

```bash
refs sync --json
refs sync zod left-pad --json
refs sync --stale-only --json
```

```json
{
  "ok": true,
  "data": {
    "results": [
      { "key": "github.com/stevemao/left-pad", "status": "fresh" },
      { "key": "github.com/colinhacks/zod", "status": "updated" }
    ]
  },
  "warnings": []
}
```

Each result's `status` is one of `updated`, `fresh` (the fetch ran but HEAD was
unchanged), `cloned` (checkout was missing, freshly cloned), `restored` (a dirty checkout
was reset back to clean), or `failed` (with an `error` message instead of a clean
status). A ref skipped entirely by `--stale-only` (within its `sync_ttl` and with an
existing checkout) produces no result item at all — it's filtered out before syncing, not
reported as `fresh`. A branch-rename or partial-clone-fallback surfaces as a `warning`
string on that item, not a failure. Up to 4 refs sync concurrently.

Exit codes: **`0` unless at least one item's `status` is `"failed"`, in which case `1`** —
even though the envelope itself is still `{"ok":true,...}` (see [Exit codes](#exit-codes)
above). `2`/`4` only for a bad `<refs...>` argument (unmatched/ambiguous suffix), which
aborts the whole command before any sync runs.

---

## `refs tag`

```
refs tag <ref> <version> [--package <name>]
```

Resolves a version (e.g. `4.1.0`) to the actual git tag it corresponds to, by rendering
the applicable `tag_format` (`--package <name>`'s own `tag_format`, or else the ref's) and
verifying the rendered tag exists in the checkout.

`tag_format` is optional, and this is the only command that reads it. A ref recorded
without one — because its repository publishes no tags, or none in a describable shape —
exits `3` here rather than resolving against a guess.

```bash
refs tag left-pad 1.3.0 --json
refs tag zod 4.1.0 --package zod --json
```

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "version": "1.3.0",
    "tag": "v1.3.0",
    "ref_path": "refs/tags/v1.3.0"
  },
  "warnings": []
}
```

Exit codes: `4` (ref/package not found, checkout missing, or the rendered tag doesn't
exist in the checkout), `3` (the ref, or the named package with no ref-level format to
inherit, has no `tag_format` configured), `2` (ambiguous suffix). The `3`/`4` distinction
carries information: `3` means this ref cannot resolve any version, `4` means this one was
never tagged.
