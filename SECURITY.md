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
- Leaking credentials embedded in git URLs — into error messages, logs, `--json` output, or the
  config file. This has been a real bug class here before and is covered by dedicated regression
  tests.
- Path traversal out of `REFS_HOME` when resolving refs, packages, or checkout paths.
- Anything that causes `refs` to execute code from a checked-out reference repository. `refs` runs
  git commands against checkouts; it must never run *their* code, including git hooks that came
  from the remote.
- Supply-chain problems in the published `@kaisers-io/refs` package — an unexpected bundled
  dependency, a lifecycle script, or a mismatch between the published artifact and this
  repository.

## What is not in scope

**Read-only is a workflow promise, not a security boundary.** This is stated in the README and
matters for triage: every checkout under `sources/` is a managed reference that agents are
instructed not to modify, and `refs` installs git hooks that reject commits and pushes inside one.
Those hooks are a backstop against mistakes, not a sandbox. Reports that a sufficiently determined
local process can still write into a checkout — by removing the hooks, using `--no-verify`, or
editing files directly — describe documented behavior rather than a vulnerability.

Similarly out of scope:

- Vulnerabilities in the dependency source code that `refs` checks out. Report those upstream.
- Anything that requires an attacker to already control the machine `refs` runs on.
- Findings from automated scanners without a demonstrated impact on `refs`.
