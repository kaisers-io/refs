# Contributing

Thanks for taking a look. This is a small project with a deliberately narrow scope, so the most
useful thing you can do before writing code is open an issue and describe the problem you hit.

## Requirements

- **Node.js `>=24.2`** is the supported floor for the published CLI, verified in CI against the
  built bundle rather than only the source.
- **Node 24.12** for development (see `.node-version`). The bundler needs a newer interpreter than
  the floor, so CI builds on the pin and then re-runs the checks on the floor.
- **pnpm 11 or newer** (`corepack enable` picks up the pinned version automatically). The
  published CLI has no pnpm requirement of its own.

```bash
git clone https://github.com/kaisers-io/refs.git
cd refs
pnpm install
pnpm refs --version        # builds the CLI, then runs it
```

`pnpm refs <args>` builds first every time, which takes a few seconds and is incremental. Do not
write `pnpm refs -- <args>`: pnpm passes the literal `--` through to the CLI, and Commander then
misreads the arguments. Verified against pnpm 11.9 and 11.10.

To put a global `refs` on your `PATH` backed by this checkout, build once and link:

```bash
pnpm build
pnpm -C packages/cli add -g .     # pnpm 11 removed `pnpm link --global`
# or: npm link ./packages/cli
```

`packages/cli/bin/refs.mjs` is a committed stub, so a linked `refs` runs even in an unbuilt
checkout by executing the TypeScript source through Node's own type stripping. Without
`pnpm install` it prints what to run instead of failing cryptically.

## Before you open a pull request

Run the full check. It must pass:

```bash
pnpm check                 # lint + format check + typecheck + tests
```

That is exactly what CI runs, on Linux, macOS and Windows, and once more on the Node 24.2 floor.
CI adds a coverage gate, a version-consistency check, a bundle-determinism check, and a smoke test
of the packaged CLI on Linux and Windows.

For a faster inner loop, run `pnpm dev` inside `packages/cli` and call the stub directly. From
that directory it is `node bin/refs.mjs <args>`; from the repository root,
`node packages/cli/bin/refs.mjs <args>`.

## Things that will fail review

- **Loosening configuration to make a check pass.** `.oxlintrc.json`, the vitest configs, and the
  coverage thresholds are the contract. If a rule is genuinely wrong, say so and argue the case.
  Do not turn it off to get a green tick.
- **Editing version numbers by hand.** Two files carry the released version and CI compares them.
  Use `pnpm versions --set <version>`.
- **Changing only one changelog.** `CHANGELOG.md` and `packages/cli/CHANGELOG.md` must stay
  byte-identical, and the release workflow enforces it with `cmp`. The packaged copy is what npm
  users see, so both move together.
- **Tests that assert on implementation details** rather than observable behavior. The CLI's
  `--json` envelope is a contract. The shape of a private helper is not.

## Commits

Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `build:`, `ci:`). The subject
says what changed. The body says why, especially when the reason is not obvious from the diff.

Please do not add AI-assistant attribution trailers.

## Adding a command

Every command module exports a `registerX(program, ctx)` function and gets one entry in a
registrar list. There are two: `packages/cli/src/commands/registry.ts` holds the first few and
spreads in `MORE_REGISTRARS` from `registrars-more.ts`, which is where the rest live and where a
new one belongs. The split keeps either file under oxlint's per-file import cap.

Commands take their process environment (`cwd`, `env`), their output (`out`, `errLine`), their
stdin, and their outbound calls (`runner`, `fetcher`) from `CliContext` instead of reaching for
the globals. That is what makes them testable without spawning real git or reading the real
environment. Filesystem access is not injected: modules import `node:fs/promises` directly, and
tests isolate them with a throwaway `REFS_HOME`.

Every command supports `--json`, which must emit exactly one line: a stable envelope with `ok`,
`data`, and `warnings`, or `ok: false` with an `error` object. Human output and JSON output may
word things differently, but they must never disagree about what happened.

## Documentation

`docs/commands.md` documents CLI output, including exact strings. If you change what a command
prints, update the documented example to match character for character. An example that merely
resembles the real output is worse than none.
