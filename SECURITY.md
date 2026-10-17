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
  (`[filter "y"] smudge = ./script.sh`) ran it during `refs add`'s clone and `refs sync`'s checkout.
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

This section describes the controls added by #249, #251 and #252. It holds for a release that
contains all three, and not for an earlier one.

Every process `refs` starts goes through one spawner. The environment, the configuration overrides
and the time limit below are applied there, so no command and no call site opts out of them. The
command-scope hooks path is the exception: it is added per call site, and its coverage is stated
with it. All of this changes only what `refs` hands its own children. The invoking shell's
environment and the user's git configuration are left as they are, and an agent's own git commands
inside a checkout are not `refs`' invocations: they keep the user's settings, hooks and fsmonitor
included.

**The environment.** `refs` names a checkout by the working directory it runs git in. git lets
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` and their
siblings override that, and git exports exactly these to every hook it runs. A `refs add` or
`refs sync` started from a hook, an alias or a wrapper therefore used to run its `config`,
`reset --hard` and `clean -fd` against the caller's repository. `refs` now removes these from
every child: `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_CONFIG`, `GIT_DIR`,
`GIT_GRAFT_FILE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_NO_REPLACE_OBJECTS`,
`GIT_OBJECT_DIRECTORY`, `GIT_PREFIX`, `GIT_REPLACE_REF_BASE`, `GIT_SHALLOW_FILE` and
`GIT_WORK_TREE`, plus `GIT_INTERNAL_SUPER_PREFIX` for older gits. Names match case-insensitively on
Windows. That is what `git rev-parse --local-env-vars` prints on git 2.43.0, 2.54.0 and 2.55.0,
less the two kept below. The list is fixed in `refs`, and a test fails when the installed git
prints a name it lacks.

What stays follows git's own rule for the same operation (`sanitize_repo_env()`):

- Command-scope configuration, `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` with its
  `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pairs. CI injects credentials and `insteadOf`
  rewrites that way.
- Variables that say how git runs rather than where: `GIT_SSH_COMMAND`, `GIT_ASKPASS`,
  `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, `GIT_TRACE*`, proxy settings.

Both are the invoking user's configuration and are trusted as far as their global git
configuration is, with one exception `refs` enforces: the hooks directory. Command-scope
configuration outranks the refs-owned `core.hooksPath` stored in a checkout, git exports
`GIT_CONFIG_PARAMETERS` to every hook started under `git -c`, and a relative value such as
`.githooks` resolves inside the checkout. A `refs` started from such a hook would run hooks the
cloned repository tracks. So these commands also carry `-c core.hooksPath=<refs' hooks directory>`
at top level, which git applies after the inherited value: the clone, every git command of a
sync, `refs doctor`'s dirty-checkout check (`git status`, which refreshes the index and so runs
`post-index-change` once a tracked file's timestamp has changed), and the `git remote set-head`
that default-branch detection falls back to when a checkout has no `origin/HEAD` (from git 2.54
that ref update runs `reference-transaction`). The other git commands `refs` runs against a
checkout are not pinned: configuration reads and the marker write, `remote get-url`/`set-url`,
`rev-parse`, `symbolic-ref`, `show-ref`, the tag listing, `ls-tree`, `show <rev>:<path>` and the
tree-to-tree `diff --name-only`. Each was run under an inherited relative `core.hooksPath`, with a
hook of every documented name tracked by the checkout, on git 2.43.0, 2.54.0 and 2.55.0, and none
ran a hook.

