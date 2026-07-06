---
name: refs
description: Use when a task touches a dependency or reference project's real source — "what does X do", "how does X implement Y", "why did X change Z", "what changed between vA and vB", "add X as a ref"/"track this repo as a ref", "sync my refs", "run refs doctor", "remove ref X" — or when the user is new to refs ("onboard me", "set up refs", "what is refs", "getting started"). Routes the question to the local, real-source checkout managed by the `refs` CLI instead of relying on training knowledge or minified build output.
compatibility: Requires the refs CLI (npm i -g @kaisers-io/refs), Node.js >=24.12 <25, and git. macOS/Linux only.
---

# refs

`refs` gives coding agents real, local source code for the libraries and repos a
project depends on, so questions about behavior, history, and releases get answered
against the actual checkout — never against training data or `node_modules` bundles.

## 1. Capability gate

Before anything else, confirm the CLI is installed:

```bash
refs --version
```

- **Present** → continue below.
- **Missing** (`command not found` or similar) → run the install flow:
  1. Check the runtime first: `node --version`. refs requires Node.js `>=24.12 <25`.
     On a mismatched Node, report that as the actual problem (suggest e.g.
     `nvm install 24`) — don't attempt the install on the wrong runtime.
  2. Tell the user the refs CLI is distributed on npm as `@kaisers-io/refs` and ask
     for permission to install it globally.
  3. On yes: run `npm i -g @kaisers-io/refs`, verify with `refs --version`, then run
     `refs doctor --json` and report every non-`ok` check in plain terms
     (`references/maintain.md` explains each check).
  4. On no: print the command for later — `npm i -g @kaisers-io/refs` — and stop
     gracefully.

## 2. What refs is

`refs` manages arbitrary git repositories (GitHub, GitLab, self-hosted) as local,
read-only reference checkouts. `refs --help` and `refs <command> --help` are the
authoritative, always-current command reference — written to be agent-friendly, with
examples and `--json` notes. Don't memorize flags from this skill; when in doubt, run
`--help`. **Always pass `--json`** when running `refs` for agent purposes: every command
emits a stable envelope, `{"ok":true,"data":…,"warnings":[…]}` on success or
`{"ok":false,"error":{"code":…,"message":…}}` on failure, and this is the contract to
parse — never scrape the human-readable text output.

Exit codes: `0` ok, `1` unexpected, `2` usage, `3` validation, `4` not found, `5`
conflict. `sync` and `doctor` are special: they report per-item failures inside an
`ok:true` envelope (a partial batch failure is not itself a command failure) but still
set a non-zero exit code when something in the batch failed — check both the envelope
contents and the exit code, not just one.

## 3. Read-only invariant

Every checkout under the refs home's sources directory (paths come from `refs
resolve`/`refs show` — never hardcode or guess one) is a **managed reference, not a
working copy**:

- Never edit, `git add`, `git commit`, `git push`, `git checkout -b`, `git reset`, or
  otherwise mutate a checkout. Read-only git commands are fine and encouraged:
  `git log`, `git diff`, `git show`, `git blame`.
- All changes to a ref (fetching, re-cloning, removing) go through the `refs` CLI
  (`refs sync`, `refs remove`), never through raw git commands you run yourself.
- This is a workflow promise, not a sandbox: `refs`-installed hooks reject commits and
  pushes inside a checkout as a backstop, and `refs sync` auto-restores a dirty checkout
  if something slips through anyway — but the discipline above is what keeps it clean in
  the first place. Never work around a hook rejection; it means something upstream of
  this skill went wrong.

## 4. Trigger table

| The user asks…                                                                                                                                                     | Read                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Anything about a dependency's/reference repo's source, behavior, design, or history ("how does X implement Y", "why did X do Z", "what changed between vA and vB") | `references/investigate.md` |
| To start tracking a new repo ("add X as a ref", "track this repo", batch-adding several repos)                                                                     | `references/add.md`         |
| To refresh or check the health of existing refs ("sync my refs", "run doctor", "remove ref X")                                                                     | `references/maintain.md`    |

Read only the reference file(s) the task needs — they're kept thin on purpose because
the CLI, not this skill, does the deterministic work.

## 5. Subagent dosing rule

Scale subagent use with the task, not a fixed scheme:

- **One repo + a clear question → one worker, don't ask.** Just dispatch it.
- **Large or multi-part work** (several repos, deep multi-angle analysis, several
  sub-questions) → propose a split before spawning anything: _"This is large; I'd split
  it across N subagents — ok?"_ Proceed once the user agrees.

Platform note: on Claude Code, spawn subagents natively (the `Agent`/`Task` tool). On
Codex, subagents are opt-in — tell the user to include `use subagents` in their request
to enable spawning; otherwise do the same analysis inline, sequentially, in the main
thread. Both paths reach the same result; only context isolation differs.
