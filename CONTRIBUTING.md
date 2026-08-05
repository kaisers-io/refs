# Contributing

Thanks for taking a look. This is a small project with a deliberately narrow scope, so the most
useful thing you can do before writing code is open an issue and describe the problem you hit.

## Requirements

- **Node.js `>=24.2`** — this is the supported floor for the published CLI and is verified in CI
  against the built bundle, not just the source.
- **Node 24.12** for development (see `.node-version`). The bundler needs a newer interpreter than
  the floor; CI builds on the pin and then re-runs the checks on the floor.
- **pnpm 11 or newer** (`corepack enable` picks up the pinned version automatically).

```bash
git clone https://github.com/kaisers-io/refs.git
cd refs
pnpm install
pnpm refs --version        # builds the CLI, then runs it
```

## Before you open a pull request

Run the full check. It must pass:

```bash
pnpm check                 # lint + format check + typecheck + tests
```

That is exactly what CI runs — on Linux, macOS and Windows, and once more on the Node 24.2 floor.
CI adds a coverage gate, a version-consistency check, a bundle-determinism check, and a smoke test
of the packaged CLI on Linux and Windows.

For a faster inner loop, run `pnpm dev` inside `packages/cli` and call
`node packages/cli/bin/refs.mjs <args>` directly.

## Things that will fail review

- **Loosening configuration to make a check pass.** `.oxlintrc.json`, the vitest configs, and the
  coverage thresholds are the contract. If a rule is genuinely wrong, say so and argue the case —
  but do not turn it off to get a green tick.
- **Editing version numbers by hand.** Two files carry the released version and CI compares them.
  Use `pnpm versions --set <version>`.
- **Changing only one changelog.** `CHANGELOG.md` and `packages/cli/CHANGELOG.md` must stay
  byte-identical; the release workflow enforces this with `cmp`. The packaged copy is what npm
  users see, so both move together.
- **Tests that assert on implementation details** rather than observable behavior. The CLI's
  `--json` envelope is a contract; the shape of a private helper is not.

## Commits

Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `build:`, `ci:`). The subject
says what changed; the body says why, especially when the reason is not obvious from the diff.

Please do not add AI-assistant attribution trailers.

## Adding a command

Every command module exports a `registerX(program, ctx)` function and gets one entry in
`packages/cli/src/commands/registry.ts`. Commands take their process environment (`cwd`, `env`),
their output (`out`, `errLine`), their stdin, and their outbound calls (`runner`, `fetcher`) from
`CliContext` rather than reaching for the globals directly — that is what makes them testable
without spawning real git or reading the real environment. Filesystem access is not injected;
modules import `node:fs/promises` directly and tests isolate them with a throwaway `REFS_HOME`.

Every command supports `--json`, which must emit exactly one line: a stable envelope with `ok`,
`data`, and `warnings`, or `ok: false` with an `error` object. Human output and JSON output are
allowed to word things differently, but they must never disagree about what happened.

## Documentation

`docs/commands.md` documents CLI output, including exact strings. If you change what a command
prints, update the documented example to match character for character — a documented example that
merely resembles the real output is worse than none.
