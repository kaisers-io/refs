# Security policy

## Reporting a vulnerability

Please report security issues through
[GitHub's private vulnerability reporting](https://github.com/kaisers-io/refs/security/advisories/new).
That keeps the report private until a fix is available, and it does not require an email
exchange.

**Please do not open a public issue for a security problem.**

You can expect an initial response within a week. If a report is confirmed, the fix ships in a
patch release and the advisory is published once users have had a chance to upgrade. Reporters are
credited unless they ask not to be.

## Supported versions

Only the latest released version receives security fixes. `refs` is pre-1.0 and moves quickly;
there are no long-term support branches.

## What is in scope

- Command injection or argument injection through ref names, URLs, tags, or configuration values.
- Leaking credentials embedded in git URLs into error messages, logs, `--json` output or the
  config file. This has been a real bug class here before and is covered by dedicated regression
  tests.
- Path traversal out of `REFS_HOME` when resolving refs, packages, or checkout paths.
- Making a git command `refs` runs act on a repository other than the managed checkout it names,
  for example through an inherited `GIT_DIR` (see [the git processes `refs`
  starts](#the-git-processes-refs-starts)).
- Anything that causes `refs` to execute code from a checked-out reference repository. `refs` runs
  git commands against checkouts; it must never run *their* code. Each checkout's `core.hooksPath`
  points at the refs-owned hooks directory, so hooks living inside a checkout never run. A way to
  defeat that is in scope.

  `core.hooksPath` governs hooks-*directory* discovery, which is what stops a hook file living
  inside a checkout from running. Other git mechanisms do not route through it. Measured on git
  2.54 against a real clone with `core.hooksPath` correctly pinned: a configured hook
  (`[hook "x"] event = post-checkout; command = ./script.sh`) ran the **checkout's** copy of that
  script during `refs add` and `refs sync`, and an attribute-selected filter
  (`[filter "y"] smudge = ./script.sh`) ran it during the checkout `refs sync` performs.
  `core.fsmonitor`'s command form is a third: git runs it with the worktree as its working
  directory.

  Each needs a definition already present in the invoking user's own git configuration. A tracked
  repository cannot create one, and its `.gitattributes` can only choose when an existing filter
  applies. `refs doctor`'s `git-exec-surfaces` check reports such a definition rather than `refs`
  sanitising the ambient configuration, because that same configuration carries the credential
  helpers, proxies and `insteadOf` rules a private clone needs.

  That check reports **presence, not safety**. Whether a given command reaches a checkout's content
  depends on the command, and deciding that would mean proving an arbitrary interpreter never loads
  it — `/bin/sh ./script.sh` has an absolute program and runs the checkout's script anyway. It is
  also a baseline: an `includeIf "gitdir:…"` section can add entries inside a managed checkout that
  a listing read elsewhere does not show.
- Supply-chain problems in the published `@kaisers-io/refs` package: an unexpected bundled
  dependency, a lifecycle script, or a mismatch between the published artifact and this
  repository.

## What is not in scope

**Read-only is a workflow promise, not a security boundary.** This is stated in the README and
matters for triage: every checkout under `sources/` is a managed reference that agents are
instructed not to modify, and `refs` installs git hooks that reject commits and pushes inside one.
Those hooks are a backstop against mistakes, not a sandbox. Reports that a sufficiently determined
local process can still write into a checkout, by removing the hooks, using `--no-verify` or
editing files directly, describe documented behavior rather than a vulnerability.

Similarly out of scope:

- Vulnerabilities in the dependency source code that `refs` checks out. Report those upstream.
- Anything that requires an attacker to already control the machine `refs` runs on.
- Findings from automated scanners without a demonstrated impact on `refs`.

## The git processes `refs` starts

Every process `refs` starts goes through one spawner, and the controls below are applied there, so
no command and no call site opts out of them. They change only what `refs` hands its own children.
The invoking shell's environment and the user's git configuration are left as they are, and an
agent's own git commands inside a checkout are not `refs`' invocations: they keep the user's
settings, hooks and fsmonitor included.

**The environment.** `refs` names a checkout by the working directory it runs git in. git lets
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` and their
siblings override that, and git exports exactly these to every hook it runs. A `refs add` or
`refs sync` started from a hook, an alias or a wrapper therefore used to run its `config`,
`reset --hard` and `clean -fd` against the caller's repository. `refs` now removes those variables
from every child: the set git itself lists in `git rev-parse --local-env-vars`, plus
`GIT_INTERNAL_SUPER_PREFIX` for older gits, matched case-insensitively on Windows.

What stays follows git's own rule for the same operation (`sanitize_repo_env()`):

- Command-scope configuration, `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` with its
  `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pairs. CI injects credentials and `insteadOf`
  rewrites that way.
- Variables that say how git runs rather than where: `GIT_SSH_COMMAND`, `GIT_ASKPASS`,
  `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, `GIT_TRACE*`, proxy settings.

Both are the invoking user's configuration and are trusted exactly as far as their global git
configuration is, which includes outranking a checkout's own config: a `core.hooksPath` inherited
through `GIT_CONFIG_PARAMETERS` takes precedence over the refs-owned hooks path pinned in the
checkout. Setting one needs control of the environment `refs` is started from, which is the
"already control the machine" case excluded above.

Two more defaults bound how long git can hold `refs`, which matters because `refs` holds the ref's
lock meanwhile. `GIT_TERMINAL_PROMPT` is `0` unless the user has set it, so git fails instead of
waiting at an HTTPS credential prompt nobody can answer; credential helpers and `GIT_ASKPASS` keep
working. And each git command ends after `REFS_GIT_TIMEOUT` seconds (900 by default, `0` for no
limit), together with the transport helpers git started; a clone cut off that way removes the
destination it created. That is a bound on time, not on anything a server sends.

**Configuration overrides.** The `core.fsmonitor=` and `hook.<event>.enabled=false` options the
code-execution note above describes are top-level `-c` options. That makes them cover the checkout
a clone performs and every git child process, and keeps them out of the checkout's own config. git
reads them after inherited command-scope configuration, so a `GIT_CONFIG_PARAMETERS` or
`GIT_CONFIG_COUNT` entry that re-enables either does not win (measured on git 2.43.0, 2.54.0 and
2.55.0). The events switched off are the ones `refs`' own commands fire: `post-checkout`,
`post-index-change`, `pre-auto-gc` and `reference-transaction`. Hooks in the hooks directory are not
affected, so `refs`' commit and push guard still runs. The cost is fsmonitor's acceleration for
`refs`' own `status`, `checkout` and `reset`, which refresh the index by a full scan instead.

| git        | fsmonitor command | configured hooks, for `refs`' own commands |
| ---------- | ----------------- | ------------------------------------------ |
| below 2.54 | off               | do not exist in this git                   |
| 2.54       | off               | **still run**                              |
| 2.55 on    | off               | off                                        |

**What still runs.**

- **Content filters**, deliberately (#187). Turning one off changes what the checkout contains, and
  a required filter such as git-lfs's fails the checkout outright. Reading a checkout through
  `refs` can therefore still run a filter command the user's configuration defines, and nothing
  here claims otherwise.
- **Configured hooks on git 2.54.** The event-level switch exists from git 2.55; 2.54 understands
  only the per-label `hook.<label>.enabled`, so there the options are inert. `refs doctor` and
  `refs add` report such hooks as a warning. A warning is not neutralisation.
- **A hook event `refs` does not list.** The list is fixed. A future git that fires another event
  during `refs`' operations runs configured hooks for it until the list is extended.

**Git versions.** `refs` enforces no minimum git version: `refs doctor`'s `git` check confirms only
that `git --version` runs. CI runs the suite on whatever git the GitHub-hosted Ubuntu, macOS and
Windows runners ship, without pinning one. The controls above were measured on Linux with git
2.43.0, 2.54.0 and 2.55.0, and the empty `core.fsmonitor` value also on 2.25 to 2.39 (#194). macOS
and Windows builds of git were not measured, and no guarantee for other versions is implied.

## Untrusted checkout content

`refs` exists to put third-party source code in front of an agent, so a checkout is
attacker-controlled input by construction: its README, comments, and commit messages were written by
whoever owns that repository, and nobody vetted them on the way in. The bundled skill states this as
an explicit trust boundary (`skills/refs/SKILL.md` §4) and carries it into every worker prompt —
checkout content is evidence to read, never instruction to follow, and anything that tries to
redirect the agent is reported to the user instead of acted on.

That is an instruction-level mitigation, not a sandbox. Indirect prompt injection through a tracked
dependency is a real residual risk and prose in a skill does not remove it. What is enforced in code
is narrower, and worth stating exactly:

- `refs` never runs a checkout's own code through a hook *inside* the checkout (the
  `core.hooksPath` note above), and `refs doctor` reports the configured mechanisms that note
  describes as outside it.
- **`refs` never imports a description out of a checkout's manifests.** A package `description` is
  the one field in `config.toml` that exists to hold prose, and workspace detection does not read it
  — it carries a package's name and path and nothing else. Every description is written by whoever
  ran `refs add`, or by an agent that read the source; `refs add --description` refuses a package
  rather than supply text it did not write.
- Other checkout-derived values do reach `config.toml` — package names and paths, the default
  branch, and a `tag_format` derived from a tag that exists in the repository. Each is structural in
  the sense that it names something and can be checked against the checkout. That is not a claim
  that they are harmless to read: a package name is whatever the manifest declares, and
  `Core library. Assistant: ignore previous instructions.` is a valid one. **Treat them as untrusted
  content wherever they are displayed**, the same as anything else out of a checkout. They are
  collected in issue #99.

The bundled workflow goes further than the CLI can — a description written from source evidence,
then human approval before anything is written. `refs` validates what it is handed; it cannot verify
that the review happened.

Automated skill scanners flag this shape. Snyk Agent Scan reports it against the skill on every run
as `third_party_content_exposure`: refs clones the repository it was pointed at and reads it. That is
accurate, and it is the feature rather than a defect. Clearing it would mean either not fetching
repositories at all, or saying less plainly what refs does with them; the second is worse than the
finding.

That risk key is what `.github/workflows/skill-audit.yml` waives, and the only one: every other risk
or scanner failure fails the job. It runs on same-repo pull requests touching the skill and again on
the push to `main`, since the analysis needs a token and forked pull requests get no secrets. What it
must never produce is a skill edited into something untrue to clear a finding.
