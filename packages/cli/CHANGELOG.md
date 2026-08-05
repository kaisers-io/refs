# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `refs init`'s skill-install hint now presents the second form as installing from a local
  clone, rather than as a workaround for the repository's development phase. Both commands
  are unchanged; only the wording differs.

## [0.8.0] - 2026-08-04

### Changed

- Lowered the supported Node.js floor from `>=24.12` to `>=24.2`. The real requirement was
  always `import.meta.main` (used by the CLI's entry-point check), which Node added in 24.2.0 —
  the higher number had no other reason behind it. Users on Node 24.2 through 24.11 were
  previously blocked for no reason and can now run `refs` as-is.

### Fixed

- The agent skill's citation contract now binds every source reference, not only
  worker-relayed ones. An inline investigation (no worker dispatched, per the step 3
  dosing rule) previously fell outside the contract and could emit bare absolute paths
  instead of clickable relative-text links.

### Removed

- The Claude Code and Codex plugin packaging (`.claude-plugin/`, `.codex-plugin/`, and the
  `.agents/plugins/marketplace.json` mirror). Neither manifest carried a payload beyond the
  `refs` skill, so installing one produced a second copy that could drift from the one
  `skills add` installs — observed in practice: two `refs` entries in the Codex skill picker,
  and an icon that reached only one of them. `refs` now ships exactly two ways: the CLI from
  npm (`@kaisers-io/refs`) and the skill from git (`skills add`).

  If you installed the plugin, uninstall it (Claude Code: `/plugin`; Codex CLI: `/plugins`)
  and install the skill instead — see the install section in the README, which covers the
  repository still being private. The `@refs` plugin-mention gap in Codex (codex-cli 0.146.0,
  [openai/codex#22078](https://github.com/openai/codex/issues/22078)) no longer applies: there
  is no plugin to mention. Invoke the skill with `/refs` in Claude Code or `$refs` in Codex.

## [0.7.0] - 2026-08-03

### Changed

- `refs list`, `show`, `resolve` and `init` print one `key: value` per line, with a blank line
  between `list` entries. The `key  description` header line is gone, and `local_path:` is now
  `path:` (`package path:` for the package inside a ref).
- `[stale]`/`[missing]` markers are replaced by `synced: <when>`, plus `status: stale` and
  `missing: …` lines when they apply. Human output only; `--json` keeps `stale` and `missing`.
- `refs init` says `config: unchanged` where it used to print `(noop)`.
- The npm-facing `packages/cli/README.md` now documents the skill-check search locations the
  root README has described since 0.6.1.

### Added

- `last_fetched_at` on `refs list` items and `refs resolve` output, `missing` and `stale` on
  `refs show` — all `--json`, all additive.
- Source citations from the agent skill are now clickable markdown links.

## [0.6.1] - 2026-08-03

### Fixed

- `refs doctor`'s `skill` check no longer reports a skill that is installed and working as
  missing. It only ever looked in `~/.claude/skills/refs` and `~/.codex/skills/refs`, but
  `npx skills add kaisers-io/refs` — the documented installer — writes neither: it keeps one
  real copy in a shared `.agents/skills/refs` directory and symlinks each agent's own
  directory at it. A Claude Code user was rescued by that symlink; anyone without one — a
  Codex-only user, or anyone whose install went to the current project rather than `$HOME` —
  was told to install a skill they already had, and never saw the version comparison that
  `0.6.0` made the point of this check. Five locations are now checked, in this order:
  `~/.agents/skills/refs/SKILL.md` (`shared ~/.agents`), `$CLAUDE_CONFIG_DIR` or `~/.claude`
  (`Claude Code`), `$CODEX_HOME` or `~/.codex` (`Codex`), `<cwd>/.agents/skills/refs`
  (`project ./.agents`), and `<cwd>/.claude/skills/refs` (`project ./.claude`). The last two
  are there because `skills add` installs into the current project unless `-g` is passed, and
  implies `-y` when it runs inside an agent, so an agent-driven install never touches `$HOME`
  at all — and because naming a single agent (`skills add … -a claude-code`) switches the
  installer to copy mode, which skips the shared `.agents` directory entirely and writes only
  that agent's own. Unlike its global counterpart, the project path takes no env override:
  the installer hardcodes a relative `.claude/skills` there. Codex needs no counterpart at
  all, being a universal agent whose project install lands in `./.agents` in every mode. The
  locations are deduplicated by resolved real path, so the usual symlinked install is
  reported once rather than once per agent, while two genuinely independent copies are both
  compared and a problem in either wins.
- `refs doctor`'s "skill not found" message no longer claims the skill is not installed, and
  no longer names directories it did not search. That list of locations is best-effort and
  cannot be otherwise: the paths are the `skills` installer's implementation detail rather
  than a documented contract, the canonical directory has moved before, and 74 agents carry a
  global skills directory of their own. A skill installed for some other agent still works
  and is simply invisible here, so the `detail` now names the locations it searched and keeps
  the install hint for the case where the skill really is missing. Those names are derived
  from the paths actually resolved, so with `$CLAUDE_CONFIG_DIR` or `$CODEX_HOME` set the
  message names the override rather than the `~/.claude`/`~/.codex` it replaced — an override
  moves the search, it does not widen it, and pointing anyone at the directory the check just
  skipped would be worse than saying nothing. It stays a `warn`, never a `fail` — the skill's
  own capability gate compares `refs --version` against the pin in the file the agent already
  loaded and depends on none of this.

## [0.6.0] - 2026-08-03

### Changed

- **Breaking (`--json` only):** `refs list --json` and `refs show --json` no longer include
  the ref's package data by default. Both now report a `packages_count` number instead; pass
  `--packages` to get the names back (a sorted `string[]` on `list`, the full package map on
  `show`). `refs show <a-140-package-monorepo> --json` drops from roughly 4,400 tokens to
  about 100. Human output is unchanged — it never showed package data.
- **Breaking (`--json` only):** `refs show --json` no longer includes `sample_tags` unless
  `--tags` is passed, and skips the `git tag` subprocess entirely when it isn't. Human
  output is unchanged: it always probes for tags, and still prints the `tags:` line
  whenever the probe found any.
- The agent skill is now **explicitly invoked only** — it no longer activates on its own.
  Invoke it with `/refs` (Claude Code) or `$refs` (Codex). This is `disable-model-invocation`
  in the frontmatter plus `policy.allow_implicit_invocation: false` in the new
  `skills/refs/agents/openai.yaml`.
- The skill's reference files moved out of `references/` and now sit beside `SKILL.md` as
  `INVESTIGATE.md`, `ADD.md`, `MAINTAIN.md`, and `ONBOARDING.md`, joined by a new
  `COMMANDS.md` CLI reference. `npx skills add` and `skills update` replace the skill
  directory wholesale, so nothing is left behind. **If you installed the skill by copying
  files manually, delete the old `skills/refs/references/` directory** — it would otherwise
  sit alongside the new files with stale instructions.
- The skill now pins the CLI version it was written against
  (`metadata.cli_version` in its frontmatter), and the release workflow fails if that pin
  drifts from the published CLI version.
- `refs doctor`'s `skill` check now compares that pinned `cli_version` against the running
  CLI and names which side is behind, instead of only checking that `SKILL.md` exists. Both
  `~/.claude/skills/refs` and `~/.codex/skills/refs` are checked, and a problem in either
  wins over an `ok` in the other.

### Fixed

- The skill's frontmatter claimed macOS/Linux only. Windows has been fully supported since
  0.5.0; the field is gone.

## [0.5.1] - 2026-07-30

### Added

- The npm tarball now ships a package README (the npm page was empty) and this
  `CHANGELOG.md` — the latter matters because the GitHub repository is private during the
  current development phase, so the packaged copy is the only changelog users can see.
  The release pipeline's tarball-content allowlist covers both, and a new guard fails the
  release if the packaged changelog drifts from the repository one.
- Registry metadata in `package.json`: `keywords`, `homepage`, and `bugs`.

## [0.5.0] - 2026-07-30

### Added

- Full Windows support: every command, the lock/steal machinery, sync/clone/remove with their
  containment guards, and the read-only hook guards now behave on Windows exactly as on
  macOS/Linux (Git for Windows required). CI runs the full test suite plus a PowerShell smoke
  test — which exercises the npm-generated `.cmd` shims — on `windows-latest`.

### Fixed

- Lock directory names no longer contain `:` (illegal in Windows file names; every locked
  command failed with `EINVAL` there). Per-ref locks are now named `ref.<key>`; a stale
  `ref:<key>` directory left by an older version is inert and can be deleted.
- The lock-steal pipeline treats Windows sharing-violation errors (`EPERM`/`EACCES`/`EBUSY` on
  the tombstone rename or on re-creating a directory that is still delete-pending) as a lost
  race and retries, instead of crashing.
- Workspace package paths are `/`-separated identifiers on every platform (they previously used
  `\` on Windows, breaking sorting, deduplication, and stored config paths).
- Child-process cleanup also listens for `SIGBREAK`, so Ctrl-Break on Windows kills spawned
  git/ssh children like Ctrl-C does.

## [0.4.0] - 2026-07-28

### Changed

- Internal: whole-codebase clarity refactor — comments now explain behavior instead of project
  history, inline lint exceptions cut from 75 to 20, `type` aliases replace interfaces
  throughout, dead exports removed, and the workspace-detection logic is split into a pure,
  directly-tested module. No CLI behavior change.

### Removed

- `refs search` and `refs range` (both added in 0.3.0). A dedicated efficiency benchmark
  (18-task corpus built around the two commands, taught inline with worked `--json` examples and
  provably on `PATH`) measured **0 / 324 adoption** — neither Opus 4.8 nor GPT-5.6 invoked either
  command on a single task, including tasks constructed to favor them — while the condition
  carrying the teaching cost _more_ (cost-weighted spend +19% over discipline, +41% over naive for
  Claude). With the dependency source checked out, both commands compete head-to-head with the
  agent's native `git grep` / `git log` / `git diff` and lose: they are redundant with skills the
  agent already has on the very source refs provides. refs' core value — real, local source the
  agent then reads and greps — is unchanged. The agent skill now routes source-search and version
  questions to `resolve`/`sync`/`tag` plus read-only git on the checkout. The now-dead core helpers
  (`git/grep`, `git/range`, `git/changelog`) were removed with them.

## [0.3.0] - 2026-07-23

### Added

- `refs range <ref> <old-version> <new-version>` — a bounded version-diff digest for
  agent-driven "what changed between these versions" questions. Resolves both versions to git
  tags (same `tag_format` inheritance as `refs tag`) and returns, in one call, the commit count,
  the newest `--limit` (default 50) non-merge commit subjects, diff stats, changed paths (capped
  at 200), and a changelog excerpt extracted at the new tag. `--package <name>` scopes the
  diff/paths/changelog to that package's path while the commit log stays repo-wide. Every bounded
  list carries an honest flag in `truncated`; the digest is a starting point, and the full history
  stays available via plain git in the checkout.
- `refs search <ref> <pattern>` — bounded structured code search over a ref's checkout. Wraps
  `git grep -z -n -I --extended-regexp` and returns `{path, line, snippet}` matches (trimmed,
  capped at 200 chars), at most `--limit` (default 50), with `truncated: true` whenever more
  exist. Vendored/generated paths (`dist`, `build`, `node_modules`, lockfiles, …) are excluded by
  default and echoed in `excludes_applied`; `--no-default-excludes` turns them off. `--glob` takes
  plain glob patterns (never raw git pathspec magic — leading `:` or root-escaping `..` are
  rejected), and `--package` is a hard boundary that intersects with any `--glob` and refuses a
  package directory resolving outside the checkout. No matches is a success, not an error.

### Changed

- Rewrote the agent skill's investigation playbook (`skills/refs/references/investigate.md`) as an
  advisory guide built on the "hint, not gate" principle: four hard rules (read real source before
  citing, treat digests as starting points, honour truncation flags, unmask decoy version tags)
  plus recommended investigation funnels with explicit escape hatches, tuned by two real-world
  field tests.

## [0.2.0] - 2026-07-07

### Added

- Onboarding flow for the agent skill (`skills/refs/references/onboarding.md`, triggered by
  "onboard me" / "set up refs" / "what is refs"): health check via `refs doctor --json`, a
  consented `refs init` where needed, the three core jobs explained with copyable example
  prompts, and a first-ref suggestion drawn from the project's own dependency manifests.
- Install flow in the skill's capability gate: when the `refs` CLI is missing, the agent now
  checks the Node version, asks the user for consent, installs `@kaisers-io/refs` from npm,
  verifies with `refs --version`, and runs `refs doctor --json` automatically. A new
  `compatibility` frontmatter field declares the CLI dependency.

### Changed

- All example content (docs, skill references, README, CLI help text) switched from next.js to
  zod (`github.com/colinhacks/zod`) — every example validated against a real zod checkout via
  refs itself.
- Development now requires pnpm 11 or newer (`engines.pnpm` at the workspace root); the
  published CLI has no pnpm requirement.
- The user-facing supported Node range relaxed from `>=24.12 <25` to `>=24.12` (open-ended),
  verified working on Node 25.9 and 26.4 (build, tests, stub, and source fallback). Development
  stays pinned to Node 24.12 via `.node-version`; CI and the root `packageManager` field are
  unchanged.
- `packages/cli/bin/refs.mjs` is now a committed, zero-dependency stub (not build output): it
  checks the Node.js version, then loads and runs the tsdown bundle from `dist/refs.mjs`. If the
  bundle is missing but sources and dependencies are present, it falls back to running the CLI
  directly from TypeScript source via Node's native type stripping. It fails loudly with an
  actionable message (exit 1) only if neither the bundle nor the source fallback can load. The
  tsdown bundle itself moved from `bin/refs.mjs` to `dist/refs.mjs`, and remains gitignored build
  output produced by `pnpm build`.

## [0.1.3] - 2026-07-05

### Added

- Plugin manifests for the Codex app/CLI (`.codex-plugin/plugin.json`) and Claude Code's
  plugin marketplace (`.claude-plugin/plugin.json` + `marketplace.json`), plus a
  `.agents/plugins/marketplace.json` mirror for Codex's own marketplace. A
  `.agents/skills/refs` symlink to `skills/refs/` gives Codex repo-local
  auto-discovery of the skill when run inside this checkout.

### Changed

- `packages/cli/bin/refs.mjs` (the built CLI bundle) is no longer committed to the repo — it's
  build output, regenerated by `pnpm build` and gitignored. CI now proves the build is
  deterministic (two consecutive builds byte-for-byte identical) instead of diffing a committed
  copy, and the release pipeline passes the bundle built and guarded by the unprivileged `verify`
  job to the minimal `publish` job as a workflow artifact, so `publish` still never installs
  dependencies or runs a build while it holds the npm OIDC token.
- Updated the bundled `smol-toml` TOML parser/serializer from 1.6.1 to 1.7.0 (faster
  single-pass string decoding; integers beyond the safe range now serialize as floats;
  no breaking changes).
- `refs add <source> --description <text>` no longer reuses `<text>` as a fallback
  description for detected packages that lack one. `<text>` is now only ever the
  top-level ref description; if one or more detected packages have no manifest
  description (including a single-package repo whose lone package has none, and a
  package whose manifest carries an empty `"description": ""` — the `npm init -y`
  scaffold), the one-shot fails (exit 3) naming every affected package and pointing at
  the two-phase `--dry-run`/`--proposal` flow instead. Consequently, an `npm:<pkg>`
  source without detected workspace packages can effectively never use the one-shot —
  its single seeded package entry never carries a description — and always needs the
  two-phase flow.

- Replaced the `execa` dependency with a small hand-rolled `node:child_process`-based
  process runner. `git`/`ssh` invocations, timeouts, and error handling work as
  before, with two minor observable differences: a command that fails to spawn at
  all (e.g. `git` missing from `PATH`) now reports exit code 127 instead of 1, and
  its OS error message (e.g. `spawn git ENOENT`) now lands on stderr — improving
  `refs doctor`'s failure detail for a missing `git` binary. The published CLI
  bundle is smaller as a result (`bin/refs.mjs`: 305,188 → 196,249 bytes raw,
  89,740 → 55,864 bytes gzipped).

### Fixed

- `refs add --proposal` validation errors now name the offending key(s) for a
  stray/unrecognized field in the proposal — top-level (e.g.
  `unrecognized key(s) in proposal: "okay"`) and nested inside a package entry (e.g.
  `unrecognized key(s) in proposal at packages.<name>: "bogus"`) — instead of a bare,
  contextless `Invalid input`. Named-field validation errors (missing or wrong-typed
  fields, including nested package fields like `packages.<name>.description`) are
  unchanged.

## [0.1.2] - 2026-07-05

### Added

- `refs add` now emits progress lines on stderr while it works (`refs: resolving npm
package '…'…`, `refs: cloning …`, `refs: detecting workspace packages…`) in both
  human and `--json` mode, so long clones no longer look like a hang. stdout is
  unaffected and stays exactly the parseable envelope in `--json` mode.

### Fixed

- `refs add --proposal` now accepts the full `--json` envelope that
  `refs add … --dry-run --json` prints, so the documented pipe workflow
  (`refs add npm:x --dry-run --json > f.json` → edit → `refs add --proposal f.json`)
  works without hand-stripping the `data` wrapper. Bare proposal documents keep
  working unchanged.
- A proposal file containing a failed (`ok: false`) or malformed (no usable `data`
  object) envelope now fails with a clear message instead of a field-by-field
  validation dump.

## [0.1.1] - 2026-07-05

No user-facing changes. First tag-driven release, validating the OIDC
trusted-publishing pipeline end to end.

## [0.1.0] - 2026-07-05

### Added

- Initial release of the `refs` CLI: manage local, read-only checkouts of reference
  repositories ("refs") for agents and humans — `init`, `add` (two-phase
  proposal/finalize or one-shot `--description`), `list`, `show`, `resolve`, `sync`,
  `edit`, `remove`, `migrate`, and `doctor`.
- npm-source resolution (`refs add npm:<package>`), workspace package detection
  (npm/yarn/pnpm monorepos), tag-format detection, blobless clones with full-clone
  fallback, and a configurable git transport (`https`/`ssh`).
- Machine-readable `--json` output with a stable `{ok, data, warnings}` /
  `{ok, error}` envelope on every command, plus stable exit codes.
- Containment-guarded destructive operations, credential redaction in every
  URL-carrying message, and read-only enforcement of managed checkouts via
  installed git hooks.
- Agent skill (`skills/refs/`) documenting the investigate/add/maintain workflows.

[Unreleased]: https://github.com/kaisers-io/refs/compare/v0.7.0...HEAD
[0.8.0]: https://github.com/kaisers-io/refs/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kaisers-io/refs/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kaisers-io/refs/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kaisers-io/refs/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/kaisers-io/refs/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kaisers-io/refs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kaisers-io/refs/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kaisers-io/refs/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kaisers-io/refs/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/kaisers-io/refs/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kaisers-io/refs/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kaisers-io/refs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kaisers-io/refs/releases/tag/v0.1.0
