# Handoff

Written 2026-09-13, after releasing 0.16.0. Next up: **#124, the eval suite for the skill.**

## Where things stand

`@kaisers-io/refs` 0.16.0 is on npm with provenance. No open pull requests. Three open issues:

- **#124 — an eval suite for `skills/refs/`, via `claude plugin eval`.** The next piece of work.
  What is already established, by running the tool locally rather than by reading about it:
  - It accepts a **skill folder** as a target, so nothing has to be restructured to start.
  - A case is `prompt.md` (frontmatter: `max_turns`, `allowed_tools`) plus `graders/*.md`.
    `claude plugin eval init --bare <name>` scaffolds one.
  - Grader types: `llm`, `baseline`, `script`, `contains`, `not_contains`, `regex`, `tool_used`.
  - `--ablation with-without` runs a no-plugin arm and reports the delta. **The usual reading of
    that does not apply here:** the skill sets `disable-model-invocation: true` (and
    `allow_implicit_invocation: false` for the OpenAI interface), so it is never picked up on the
    model's own initiative. What the ablation measures is narrower and still worth knowing: given
    the instructions are loaded, do they change the outcome?
  - Cost controls: `--runs` (default 3), `--max-cost-usd`, `--judge-model` (default haiku),
    `--concurrency`. Reports publish to claude.ai by default; `--no-publish` keeps them local.
  - Cases must not touch the network or a real refs home, so the suite needs a scaffold building a
    temp home and a `file://` fixture repository. `--scaffold` runs author-supplied bash, and every
    case needs `--allow-tools` for `Bash` since they all drive the CLI.
- **#125 — offer refs as a plugin without moving the skill.** Has an open question that decides
  the trade: whether a manifest can point at `skills/refs` where it is. Also weigh that a
  `plugin.json` carrying a `version` would be a **third** version site beside
  `packages/cli/package.json` and `SKILL.md`; `scripts/versions.mjs` exists because two already
  drift. Must be tested in both Claude Code and Codex.
- **#126 — a symlink the walk cannot follow.** Reduced to a narrow remaining case; read the issue
  comment before reopening it, it records four counterexamples that killed the obvious fix.

## What shipped today

| Version | What it changed |
| --- | --- |
| 0.14.0 | `refs edit --decline`; workspace patterns matching at more than one depth (`packages/**/*`) |
| 0.14.1 | a symlink with no package behind it no longer makes a scan unreliable |
| 0.15.0 | `config-drift` warns about broken routes, not about every package nobody registered |
| 0.16.0 | `refs resolve` reports declared entry points and what is at each target |

## How to work here

### Research before deciding — the training data is not enough

The AI ecosystem moves faster than any model's training data. Every claim about a tool, a format
or an API gets checked against a current source before it is built on:

- `ctx7` for library documentation (see the global rules file), web search for everything else.
- Run the tool. `claude plugin eval --help`, `init --bare` in a scratch copy, and reading the
  scaffolded files settled more about #124 than any amount of reasoning would have.
- Codex can research too — ask it to, rather than assuming it knows.

Two things this caught today: no resolver dependency is needed for entry points (both candidate
libraries require the caller to supply conditions, which refs does not have), and publint already
implements the "declared target does not exist" primitive for a different question. Neither was
knowable from memory.

### Real tests, against real repositories

`pnpm check` passing is not evidence a feature works. Every change this session was driven against
fresh clones of real monorepos with the **built bundle**, and compared against ground truth from
the resolvers themselves — `pnpm ls -r` and `@npmcli/map-workspaces`, not fixtures. That is what
established astro 554/554, next.js 38/38, payload 53/53, and it is what caught a defect no fixture
had: a declared workspace directory that does not exist in a fresh clone.

Run every printed command verbatim, as the string the tool printed.

### Mutation-test every test that pins a fix

Revert the fix, run the test, restore. **Two tests this session passed with the rule reverted** —
one because the effect is only visible under budget pressure, one because a single ambiguous
candidate falls out of the grouping anyway. A test that survives the mutation pins nothing, and
finding that out later is expensive.

### Working with Codex

Ask before building (`peers ask --broker never --peer codex`), review the whole PR at the end
(`peers review …`), and repeat until `allow`. Fourteen review rounds today, eleven with real
findings. Reproduce every finding before fixing it, and say plainly when one does not hold.

Codex does **not** run the tests or the real-repo checks — it reads code and builds its own
in-memory cases. The real runs are this side's job, and they are what the rule above is about.

Release the session token that `peers ask` prints once (`peers session release <id> --token <t>`);
`peers review` releases itself.

### The repository is public

Issues, pull requests, commit bodies and the changelog carry no local paths, no private
configuration, nothing about accounts or plans, and no `_local/*` references. They describe the
change, not how it came about — no tooling names, no "cross-model review".

## Traps that cost time today

- **`npx skills add` from the repository root** replaced the tracked `.agents/skills/refs` symlink
  with a real directory and wrote `skills-lock.json`. Run it from a neutral directory.
- **A glob inside a `/** */` doc block closes it early.** Twice. Use line comments, or do not spell
  the glob out.
- **A rebase silently dropped changelog entries** that had been added on both sides. Check the
  `Unreleased` section after every rebase.
- Scripted edits to a file that is being reshaped go wrong quietly. After a move or split, check
  what actually landed in each file before continuing.
