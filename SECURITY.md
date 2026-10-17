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

## Git execution controls in unreleased builds

References are source to clone and read, never programs to run. Before its own Git operations,
refs inventories system, global, repository, worktree and injected command-scope configuration,
then recursively visits every include, including inactive `includeIf` branches. Git itself parses
and expands paths. Unreadable, cyclic, oversized, malformed or unrepresentable configuration
fails closed. Like Git, refs may ignore a missing external include, but only after checking that
no current or prospective reference checkout can create or redirect it. Existing symlink targets
and path prefixes are checked too; dangling links and unresolved dot components are refused.
Windows drive-rooted includes are inspected on every relevant client worktree drive; unsupported
device-namespace paths are refused. Config and helper paths are checked through every intermediate
alias, not only at their final targets. On macOS and Windows, a still-absent protected directory also protects
its nearest existing ancestor against missing config/helper paths, avoiding guesses about filesystem
case, Unicode and Windows short-name aliases. This can refuse missing sibling paths until the protected directory exists;
the CLI creates its owned source directories before cloning. Config loaded from reference content is refused. New clones use an empty template so
template config cannot introduce uninspected commands.

Each inventoried configured hook is disabled by friendly name. This covers Git 2.54 (which lacks
event switches) and the event-name collision in Git 2.55. Traditional hooks use the refs-owned
hooks directory in command scope; fsmonitor receives an empty value, safe on Git 2.35.1 as well.
Configured filters have their commands emptied and `required=true`: an unrelated checkout still
works, but selecting a filter fails explicitly. refs never silently substitutes unfiltered content.
Automatic maintenance and submodule recursion are disabled. Custom remote helpers, upload-pack
commands and alternate-ref commands outside the supported policy are refused.

Authentication and transport remain a **trusted local toolchain boundary**. Credential helpers,
askpass, SSH/proxy commands, the Git executable and its helper search paths must be trustworthy and
must not load code from reference directories. refs rejects relative or reference-owned executable
search paths, identifiable checkout-relative helper/script paths, relative SSH configuration paths,
and unsupported shell control or expansion syntax. Simple external credential helpers and SSH
commands remain usable for private repositories. These checks are deliberately bounded: the selected
external programs, their runtime environment, and the configuration they themselves load remain
trusted. refs cannot prove arbitrary local programs never interpret a reference file.

Transport selection is restricted to HTTP(S), SSH, Git and file transport, respecting any stricter
caller allowlist. `REFS_ALLOW_FILE_URLS=1` permits explicit local source URLs; a trusted `insteadOf`
rule can also select file transport. Local source repository metadata is trusted, including any
server-side configuration used by its upload-pack process. Client policy is not a sandbox for a
local Git server. Concurrent hostile changes to trusted local configuration or executables are
outside this guarantee.

`add` prints the execution-surface baseline before cloning, including on stderr with `--json`.
That diagnostic is visibility, not approval or the enforcement inventory. The shared Git runner
applies the same policy during inspection, final registration and later sync. The historical
measurements below describe the vulnerabilities that motivated these controls.

## What is in scope

- Command injection or argument injection through ref names, URLs, tags, or configuration values.
- Leaking credentials embedded in git URLs into error messages, logs, `--json` output or the
  config file. This has been a real bug class here before and is covered by dedicated regression
  tests.
- Path traversal out of `REFS_HOME` when resolving refs, packages, or checkout paths.
- Anything that causes `refs` to execute code from a checked-out reference repository. `refs` runs
  git commands against checkouts; it must never run *their* code. Each checkout's `core.hooksPath`
  points at the refs-owned hooks directory, so hooks living inside a checkout never run. A way to
  defeat that is in scope.

  `core.hooksPath` governs hooks-*directory* discovery, which is what stops a hook file living
  inside a checkout from running. Other git mechanisms do not route through it. Before these controls, measured on git
  2.54 against a real clone with `core.hooksPath` correctly pinned: a configured hook
  (`[hook "x"] event = post-checkout; command = ./script.sh`) ran the **checkout's** copy of that
  script during `refs add` and `refs sync`, and an attribute-selected filter
  (`[filter "y"] smudge = ./script.sh`) ran it during the checkout `refs sync` performs.
  `core.fsmonitor`'s command form is a third: git runs it with the worktree as its working
  directory.

  Each needs a definition already present in the invoking user's own git configuration. A tracked
  repository cannot create one, and its `.gitattributes` can only choose when an existing filter
  applies. `refs doctor`'s `git-exec-surfaces` check reports such definitions. Enforcement now disables the relevant execution mechanisms while
  preserving trusted credential helpers, proxies and `insteadOf` rules needed by private clones.

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
  `core.hooksPath` note above), and its execution policy additionally covers configured hooks, filters and fsmonitor as
  described above. Trusted local authentication and transport programs are a separate assumption.
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
