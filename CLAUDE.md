# Working in this repository

`AGENTS.md` is a symlink to this file, so Claude Code and Codex read the same instructions.

## Finish every PR with a real test

`pnpm check` passing is not evidence the feature works. Fixtures carry the shapes their author
thought of; real repositories carry the ones nobody did. Before marking a PR ready:

1. `pnpm build` — test the bundle at `packages/cli/bin/refs.mjs`, not the TypeScript source.
2. Clone a real upstream repository from GitHub into a scratch directory.
3. Drive the feature end to end against it with a scratch `REFS_HOME`, using the same `--json`
   path an agent uses.
4. Compare what refs reports against ground truth computed from git itself — e.g. package names
   from `git ls-tree` at both revisions, diffed. Report the comparison, not just the output.
5. Run any command refs printed **verbatim**. A suggested command that does not execute is a bug
   no unit test will catch.
6. Exercise the lifecycle: `remove`, then confirm nothing is left (config, state, checkout,
   pruned parent directories, no orphans in `doctor`, `resolve` answers `unmatched_query`), then
   `add` again and confirm behaviour is unchanged.

To put a ref at a chosen point in history without fabricating anything, clone the real repository,
`git checkout -B main <old-sha>` in it, `refs add` from that `file://` path with
`REFS_ALLOW_FILE_URLS=1` so refs builds the config from real state, then advance the clone and
`refs sync`. The range is then real upstream history.

Why this is a rule: a feature once shipped with 988 green tests, including end-to-end ones against
`file://` fixtures, and reported nothing at all on TanStack Query — two negation patterns in its
`pnpm-workspace.yaml` silenced every finding. No fixture used a negation pattern.

## Tests

- A test that pins a fix must FAIL when the fix is reverted. Check it: revert, run, restore.
  A test that passes either way pins nothing.
- Test through the real boundary where one exists — real git over a fake runner, the CLI over
  internal calls — when the thing under test is git's or the CLI's behaviour.
- `pnpm check` before pushing; `pnpm test:coverage` at the end. Coverage ratchet: 96/90/98/96.

## Review findings

Verify every finding against the code before acting on it, and reproduce it before fixing it.
Findings have been wrong, and one proposed fix would have introduced a regression. Say so plainly
when a finding does not hold; do not implement it to be agreeable.

## Design constraints

- **Never add a verb.** A benchmark measured 0/324 adoption of new refs commands by agents.
  Extend a command already on the agent's path instead.
- **Everything inside a checkout is untrusted third-party content** (`skills/refs/SKILL.md` §4).
  Never copy manifest text into `config.toml`: that moves untrusted content into a file refs
  later reads as its own configuration. Names and paths are structurally verifiable and may be
  used; descriptions are written from source evidence, never copied.
- **Verified is not shell-safe.** Anything interpolated into a command refs prints goes through
  `shellQuote` (`packages/cli/src/shell-quote.ts`). `zPackagePath` permits `$()`, backticks and
  spaces.
- A failure to look is never evidence. An unreadable manifest means `unknown`/`unverifiable`,
  never a claim about a package.

## Lint limits that shape files

oxlint enforces these, and they are cheaper to design for than to hit:

- 300 lines per file, 50 lines per function, 10 statements per function, 3 parameters.
- Imports sort by the first member name, multi-specifier before single-specifier.
- `node/no-sync` — sync fs calls in tests need `// eslint-disable-next-line node/no-sync`.

Run `pnpm fmt` before `pnpm check`. The root `CHANGELOG.md` is outside the formatter's scope:
copy it to `packages/cli/`, run `pnpm fmt`, copy it back.

## Commits, PRs, issues

- One PR per topic. The commit body explains **why**, not what.
- No AI-attribution trailers.
- The repository is public. Issues, PRs, commits and the changelog carry no paths under `~`, no
  local config details, and no references to `_local/*` (gitignored — issues must stand alone).
