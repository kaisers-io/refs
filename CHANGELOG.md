# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Plugin manifests for the Codex app/CLI (`.codex-plugin/plugin.json`) and Claude Code's
  plugin marketplace (`.claude-plugin/plugin.json` + `marketplace.json`), plus a
  `.agents/plugins/marketplace.json` mirror for Codex's own marketplace. A
  `.agents/skills/refs` symlink to `skills/refs/` gives Codex repo-local
  auto-discovery of the skill when run inside this checkout.

### Changed

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

[Unreleased]: https://github.com/kaisers-io/refs/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/kaisers-io/refs/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kaisers-io/refs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kaisers-io/refs/releases/tag/v0.1.0