Two more defaults bound how long git can hold `refs`, which matters because `refs` holds the ref's
lock meanwhile. `GIT_TERMINAL_PROMPT` is `0` unless the user has set it, so git fails instead of
waiting at an HTTPS credential prompt nobody can answer; credential helpers and `GIT_ASKPASS` keep
working. And each command ends after `REFS_GIT_TIMEOUT` seconds (900 by default, `0` for no limit;
a value that is not a whole number is ignored; `refs doctor`'s ssh probe keeps its own limit).

On POSIX, `refs` lists the command's descendants with `ps` before it signals anything, sends
`SIGTERM` to the command and to every descendant listed, and waits until all of them are gone. If
any is still running two seconds later, they get `SIGKILL`, and `refs` checks for up to one more
second that they ended. The command returns only then, not when its own process closes: a
descendant that ignores `SIGTERM` and no longer holds git's output would otherwise keep running
after `refs` had moved on. git stays in the terminal's session, so ssh can still ask for a
passphrase. Once the command itself has exited, its process id is not signalled any more, since it
may have been reused. On Windows, `refs` runs `taskkill /T /F` from `%SystemRoot%\System32` by
absolute path, never by bare name, and ends only the direct child when `SystemRoot` is not an
absolute path.

What `refs` can confirm has limits. The processes it waits for are the command itself and the
descendants `ps` listed while the command was alive. A process that left the tree before it was
listed, or that a surviving process starts later, is not known to `refs`, and nothing here says it
ended. On Windows only the direct child is confirmed, because `taskkill /T` walks the tree itself.
When a known process is still running at the end, or a `ps` listing failed, the error says so:
`refs: processes the command started may still be running`. All of this bounds time, not anything
a server sends.

A clone that fails, by timeout or otherwise, is removed only when nothing was at the destination
before it (checked with `lstat`, so a dangling symlink counts as something), the destination holds
a `.git` afterwards, and the clone did not report that its processes may still be running. When it
did, `refs` does not delete the half-made clone, which a surviving process may still be writing
into. It leaves it in place and unsets its `core.hooksPath` marker, so the next `refs add` or
`refs sync` refuses it instead of adopting it, and the error names the path and tells the user to
remove it once those processes have exited. A fetch that times out in an existing checkout only
reports the uncertainty; nothing is removed or set aside. Anything else at the destination is left
alone.

**Configuration overrides.** The `core.fsmonitor=` and `hook.<event>.enabled=false` options the
code-execution note above describes are top-level `-c` options. That makes them cover the checkout
a clone performs and every git child process, and keeps them out of the checkout's own config. git
reads them after inherited command-scope configuration, so a `GIT_CONFIG_PARAMETERS` or
`GIT_CONFIG_COUNT` entry that re-enables either does not win (measured on git 2.43.0, 2.54.0 and
2.55.0). The events switched off are the ones `refs`' own commands fire: `post-checkout`,
`post-index-change`, `pre-auto-gc` and `reference-transaction`.

The event switch is not enough on its own. git 2.54 has configured hooks but no event-level
switch. git 2.55 has one, but it reads `hook.<name>.enabled` as a label's switch once the
configuration gives a hook label that name: with `[hook "post-checkout"] command = …` defined,
`hook.post-checkout.enabled=false` switches off that one label, and every other label on
`post-checkout` still runs. So on every git from 2.54 `refs` also adds one
`hook.<label>.enabled=false` per label, whatever its event, read from the configuration and every
file it includes, conditional or not, as the note above says. The event switches stay as a second
layer. The command fails with the reason, and git is not started, when that graph cannot be read
whole: an include `refs` cannot read, more than 10 levels or 64 files, a relative include set
outside a file, or a label containing `=`. It also fails when an include lies inside the checkout
the command works on, which for a clone is its destination, however many global options precede
the `clone`.

None of these options affects hooks in the hooks directory, so `refs`' commit and push guard still
runs. One cost is fsmonitor's acceleration for `refs`' own `status`, `checkout` and `reset`, which
refresh the index by a full scan instead. The other, on git 2.54 and later, is the label
inventory: `git --version` once, then a configuration listing plus two reads per configuration
file. `refs` takes it once per process and reuses it for later git commands in the same working
directory and environment, as long as every configuration file and include it read still has the
same content (compared byte for byte, not by timestamp). A changed file, or another working
directory such as a new clone's, means a new inventory. Reuse can miss one case: a global or system configuration
file that did not exist, or held no entry, when the inventory was taken and gains one while `refs`
is still running. Measured on `sindresorhus/slugify` with one global configuration file, counting
git processes through a logging `git` shim:

| command                | `refs` 0.18.2, any git | git 2.43.0 | git 2.54.0 and 2.55.0 |
| ---------------------- | ---------------------- | ---------- | --------------------- |
| `refs add`             | 7                      | 10         | 26                    |
| `refs sync`, 5 commits | 20                     | 21         | 26                    |
| no-op `refs sync`      | 11                     | 12         | 17                    |

On 2.54.0 and 2.55.0, `refs add` took about 110 to 140 ms longer than 0.18.2 (median of five
runs). For `refs sync` the difference was within the run-to-run variation.

What each git version gets:

| git        | fsmonitor command | configured hooks, for `refs`' own commands                    |
| ---------- | ----------------- | ------------------------------------------------------------- |
| below 2.54 | off               | do not exist in this git                                      |
| 2.54       | off               | off, by label; git not started if one may be missed           |
| 2.55 on    | off               | off, by label and event; git not started if one may be missed |

**What still runs.**

- **Content filters**, deliberately (#187). Turning one off changes what the checkout contains, and
  a required filter such as git-lfs's fails the checkout outright. A filter the user's
  configuration defines and the checkout's `.gitattributes` selects therefore runs during the
  checkout `refs add`'s clone performs and during `refs sync`'s checkout. With a relative command
  (`filter.doc.smudge = ./.tools/smudge.sh`) that is the checkout's own tracked script, measured on
  git 2.43.0, 2.54.0 and 2.55.0. `refs add` warns before it clones (`git-exec-surfaces: …`) and
  `refs doctor`'s `git-exec-surfaces` check reports the definition. Neither stops it: a warning is
  not neutralisation, and nothing here claims otherwise.
- **Hooks from an inherited `core.hooksPath` in a command that is not pinned.** None of today's
  unpinned commands ran one (above). The pin is added per call site, so a git command `refs` adds
  later, or an existing one that starts writing refs or the index, is covered only if its call
  site adds it.

Checked and not triggered by the commands `refs` runs, so not overridden: `diff.external` and
textconv drivers (`refs`' only diff is `--name-only`, and its `git show <rev>:<path>` prints the
blob without textconv), and `core.pager` (git pages only to a terminal, and `refs` reads git's
output through a pipe). Measured on git 2.43.0, 2.54.0 and 2.55.0 with all three defined in the
user's configuration and the drivers selected by the checkout's `.gitattributes`.

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
