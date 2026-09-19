# Contributing

Thanks for taking a look. This is a small project with a deliberately narrow scope, so the most
useful thing you can do before writing code is open an issue and describe the problem you hit.

## Requirements

- **Node.js `>=24.2`** is the supported floor for the published CLI, verified in CI against the
  built bundle rather than only the source.
- **Node 24.20** for development (see `.node-version`). The bundler needs a newer interpreter than
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

If you touched anything under `skills/`, CI also runs the skill audit (`.github/workflows/skill-audit.yml`),
which is the pre-flight for the vendor audits skills.sh publishes on the skill's public page after
release. To run the same gate locally:

```bash
pnpm skill:audit           # Snyk Agent Scan against skills/
```

It needs [uv](https://docs.astral.sh/uv/getting-started/installation/) and a `SNYK_TOKEN` from a
free Snyk account, because the analysis runs server-side. `.github/workflows/skill-audit.yml`
documents every flag it passes and the one risk that is waived.

If you changed what the skill tells an agent to do, run the skill evals as well. See
[Skill evals](#skill-evals).

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

## Releasing

A `v*` tag push is the only trigger, and every guard authorizing the release — the tag/version
match, the changelog checks, the version-regression check, the `origin/main` ancestor check, the
`needs` edge and the `id-token` grant — is content of the tagged tree, because GitHub resolves a
push-triggered workflow from the pushed ref. **A tag whose tree deletes a guard is never subjected
to it.** Every check in `release.yml` therefore constrains an honest release and nothing else.

One gate can live outside the tagged tree, and it has two halves that must both be configured. A
pull request cannot restore either:

1. **A GitHub Environment named `npm-publish`**, which the `publish` job declares, with a
   **required reviewer who is not the principal that can push the tag**, and self-review disabled.
   A deployment tag rule (`v*`) alone is not enough: it checks the ref's NAME, so an adversarial
   tag keeps `environment: npm-publish`, deletes `verify`, and satisfies it. GitHub needs only one
   listed reviewer to approve, so a reviewer list containing the tag pusher is no gate at all.
   This holds even with a single maintainer: a credential that can push a tag is not the same
   authority as that person approving a deployment interactively.
2. **The npm Trusted Publisher entry must name that environment**, alongside the repository and
   the workflow filename. npm's configuration binds the workflow's FILENAME — `npm trust github`
   takes `--file`, `--repository` and an optional `--environment`, and its API expresses the match
   as `workflow_ref: { file }` with no digest of the contents. So without the environment, a tag
   supplying its own workflow at that path mints the token regardless of what this file says.

**Check both, separately.** A publish that fails proves nothing on its own — an already-published
version fails too. What has to be established is: an environment-bearing job waits for an approval
the tag pusher cannot give; a correctly configured, approved identity authenticates; and an
otherwise identical identity WITHOUT the environment is refused during authentication.

Also list every trusted-publisher entry on the package, not just the one you edited. npm supports
several independent entries, and an older environment-free entry left in place keeps the old route
open. When you replace one, allow direct `npm publish` explicitly — a newly created entry defaults
to staged publishing.

**Not yet established:** whether adding `environment:` to the job breaks an existing publisher
entry configured WITHOUT one. The environment claim changes the token's `sub`, and npm documents
the field as optional without stating what omission means for matching. Bind the environment on
both sides before the next release rather than finding out during it.

Binding the environment also means a commit whose `release.yml` predates it can no longer be
released from, even though the ancestor check still allows tagging it.

The version-regression guard refuses a tag whose version is not strictly greater than the one npm
serves as `latest`, and refuses anything that is not a plain `x.y.z` — a prerelease included,
since this workflow publishes stable releases and guessing an order for `1.0.0-rc.1` is how one
goes out under the wrong dist-tag. npm 11 already rejects a lower version on the implicit tag, so
this is a stricter restatement that `--tag` and `--force` cannot bypass. It fails closed: a lookup
that errors stops the release, and only a lookup that succeeds and reports nothing is treated as a
first publication.

## Commits

Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `build:`, `ci:`). The subject
says what changed. The body says why, especially when the reason is not obvious from the diff.

Please do not add AI-assistant attribution trailers.

## Adding a command

Every command module exports a `registerX(program, ctx)` function and gets one entry in the
registrar list in `packages/cli/src/commands/registry.ts`. That file is the only place that wires
commands into the program.

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

## Skill evals

`skills/refs/` decides whether an agent uses the CLI correctly, and the CLI's tests cannot see it.
`evals/` holds an eval suite for it, run by `claude plugin eval` (Claude Code 2.1.270 or later).
Each case gives an agent a `/refs` task against a local fixture repository and grades what it
did: the commands it ran, the files it left behind, and its final reply. Every grader is
deterministic, so no judge model disagrees with itself between runs.

```bash
pnpm skill:eval                            # every case, 3 runs each
pnpm skill:eval --runs 1 --case 'drift-*'  # one case, one run
```

Every run is a real agent session on your own Claude credential, and it costs like one. That is
why the suite is not part of CI and will not become part of it. Reports stay local, under
`evals/results/`. The first run asks you to trust the directory. Under `--json`
nothing can ask, so pass `--trust-plugin` there. A report says which grader failed but not what
the agent did. Add `--keep-temp` to keep each run's transcript, and read that before you decide
whether the skill or the grader is wrong.

`scripts/skill-evals.sh` builds the CLI and puts wrappers first on `PATH`, because the sandbox the
agent's shell runs in passes very little through. The `refs` wrapper runs the bundle you just
built and allows the `file://` fixtures. On macOS, the `git` wrappers bypass the `/usr/bin` stubs,
which fail inside the sandbox.

Two limits are deliberate:

- **No baseline arm.** The skill is only ever invoked explicitly. Without it a `/refs` prompt is
  an unknown command, so a no-plugin arm has nothing to measure.
- **Scores are bounded evidence.** Three runs of a case say that the instructions held on those
  three runs, for that model. They do not prove the skill is reliable, and a regex over the reply
  checks what the reply says, not whether the agent understood it.

If the sandbox refuses to start because the Docker credential store holds symbolic links (Docker
Desktop creates them), run the suite with `HOME` pointing at an empty directory and a token from
`claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`.

### The same cases under Codex

The skill is installed into Codex too, so the same cases run there:

```bash
CODEX_HOME=~/.config/refs-eval-codex codex login   # once: a login used only by the evals
pnpm skill:eval:codex                               # every case, gpt-5.6-terra, reasoning medium
pnpm skill:eval:codex --case drift-repairs --runs 1 --compare evals/results/<run>/aggregate-result.json
```

Codex has no `plugin eval`, so `scripts/skill-evals-codex.mjs` runs each case with `codex exec`.
It uses the same `case.yaml` and scaffold, and the same workspace layout. The prompt's `/refs`
becomes `$refs`, and the skill is copied into the run's `~/.agents/skills`. The graders are
evaluated over Codex's JSON events. A grader type the adapter does not implement stops the run
before anything starts, so no grader is skipped quietly.

Where it differs from the Claude run, on purpose:

- **A separate login, in its own `CODEX_HOME`.** Your own `~/.codex` would bring its
  configuration, `AGENTS.md` and skills into every run. Codex refreshes that login and writes it
  back, so runs are serial rather than parallel.
- **Workspaces go under the system temp directory.** Inside this repository, Codex would load the
  repository's own `AGENTS.md`. The path of every run is printed and kept.
- **`allowed_tools` and `max_turns` do not map.** Codex runs with `--sandbox workspace-write` and
  the case's timeout. The skills and plugin list that ship with Codex itself still load.

So a difference in score is a difference between the two agents with this skill. It is not a
controlled comparison of two models.

To add a case, create `evals/<name>/case.yaml` and an executable `scaffold.sh` that sources
`../lib.sh`.
Before you trust a grader, feed it a wrong answer and check that it fails. A grader that passes
on an empty run pins nothing.
