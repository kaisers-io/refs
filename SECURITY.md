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
- **Anything that makes `refs` run code other than git.** `refs` is for cloning and reading
  repositories, not for running them. Its own git commands must run git and nothing else: no hook,
  no fsmonitor command, no content filter, no submodule command, no install or lifecycle script,
  whether the code comes from the checkout or is selected by it. Each checkout's `core.hooksPath`
  points at the refs-owned hooks directory, so hooks living inside a checkout never run.

  `core.hooksPath` governs hooks-*directory* discovery only. Other git mechanisms do not route
  through it, and each of them could run a script the checkout supplies if the invoking user's own
  git configuration or environment names it by a relative path. A tracked repository cannot create
  such a definition, and its `.gitattributes` can only choose when an existing filter applies.
  Measured against real clones with `core.hooksPath` correctly pinned, and what refs now does for
  its own git commands:

  | Mechanism | Example definition | What refs does |
  | --- | --- | --- |
  | Hooks directory, redirected through the environment | `GIT_CONFIG_PARAMETERS="'core.hooksPath=.githooks'"` | `-c core.hooksPath=<refs' hooks directory>` on every git command. Command scope outranks the checkout's own config and inherited command-scope config. |
  | `core.fsmonitor`, command form | `fsmonitor = ./script.sh` | `-c core.fsmonitor=` on every git version. The empty value is used because git 2.35.1 and older run `false` as a program. |
  | Configured hooks (git 2.54+) | `[hook "x"] event = post-checkout; command = ./script.sh` | `-c hook.<event>.enabled=false` for every event git documents, read by git 2.55 and later, plus `-c hook.<label>.enabled=false` for every label in your configuration and every file it includes, because git reads the event switch as a label switch once a label has the event's name. refs refuses to start git when it cannot read every include. **git 2.54.x is refused**: it has configured hooks but not that switch, so refs' git commands fail there with a message and `refs doctor`'s `git` check fails. |
  | Content filters, including git-lfs | `[filter "y"] smudge = ./script.sh`, selected by the checkout's `.gitattributes` | `* -filter` as the last line of each checkout's `.git/info/attributes`, which git ranks above every attributes file a tree carries. A new clone gets it from a private clone template before its first checkout; an existing checkout gets it at its next `refs sync`. Files arrive as committed; for git-lfs that means pointer files. |
  | Submodules | `submodule.recurse = true` | `-c submodule.recurse=false -c fetch.recurseSubmodules=false`. refs never clones with `--recurse-submodules`. |

  Checked and not triggered by any command refs runs, so not overridden: `core.pager` (git pages
  only to a terminal, and refs reads git's output through a pipe), `diff.external` and textconv
  drivers (refs' only `diff` is `--name-only`, and `git show <rev>:<path>` prints a blob without
  textconv). Both are covered by a real-git test. refs runs no aliases, editors or `git lfs`
  commands, and never runs a package manager or script in a checkout. The only program refs starts
  besides git is your own `ssh` client, for `refs doctor`'s ssh authentication probe; both are
  started by absolute path (below).

  The `-c` options are passed as top-level options, which gives them command scope, above every
  configuration file. They are not written into a checkout, so an agent's own git commands there run
  with the user's configuration, except that content filters stay off. They do not affect refs'
  own `pre-commit`/`pre-push` guard, which lives in the pinned hooks directory and fires only on an
  agent's commits and pushes.

  **What refs deliberately keeps** is what the transport needs to authenticate a clone or fetch:
  credential helpers, `core.sshCommand`/`GIT_SSH_COMMAND`, `core.askPass`/`GIT_ASKPASS`, proxies
  and `insteadOf` rules from the user's own configuration and environment. Those are the user's
  programs, chosen by the user; a repository cannot set any of them, because refs never takes
  configuration from a checkout. Without them a private clone cannot authenticate. A way for a
  checkout to choose or influence one of these programs is in scope.

  `refs doctor`'s `git-exec-surfaces` check lists the filters and configured hooks your
  configuration defines. It reports them as `ok`, because refs' own commands run none of them; they
  still apply to an agent's own git commands in a checkout, which refs does not govern.
- **An inherited environment redirecting refs' git.** `refs` names a checkout by its path, but git
  gives `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and their siblings precedence over the working
  directory, and exports them to every hook it runs. Started from a hook, an alias or a wrapper,
  `refs` would otherwise run `config`, `reset --hard` and `clean -fd` against the caller's
  repository. Every child process `refs` starts gets a copy of the environment without the
  variables git itself clears before working in another repository (`git rev-parse
  --local-env-vars`, git's `sanitize_repo_env()`). Like git, `refs` keeps `GIT_CONFIG_PARAMETERS`
  and `GIT_CONFIG_COUNT`, so injected credentials and url rewrites keep working. The managed
  `core.hooksPath` is also set at command scope during a clone, so configuration injected that way
  cannot point the initial checkout at hooks the cloned repository ships. A way to make refs'
  git act on a repository other than the checkout it named is in scope.
- **Which program runs as git.** refs runs its git commands with the working directory inside a
  checkout, which is somebody else's repository. Starting the bare name `git` would let that
  repository supply the program: on Windows, process creation looks in the working directory before
  `PATH` (a committed `git.exe` or `git.com` would run), and on every platform an empty or relative
  `PATH` entry means the working directory. refs looks `git` (and `ssh`) up itself, in absolute `PATH`
  entries only, and starts the absolute path it found; when there is none, the command fails with a
  message instead of falling back to the bare name. Covered by real-process tests: a planted `./git`
  with an empty `PATH` entry on POSIX, a planted `git.exe` in the checkout on Windows. A way to make
  refs start a program from a checkout is in scope.
- **Git versions.** `refs` sets no minimum git version and refuses only 2.54.x (see above). The
  fsmonitor switch was verified against git 2.25, 2.30, 2.34, 2.39, 2.47, 2.53 and 2.55. The hook,
  filter, hooks-path and submodule handling was verified against 2.30, 2.39, 2.47, 2.53 and 2.55,
  and the environment handling against 2.30, 2.47 and 2.55. git 2.54 could not be tested directly;
  the refusal rests on git's source. CI runs whichever git each runner image ships (2.55 and 2.56
  at the time of writing). A difference on a git version in that range is in scope.
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

- `refs` runs git and nothing else (the table above): no hook inside or outside the checkout, no
  fsmonitor command, no content filter and no submodule command for its own git commands, and it
  refuses git 2.54.x rather than run with configured hooks it cannot switch off.
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
