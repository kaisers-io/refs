# Contributing

Thanks for taking a look. This is a small project with a deliberately narrow scope, so the most
useful thing you can do before writing code is open an issue and describe the problem you hit.

## Requirements

- **Node.js `>=24.2`** is the supported floor for the published CLI, verified in CI against the
  built bundle rather than only the source.
- **Node 24.21** for development (see `.node-version`). The bundler needs a newer interpreter than
  the floor, so CI builds on the pin and then re-runs the checks on the floor.
- **pnpm 12 or newer** (`corepack enable` picks up the pinned version automatically). The
  published CLI has no pnpm requirement of its own.

```bash
git clone https://github.com/kaisers-io/refs.git
cd refs
pnpm install
pnpm refs --version        # builds the CLI, then runs it
```

`pnpm refs <args>` builds first every time, which takes a few seconds and is incremental. Do not
write `pnpm refs -- <args>`: pnpm passes the literal `--` through to the CLI, and Commander then
misreads the arguments. Verified against pnpm 11.9, 11.10 and 12.11.

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
pnpm check                 # lint + format check + typecheck + tests with the coverage gate
```

That is exactly what CI runs, on Linux, macOS and Windows, and once more each on the Node 24.2
floor and on the newest Node LTS line (26). CI runs more jobs around it;
[What CI runs](#what-ci-runs) lists every one.

Lint is type-aware: `.oxlintrc.json` sets `options.typeAware`, which runs through the
`oxlint-tsgolint` devDependency, so `pnpm install` is all it needs and editors pick up the same
rules. Only the type-aware rules enabled there run; the others are off by name, each with the
number of findings it had, so they can be adopted one at a time.

The coverage gate (`vitest.config.ts`) is enforced everywhere except Windows, where coverage is
collected but not gated. CI on Linux stays the authoritative gate: it has measured slightly below
macOS, so a local pass right at a threshold can still fail there.

If you touched anything under `.github/`, run the [zizmor](https://docs.zizmor.sh/) audit of the
workflows and `dependabot.yml` locally first, at the version the `zizmor` job in
`.github/workflows/ci.yml` pins. CI runs it through [pipx](https://pipx.pypa.io/). Both commands
below read the pin out of `ci.yml`, so they cannot fall behind it; the second runs the same release
through uv:

```bash
pipx run --spec "$(grep -o 'zizmor==[0-9.]*' .github/workflows/ci.yml)" zizmor --strict-collection .
uvx --from "$(grep -o 'zizmor==[0-9.]*' .github/workflows/ci.yml)" zizmor --strict-collection .
```

With `GH_TOKEN` set, zizmor also runs its online audits, as CI does.

If you touched anything under `skills/`, CI also runs the skill audit (`.github/workflows/skill-audit.yml`),
which is the pre-flight for the vendor audits skills.sh publishes on the skill's public page after
release. To run the same gate locally:

```bash
pnpm skill:audit           # Snyk Agent Scan against skills/
```

It needs [uv](https://docs.astral.sh/uv/getting-started/installation/) and a `SNYK_TOKEN` from a
free Snyk account, because the analysis runs server-side. `.github/workflows/skill-audit.yml`
documents every flag it passes and the one risk that is waived.

Four tool pins live in `run:` steps or scripts, where Dependabot does not see them, and are bumped
by hand: zizmor (`ci.yml`), uv and `cisco-ai-skill-scanner` (`skill-audit.yml`), and
`snyk-agent-scan` (`skill:audit` in `package.json`). Each is an exact version, and a bump picks a
release at least a week old, the cooldown Dependabot applies to everything else. Check them on each
release pull request.

If you changed what the skill tells an agent to do, run the skill evals as well. See
[Skill evals](#skill-evals).

For a faster inner loop, run `pnpm dev` inside `packages/cli` and call the stub directly. From
that directory it is `node bin/refs.mjs <args>`; from the repository root,
`node packages/cli/bin/refs.mjs <args>`.

## What CI runs

| Workflow / job | When | What it does |
| --- | --- | --- |
| `ci` / `check` | pull request, push to `main` | `pnpm check`, coverage gate included except on Windows, and the eval graders' negative controls (`scripts/skill-evals/cases.test.mjs`) on Linux, macOS and Windows |
| `ci` / `check (node floor)` | pull request, push to `main` | builds on the development Node, switches to Node 24.2.0, runs `pnpm check`, then smoke-tests the built `dist/refs.mjs`: `--version`, `init`, and `doctor --json` reporting its `node` check as `ok` |
| `ci` / `check (node 26)` | pull request, push to `main` | `pnpm check` on the newest Node LTS line, then builds and runs the bundle's `--version` |
| `ci` / `versions` | pull request, push to `main` | `node scripts/versions.mjs --check` (the files carrying the released version agree), its tests, and the tests of the Codex eval grader adapter and the repair graders, all without `pnpm install` |
| `ci` / `zizmor` | pull request, push to `main` | audits the workflows and `dependabot.yml` with zizmor at the pinned version, online audits included |
| `ci` / `bundle-determinism` | pull request, push to `main` | `scripts/check-bundle-determinism.sh`: two builds must be byte-identical |
| `ci` / `smoke` | pull request, push to `main` | packs the CLI, installs the tarball globally on Linux, macOS and Windows (Git Bash), and runs `scripts/smoke-cli.sh`: `add` of a `file://` fixture, `list`, `sync`, `resolve` and `remove`, each outcome checked |
| `ci` / `smoke-windows` | pull request, push to `main` | the same sequence in PowerShell on Windows, through npm's `.cmd` shim |
| `audit` / `lockfile` | push to `main`, weekly, manual, and pull requests that change the dependency set or the audit | the [dependency audit](#dependency-audit): its own tests, then `scripts/audit-lockfile.mjs` |
| `skill-audit` / `static` | pull request or push to `main` touching `skills/**`, the workflow or `package.json` | Cisco skill-scanner over `skills/`, failing on medium severity and above. It needs no credential, so it runs on pull requests from forks too |
| `skill-audit` / `snyk` | the same paths, on pushes and on pull requests from this repository, not from Dependabot | `pnpm skill:audit` (Snyk Agent Scan) with the one waiver `skill-audit.yml` documents; it needs the `SNYK_TOKEN` secret, which a fork's pull request does not receive |
| `release` / `verify`, `publish`, `verify-published`, `announce` | push of a `v*` tag | see [Releasing](#releasing) |

Dependabot (`.github/dependabot.yml`) opens npm and GitHub Actions updates weekly, each held back
seven days after its release; security updates are not held back. The skill evals never run in CI
([Skill evals](#skill-evals)).

## Dependency audit

`.github/workflows/audit.yml` audits every package in `pnpm-lock.yaml` for known advisories, on each
push to `main`, weekly, on demand, and on pull requests that change the dependency set
(`pnpm-lock.yaml`, `pnpm-workspace.yaml`, a `package.json`, `.npmrc`) or the audit itself.
GitHub's own dependency graph reads only part of the pnpm 12 lockfile, so this is the check that
covers the transitive packages. The
whole lockfile is audited, not only production dependencies: `zod`, `commander` and `smol-toml` are
devDependencies of `packages/cli` and still ship inside its bundle.

It is a workflow of its own, not a job in `ci.yml`, and it is not meant to be a required check.
Advisories are published independently of this repository, so one published against an unchanged
lockfile shows up on `main` and in the weekly run, and turns the audit red on any pull request that
touches dependencies, whatever else it changed. A red audit on your pull request
does not mean your pull request caused it, and the fix can go in a pull request of its own. To run it locally:

```bash
node scripts/audit-lockfile.mjs
```

The exit code says which failure it is, and each calls for a different response:

- **`1`, advisories found.** Triage them as below.
- **`2`, the lockfile was partly unaudited.** `pnpm audit` reported fewer packages than the
  lockfile's registry packages. That is a regression in the tooling, not a clean result: the
  script's header explains the failure it guards against.
- **`3`, the audit did not complete**, from a registry or network error or a report the script
  cannot read. Re-run it. Never read it as clean.

To triage an advisory:

1. **Read the advisory and decide whether the vulnerable code is reachable.** Is the package bundled
   into `packages/cli/dist/refs.mjs`, which is what users install, or is it development tooling
   only? `pnpm why <package>` shows what pulls it in.
2. **Fix it by upgrading** the direct dependency that pulls it in. When no release of that
   dependency has the fix yet, pin the patched version with an `overrides` entry in
   `pnpm-workspace.yaml`. The pull request re-runs the audit.
3. **Accept it only with a record.** Add the GHSA ID to `audit.ignore` in `pnpm-workspace.yaml`
   (`auditConfig.ignoreGhsas` is the older, deprecated spelling, which pnpm still reads), with a
   comment giving the reason it does not apply and a date by which to review it. Remove the entry
   once a fix ships or the date passes. The audit honours pnpm's ignore list.
4. **Reachable code in the shipped bundle blocks a release.** Fix it and cut a patch release.

## Things that will fail review

- **Loosening configuration to make a check pass.** `.oxlintrc.json`, the vitest configs, and the
  coverage thresholds are the contract. If a rule is genuinely wrong, say so and argue the case.
  Do not turn it off to get a green tick.
- **Editing version numbers by hand.** Three files carry the released version and CI compares them.
  Use `pnpm versions --set <version>`.
- **Changing only one changelog.** `CHANGELOG.md` and `packages/cli/CHANGELOG.md` must stay
  byte-identical, and the release workflow enforces it with `cmp`. The packaged copy is what npm
  users see, so both move together.
- **Tests that assert on implementation details** rather than observable behavior. The CLI's
  `--json` envelope is a contract. The shape of a private helper is not.

## Releasing

### Cutting a release

Run every command from the repository root.

1. **Pick the version.** `npm view @kaisers-io/refs version` prints the published one. The new
   version must be a plain `x.y.z`, strictly greater than that. The release workflow refuses
   anything else, and `pnpm versions --set` does not check it.
2. **Branch from an up-to-date `main`:**

   ```bash
   git fetch origin main
   git switch -c chore/release-x.y.z origin/main
   ```

3. **Set the version:** `pnpm versions --set x.y.z`. This writes `packages/cli/package.json`,
   `skills/refs/SKILL.md` (`metadata.cli_version`) and `skills/.codex-plugin/plugin.json`. It
   does not touch either changelog.
4. **Date the changelog.** In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and check that the section is not empty. Then make the packaged copy identical. Keep this
   order: the root file is outside the formatter's scope, and the packaged one is inside it.

   ```bash
   cp CHANGELOG.md packages/cli/CHANGELOG.md
   pnpm fmt
   cp packages/cli/CHANGELOG.md CHANGELOG.md
   cmp CHANGELOG.md packages/cli/CHANGELOG.md
   ```

5. **Check locally:** `pnpm versions --check`, `pnpm check` and `pnpm build`. Then
   `node packages/cli/bin/refs.mjs --version` must print `x.y.z`.
6. **Open a pull request** titled `chore(release): x.y.z`. Its diff is exactly the five files
   above: the three version sites and the two changelogs. Wait for CI, then squash-merge it.
7. **Tag the merge commit on `main`:**

   ```bash
   git fetch origin main
   git tag -a vx.y.z -m vx.y.z origin/main
   git push origin vx.y.z
   ```

   If something else has landed on `main` since the merge, tag the release commit's SHA instead
   of `origin/main`. The workflow's ancestor check allows that.

8. **Approve the deployment.** The `release` run's `publish` job waits for approval in the
   `npm-publish` environment. Check that `verify` is green, then open the run, choose _Review
   deployments_, select `npm-publish` and approve it. The approval is the one gate a tag cannot
   remove (see below).
9. **Watch the rest of the run.** `publish` publishes with a provenance attestation. `announce`
   creates the GitHub release from the version's changelog section. `verify-published` installs
   the package from npm on Linux, macOS and Windows and smoke-tests it. A failure there cannot stop
   the release (see [When `verify-published` fails](#when-verify-published-fails)).
10. **Afterwards**, the next change that needs a changelog entry adds a fresh `## [Unreleased]`
    heading above the released one.

### What the release guards cover

A `v*` tag push is the only trigger, and every guard authorizing the release — the tag/version
match, the changelog checks, the version-regression check, the `origin/main` ancestor check, the
`needs` edge and the `id-token` grant — is content of the tagged tree, because GitHub resolves a
push-triggered workflow from the pushed ref. **A tag whose tree deletes a guard is never subjected
to it.** Every check in `release.yml` therefore constrains an honest release and nothing else.

One gate can live outside the tagged tree, and it has two halves that must both be configured in
settings. A pull request cannot restore either:

1. **A GitHub Environment named `npm-publish`**, which the `publish` job declares, with a
   required reviewer and with "Allow administrators to bypass configured protection rules"
   turned off. That setting is on by default and lets an admin credential skip the approval. A
   deployment tag rule (`v*`) alone is not enough: it checks the ref's NAME, so an adversarial
   tag keeps `environment: npm-publish`, deletes `verify`, and satisfies it.

   This project has a single maintainer, who is the only required reviewer, with "Prevent
   self-review" turned off. With it on, nobody could approve a tag that maintainer pushes
   ([required reviewers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)).
   In that setup the gate guarantees that every release needs an explicit approval by the
   maintainer, in the web UI or through the API. A workflow token, a collaborator who is not a
   reviewer, or a tag pushed from a compromised workflow cannot publish on its own. The gate
   does **not** protect against a stolen maintainer credential that can both push a tag and
   approve the waiting deployment through the REST API
   ([`pending_deployments`](https://docs.github.com/en/rest/actions/workflow-runs#review-pending-deployments-for-a-workflow-run)).
   If more maintainers or release automation come later, the stronger setup is to push release
   tags from a separate identity that is not a reviewer (a bot account or a GitHub App) and to
   turn "Prevent self-review" on. Then the tag pusher and the approver are always different
   identities.
2. **The npm Trusted Publisher entry must name that environment**, alongside the repository and
   the workflow filename. npm's configuration binds the workflow's FILENAME — `npm trust github`
   takes `--file`, `--repository` and an optional `--environment`, and its API expresses the match
   as `workflow_ref: { file }` with no digest of the contents. So without the environment, a tag
   supplying its own workflow at that path mints the token regardless of what this file says.

**Check both, separately.** A publish that fails proves nothing on its own — an already-published
version fails too. What has to be established is: an environment-bearing job waits for an approval
that only the maintainer can give; a correctly configured, approved identity authenticates; and an
otherwise identical identity WITHOUT the environment is refused during authentication.

Also list every trusted-publisher entry on the package, not just the one you edited. npm supports
several independent entries, and an older environment-free entry left in place keeps the old route
open. When you replace one, allow direct `npm publish` explicitly — a newly created entry defaults
to staged publishing.

**What is and is not established.** Binding the environment did not break publishing: every
release since the binding (0.18.0 to 0.19.0) was published by the environment-bound `publish` job.
That does not show whether npm refuses an otherwise identical token minted without the
environment, because a successful environment-bound publish is consistent both with an entry that
requires the environment and with one that ignores it. Two checks settle it:

- `npm trust list @kaisers-io/refs --json`, with the maintainer's login, shows that every entry on
  the package names `npm-publish`. That is the configuration half.
- A negative test of npm's matching on a throwaway package, never on `@kaisers-io/refs`: give it a
  trusted-publisher entry that names an environment, publish once from a job that declares the
  environment (must succeed) and once from an otherwise identical job that does not (must be
  refused during authentication).

The negative test has not been run yet. When it is, record its date and outcome here.

Binding the environment also means a commit whose `release.yml` predates it can no longer be
released from, even though the ancestor check still allows tagging it.

The version-regression guard refuses a tag whose version is not strictly greater than the one npm
serves as `latest`, and refuses anything that is not a plain `x.y.z` — a prerelease included,
since this workflow publishes stable releases and guessing an order for `1.0.0-rc.1` is how one
goes out under the wrong dist-tag. npm 11 already rejects a lower version on the implicit tag, so
this is a stricter restatement that `--tag` and `--force` cannot bypass. It fails closed: a lookup
that errors stops the release, and only a lookup that succeeds and reports nothing is treated as a
first publication.

### When `verify-published` fails

After `publish`, the `verify-published` job waits until npm serves the version, installs it from
the registry on Linux, macOS and Windows, and runs `scripts/smoke-cli.sh` against it. The package
is already public by then, so the job cannot stop or undo the release.

- **Re-run it first** when the failure looks like registry lag, such as an install that cannot
  find the version, rather than a broken CLI.
- **On a real failure, deprecate the version and ship a fix.** Deprecate with your own npm login,
  because trusted publishing does not cover `npm deprecate`:

  ```bash
  npm deprecate @kaisers-io/refs@x.y.z "broken on <platform>; use x.y.(z+1)"
  ```

  Then release a fixed patch version through the normal flow.
- **Do not unpublish.** A version number can never be used again.
- **Deprecation only warns.** While `latest` points at the broken version,
  `npm i -g @kaisers-io/refs` still installs it. The fix release is what repairs installs.

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
The repair-command graders of `drift-repairs` and `quoted-repair` keep their wrong and right
commands in `scripts/skill-evals/repair-graders.test.mjs`, which CI runs without a model
(`node --test scripts/skill-evals/repair-graders.test.mjs`). When you change one of those patterns,
add the command it must now reject or accept there.

`scripts/skill-evals/cases.test.mjs` does that offline for the source-provenance, version-compare,
hostile-source and add-hostile-description cases: each is graded on a crafted correct run, which
must pass every grader, and on crafted wrong runs, each of which must fail exactly the graders it
names (`node --test scripts/skill-evals/cases.test.mjs`, no credential needed). A grader that no
wrong run fails makes the test fail. A new case's graders belong there too.

Graders named `boundary-…` check a safety boundary: the checkout left unchanged, nothing written
that planted text asked for, nothing finalized without approval. Report them on their own. A run
that answers well and crosses a boundary has failed, however many other graders it passed.

What a grader can check is bounded by `claude plugin eval` itself: a regex over the reply, the
transcript or a file in the run directory, a Bash call's input, and `file_exists` over the files
the run created. There is no step after the run that could compare the run directory with a
snapshot taken before it, so a boundary is checked against what the scaffold is known to write:
a checkout file matched whole, a branch at a sha that pinned commit dates make fixed, no file
created under the sources, config.toml without the entry a finalize would write. That covers the
files the graders name, not every file in the checkout. A regex over the reply also cannot check
every claim the reply makes: the `no-…` graders reject the contradictions a right-looking reply
can carry ("bytes, not megabytes"), in the forms they spell out, and no more.
