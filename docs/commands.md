# Command reference

`refs --help` and `refs <command> --help` are always the authoritative, up-to-date
synopsis — this document mirrors them and adds the `--json` data shapes and exit codes
that `--help` doesn't show.

Every command accepts two global options, in addition to its own:

| Option      | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `--json`    | Emit a machine-readable JSON envelope on stdout instead of human text. |
| `--verbose` | Include stack traces in error output.                                  |

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

Seeds the refs home directory (config, state, `sources/`, `locks/`, `hooks/`) if absent,
migrates the config to the current schema if it's older, installs the git hooks guard,
and is safe to re-run — a repeat call is a no-op wherever nothing needed to change.

```bash
refs init --json
```

```json
{
  "ok": true,
  "data": {
    "config": "seeded",
    "home": "/Users/you/.kaisers-io/refs",
    "skill_hint": "Install the agent skill: npx skills add kaisers-io/refs   (private phase: npx skills add <path-to-this-repo> --skill refs)"
  },
  "warnings": []
}
```

`data.config` is one of `"seeded"` (no config existed), `"migrated"` (an older schema was
upgraded, with a `.bak` backup left alongside it), or `"noop"` (already current).

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
   human/agent to fill in `description` and a real `tag_format_candidate`, if the
   detected candidate was `null`), re-verifies the checkout's identity, and writes the
   ref into `config.toml`/`state.json`.

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

# (edit proposal.json — fill in description, and tag_format_candidate if it's null)

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
    "url": "ssh://git@github.com/stevemao/left-pad.git",
    "default_branch": "master",
    "tag_format_candidate": "v{version}",
    "description": "",
    "packages": { "left-pad": { "path": "." } }
  },
  "warnings": []
}
```

`tag_format_candidate` is `null` when no reliable tag format was detected — finalizing
then requires editing the proposal to supply one (`--description` cannot recover from
this; a `null` candidate makes `--description` fail too, with a validation error).
`packages` entries are partial (`description` optional) until finalized.

**`--proposal`/`--description`** — the finalized entry:

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "entry": {
      "description": "Left-pad a string.",
      "url": "ssh://git@github.com/stevemao/left-pad.git",
      "default_branch": "master",
      "tag_format": "v{version}",
      "packages": { "left-pad": { "description": "Left-pad a string.", "path": "." } }
    }
  },
  "warnings": []
}
```

### Proposal file shape (for hand-editing between phases)

The file passed to `--proposal` must validate as a `FinalProposal`: `key`, `url`,
`default_branch`, `tag_format_candidate` (must be a real tag format, not `null`, by this
point), a non-empty `description`, and a `packages` map whose entries each have a
non-empty `description` and a `path`. `--proposal` accepts either that bare object, or the
full `--json` envelope wrapping it (`{ok, data, warnings}`) — the exact stdout of
`refs add ... --dry-run --json`, so it can be piped straight through without stripping the
envelope first.

Exit codes: `2` (neither/more than one of `--dry-run`/`--proposal`/`--description` given,
or `<source>` missing), `3` (invalid proposal JSON/shape, missing `tag_format`, or —
`--description` only — one or more detected packages lack a description), `4` (finalizing
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
      "packages_count": 1
    }
  ],
  "warnings": []
}
```

`packages_count` is the number of registered packages — enough to tell a monorepo from a
single-package ref. The names themselves are off by default; `--packages` adds a sorted
`packages` array of package names to each item (human output is unaffected either way).

Exit codes: `0`, `4` (no config yet — run `refs init`), `3` (malformed or unmigrated
config), or `1` for an unexpected error (no per-item failure state here — a
missing/unreadable config is a top-level error, not a per-ref one).

---

## `refs doctor`

```
refs doctor
```

Runs the environment/integrity checks, always in this order: `git`, `node`, `config`,
`hooks-guard`, `dirty-checkouts`, `orphans`, `skill`, `ssh-auth` (the last one only runs
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
        "detail": "refs skill not found in the locations this check knows about (~/.agents, ~/.claude, ~/.codex, ./.agents) — an install anywhere else is invisible here and still works; if it really is missing: npx skills add kaisers-io/refs"
      }
    ]
  },
  "warnings": []
}
```

