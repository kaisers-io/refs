---
name: refs
description: Answer questions about a dependency's real source, history, and releases from the local checkouts managed by the refs CLI.
argument-hint: 'What to look up in a tracked repo — or a refs task like add, sync, or doctor'
disable-model-invocation: true
metadata:
  cli_version: '0.8.2'
---

# refs

`refs` gives coding agents real, local source code for the libraries and repos a
project depends on, so questions about behavior, history, and releases get answered
against the actual checkout — never against training data or `node_modules` bundles.

If this skill directory still contains a `references/` subdirectory, it is left over
from an older manual install. Ignore it; the files beside this one are authoritative.

## 1. Capability gate

Run `refs --version`.

- **`refs: command not found`** → the CLI isn't installed. Check `node --version` first;
  refs needs Node.js `>=24.2`, and on a mismatched runtime that is the real problem
  (suggest `nvm install 24`) rather than a failed install. Otherwise tell the user the
  CLI is on npm as `@kaisers-io/refs`, ask permission to install it globally, and on yes
  run `npm i -g @kaisers-io/refs`, then re-run `refs --version` and take the branch below.
  On no, print the command for later and stop.
- **A version** → compare it against `metadata.cli_version` above. Fixes:
  `npm i -g @kaisers-io/refs@latest` (CLI behind), `npx skills add kaisers-io/refs` (skill behind).
  - Equal → continue.
  - Either side isn't a plain `x.y.z` (e.g. `0.6.0-rc.1`) → don't name a side; report both
    versions, suggest both fixes, and stop.
  - Only the patch differs → report it, name the side that's behind and its fix, note that
    `refs --help` outranks `COMMANDS.md` where the two disagree, and continue.
  - Major or minor differs → report likewise and stop; `COMMANDS.md` is written against the
    pinned version, so commands or flags it documents may not exist here.
  - `refs --help` and `refs <command> --help` stay usable whenever we stop (§2).

`refs doctor --json` is the health check, not the gate — run it when something looks wrong
or the user asks for it, and report every non-`ok` check in plain terms. `MAINTAIN.md`
explains each one.

## 2. What refs is

`refs` manages arbitrary git repositories (GitHub, GitLab, self-hosted) as local,
read-only reference checkouts. `COMMANDS.md` beside this file is the command and
`--json` reference; it is written against the CLI version pinned in this file's
frontmatter. `refs --help` and `refs <command> --help` remain the fallback on any
version mismatch, or for a flag `COMMANDS.md` doesn't cover.

**Always pass `--json`** when running `refs` for agent purposes. Every command emits a
stable envelope — `{"ok":true,"data":…,"warnings":[…]}` on success,
`{"ok":false,"error":{"code":…,"message":…}}` on failure — and that is the contract to
parse. Never scrape the human-readable output.

Exit codes: `0` ok · `1` unexpected · `2` usage · `3` validation · `4` not found · `5`
conflict. `sync` and `doctor` are special: they report per-item failures inside an
`ok:true` envelope, because a partial batch failure is not itself a command failure, but
still set a non-zero exit code. Check both the envelope contents and the exit code.

## 3. Read-only invariant

Every checkout under the refs home's sources directory is a **managed reference, not a
working copy**. Paths come from `refs resolve` or `refs show` — never hardcode or guess
one.

- Read freely: `git log`, `git diff`, `git show`, `git blame` are encouraged. Leave the
  checkout exactly as you found it — no edits, no `git add`, `commit`, `push`,
  `checkout -b`, or `reset`.
- Route every change to a ref through the CLI (`refs sync`, `refs remove`), never through
  raw git you run yourself.
- This is a workflow promise, not a sandbox. refs-installed hooks reject commits and
  pushes inside a checkout as a backstop, and `refs sync` auto-restores a dirty checkout
  if something slips through. A hook rejection means something upstream of this skill went
  wrong — report it rather than working around it.

## 4. Where to go next

Read only the file the task needs. They are kept thin on purpose because the CLI, not this
skill, does the deterministic work.

- **A question about a dependency's source, behavior, design, or history** — "how does X
  implement Y", "why did X do Z", "what changed between vA and vB" → [INVESTIGATE.md](INVESTIGATE.md)
- **Start tracking a new repo** — "add X as a ref", "track this repo", batch-adding
  several → [ADD.md](ADD.md)
- **Refresh or check existing refs** — "sync my refs", "run doctor", "remove ref X" →
  [MAINTAIN.md](MAINTAIN.md)
- **Getting started with refs at all** — "onboard me", "set up refs", "what is refs" →
  [ONBOARDING.md](ONBOARDING.md)
- **A command's flags or its `--json` shape** → [COMMANDS.md](COMMANDS.md)

## 5. Subagent dosing rule

Scale subagent use with the task, not a fixed scheme:

- **One repo plus a clear question → one worker, don't ask.** Just dispatch it.
- **Large or multi-part work** (several repos, deep multi-angle analysis, several
  sub-questions) → propose a split before spawning anything: _"This is large; I'd split it
  across N subagents — ok?"_ Proceed once the user agrees.

Platform note: on Claude Code, spawn subagents natively. On Codex, subagents are opt-in —
tell the user to include `use subagents` in their request; otherwise do the same analysis
inline and sequentially. Both paths reach the same result; only context isolation differs.