Each check's `status` is `ok`, `warn`, or `fail`. As with `sync` (see [Exit codes]
(#exit-codes) above), the envelope is `{"ok":true,...}` even when a check reports `fail`
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

Four installation locations are checked, in this order:

| Location                                                   | `detail` label      | What puts it there                                  |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| `~/.agents/skills/refs/SKILL.md`                           | `shared ~/.agents`  | `skills add -g` — the canonical global copy         |
| `~/.claude/skills/refs/SKILL.md` (or `$CLAUDE_CONFIG_DIR`) | `Claude Code`       | a symlink into `~/.agents`, or a real copy          |
| `~/.codex/skills/refs/SKILL.md` (or `$CODEX_HOME`)         | `Codex`             | same; also where older `skills` versions installed  |
| `<cwd>/.agents/skills/refs/SKILL.md`                       | `project ./.agents` | `skills add` without `-g` — the installer's default |

The `detail` names the one it is reporting on. A location that does not exist is skipped
silently, and the locations are deduplicated by resolved real path — `skills add -g` keeps
one real copy in `~/.agents` and symlinks each agent's directory at it, so the usual
install is reported once, under the shared label, not once per agent.

They can still be independent copies rather than symlinks: a single-target install
(`skills add … -a claude-code -g`) writes a real copy, and so does a symlink failure on a
filesystem without symlink support. A problem in any of the surviving copies wins over an
`ok` in the others: `doctor` cannot know which agent is about to read the skill, so a stale
copy in `~/.claude` is never hidden by a current shared one.

**This list is best-effort, not exhaustive.** None of those paths is a documented, stable
contract — they are the `skills` installer's implementation detail, the canonical directory
has moved before, and 74 agents carry a global skills directory of their own. A skill
installed for some other agent, or into a project directory you are not currently in,
works fine and this check simply will not see it; that is why "not found" says which places
it looked rather than claiming the skill is absent, and why the result is a `warn` and never
a `fail`. Nothing depends on it: the skill's own capability gate runs `refs --version` and
compares it against the pin in the file the agent already loaded.

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
refs resolve <query>
```

The agent-routing command: resolves a git URL, an exact npm package name, an import path
(e.g. `@scope/pkg/sub/path`), or a unique ref-key suffix to the one ref (and, where applicable,
package) it denotes. Precedence, in order: (1) a parseable git URL, matched against a
configured ref's canonical identity; (2) an exact package-name match; (3) a longest
segment-prefix package match (so `react/jsx-runtime` resolves to package `react`); (4) a
unique ref-key suffix match (same rule `refs show`/`refs remove`/`refs tag` use).

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
    "package": {
      "name": "left-pad",
      "path": ".",
      "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/stevemao/left-pad"
    }
  },
  "warnings": []
}
```

`package` is `null` when the query resolved to a ref only (no specific package), e.g. a
plain git-URL or suffix match with no package involved.

Exit codes: `3` (`<query>` looks like a git URL but isn't a supported/canonicalizable
form), `2` (matches more than one ref/package ambiguously), `4` (no match at all).

---

## `refs show`

```
refs show <ref> [--packages] [--tags]
```

Shows a configured ref's entry, current state, resolved local checkout path, and package
count, plus up to 5 recent tags (only when the checkout exists and is readable — always in
human output, and in `--json` only under `--tags`).

```bash
refs show left-pad --json
```

```json
{
  "ok": true,
  "data": {
    "key": "github.com/stevemao/left-pad",
    "description": "Left-pad a string.",
    "url": "ssh://git@github.com/stevemao/left-pad.git",
    "default_branch": "master",
    "tag_format": "v{version}",
    "packages_count": 1,
    "local_path": "/Users/you/.kaisers-io/refs/sources/github.com/stevemao/left-pad",
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
`packages_count`, and `state`. `--packages` adds the full `packages` map back; `--tags`
adds `sample_tags`. Human output is unchanged: it always probes for tags, and prints the
`tags:` line only when the probe found any.

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
exist in the checkout), `2` (ambiguous suffix).
