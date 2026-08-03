<p align="center">
  <img src="assets/logo-wordmark-horizontal.svg" alt="refs logo" width="400">
</p>

<p align="center"><strong>Real source code for coding agents.</strong></p>

`refs` manages arbitrary git repositories (GitHub, GitLab, self-hosted) as local, managed
read-only source-code references, so that coding agents answer questions about
dependencies and reference projects against **real source code** — never against a
minified `node_modules` bundle, never against stale training knowledge.

When your project depends on `zod`, you say "add zod as a ref"; `refs` resolves the
npm package to its git repository, clones it, detects its release-tag convention and
monorepo packages, and from then on any agent can answer "what changed between v4.0.0
and v4.1.0" or "how does zod implement codecs" by reading the actual checkout.

npm is only a convenience resolver (`npm:zod`). Arbitrary git URLs work directly.

**Read-only is a workflow promise, not a security boundary.** Every checkout under
`sources/` is a managed reference, not a working copy: agents are instructed never to
edit, commit, or push inside one. `refs` installs git hooks that reject commits/pushes in
a checkout as a backstop, and `refs sync` self-heals a dirty checkout if something slips
through anyway — but this is discipline enforced by convention and tooling, not a
sandbox.

`refs` is a real CLI plus one thin, cross-agent skill (Claude Code and Codex): the CLI
does everything deterministic (cloning, syncing, config, path/tag resolution), the skill
only orchestrates the agent work (routing questions, dispatching subagents) on top of it.

## Does it measurably help?

A screening-grade pilot put source-requiring questions about a real dependency (`zod`) to
coding agents (Claude Opus 4.8 and GPT-5.6), **with** refs providing the source vs.
**without** it. With refs, answer correctness roughly doubled — **37% → 87%** — and refs
won every decisive paired item. A control question answerable from general knowledge
showed *no* difference between the two, confirming the gain is a real source effect rather
than a scoring artifact. The **with refs** arm measures runs in which the agent had the
checkout in front of it and read it; in everyday use that path is reached by invoking the
skill, which is explicitly invoked and never activates on its own (see
[Agent skill](#agent-skill)). This is a directional pilot, not a citable effect size — the full
method and honest caveats are in
[`bench/source-access/FINDINGS.md`](bench/source-access/FINDINGS.md).

## Install

Requirements: Node.js `>=24.12` and git. macOS, Linux, and Windows are fully
supported — every command, locking, sync, and the read-only guards behave the same on
all three, and the full test suite plus a smoke test run in CI on each of them.

```bash
npm i -g @kaisers-io/refs
```

Then verify the setup:

```bash
refs --version
refs doctor
```

### Windows

Use [Git for Windows](https://gitforwindows.org/) as the git installation. Everything
in this README works unchanged; where a shell example sets an environment variable, the
PowerShell equivalent is:

```powershell
$env:REFS_HOME = "D:\refs"
```

### Agent skill

**The skill is user-invoked.** It does not activate on its own — an agent will not reach
for it just because a question sounds like it needs source. Invoke it explicitly with
`/refs` in Claude Code or `$refs` in Codex, optionally followed by what you want looked
up (e.g. `/refs how does zod implement codecs`).

In Codex, `$refs` and `@refs` are not variants of the same thing: `$refs` invokes the
skill, while `@refs` is a plugin mention. As of 2026-08-03 (codex-cli 0.146.0), `@refs`
gives the model no skill instructions at all — the skill behaves as if it weren't
installed, because Codex only surfaces skill content on a plugin mention when the plugin
ships an MCP server, app, or similar, and refs ships none. That's a Codex-side limitation,
not a misconfiguration; `refs doctor` correctly reports `ok` either way. See
[openai/codex#19695](https://github.com/openai/codex/issues/19695).

Install the agent-facing skill with `skills add` — note the GitHub repository is
currently private, so this needs repo access (or a local clone) until `refs` goes
public:

```bash
npx skills add kaisers-io/refs            # with repo access
npx skills add <path-to-a-local-clone> --skill refs
```

`skills add` keeps one real copy in a shared `.agents/skills/refs` directory and points
each agent's own directory at it with a symlink, so every agent reads the same files. It
installs into the **current project** by default; pass `-g` to install into `~/.agents`
for every project.

If `skills add` doesn't fit your setup, copy the skill directory into the agent's own
directory instead — for Claude Code:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.claude/skills/refs
```

or for Codex:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.codex/skills/refs
```

`refs doctor`'s `skill` check looks in `~/.agents`, `~/.claude`, `~/.codex` (the last two
honouring `$CLAUDE_CONFIG_DIR`/`$CODEX_HOME`) and the current project's `./.agents` and
`./.claude`, so either install above reports as found. That list is best-effort — the
installer supports dozens of other agents — so a `warn` there means the check couldn't see
your skill, not that it is missing. See [docs/commands.md](docs/commands.md#the-skill-check).

### Native plugin marketplaces (alternative)

Each agent's own plugin marketplace also works, and pulls in the bundled logo/branding:

- **Claude Code:** `/plugin marketplace add kaisers-io/refs` → `/plugin install refs@refs`
- **Codex CLI:** `codex plugin marketplace add git@github.com:kaisers-io/refs.git` → install via `/plugins`

The repo is currently private, so both commands only work for accounts with repo access
(as with the skill install above) — this opens up once `refs` goes public.

When launched **inside** this repo, Codex auto-discovers the skill via the
`.agents/skills/` symlink — no install step needed.

## Quickstart

```bash
# 1. Seed the refs home directory, config, and git hooks guard.
refs init

# 2. Propose adding a ref — resolves npm:zod to its git repo, clones it, and writes
#    a reviewable proposal. Nothing is added to config yet.
refs add npm:zod --dry-run

# 3. Review the proposal JSON, then finalize it (see docs/commands.md for the full
#    two-phase add contract), or use --description for a one-shot add:
refs add npm:zod --description "TypeScript-first schema validation" --json
```

From here, invoke the skill (`/refs how does zod implement codecs` in Claude Code,
`$refs ...` in Codex) and the agent drives the rest: it resolves the question to the right
ref/package with `refs resolve --json`, reads the checkout directly, and uses `refs
sync`/`refs doctor` to keep things fresh — see `skills/refs/SKILL.md`. Source citations in
its final answer are markdown links (visible text relative, target an absolute checkout
path): they open in the Zed terminal and the Codex app (verified 2026-08-03), but as of
the same date the Claude app cannot open files outside its working directory.

Every command accepts `--json` for a stable, machine-readable envelope and `--verbose`
for stack traces on error. Run `refs --help` or `refs <command> --help` — the CLI's own
help is the authoritative, always-current reference.

## Development

Development requires pnpm 11 or newer (enforced via `engines.pnpm`; `corepack enable`
picks the pinned version automatically). The published CLI itself has no pnpm
requirement.

```bash
git clone https://github.com/kaisers-io/refs.git
cd refs
pnpm install
pnpm refs --version        # builds the CLI, then runs it
```

`pnpm refs <args>` always builds first (a few seconds, incremental). (Do not write
`pnpm refs -- <args>`: pnpm forwards the literal `--` to the CLI, which Commander then
misparses — verified against pnpm 11.9/11.10.) For a faster
loop, run `pnpm dev` inside `packages/cli` (tsdown watch mode) and call
`node packages/cli/bin/refs.mjs <args>` directly.

To put a global `refs` on your `PATH` backed by this checkout, build once, then link:

```bash
pnpm build
pnpm -C packages/cli add -g .     # pnpm 11 (pnpm link --global was removed)
# or: npm link ./packages/cli
```

`packages/cli/bin/refs.mjs` is a committed stub, so a linked `refs` works even in an
unbuilt checkout — it runs the TypeScript source directly via Node's native type
stripping. Without `pnpm install` first, the stub prints actionable guidance (`Run:
pnpm install && pnpm build`) instead of failing cryptically.

## Documentation

- [`docs/configuration.md`](docs/configuration.md) — `config.toml` reference, `state.json`,
  the per-ref settings override rule, and `REFS_HOME`.
- [`docs/commands.md`](docs/commands.md) — every command's synopsis, examples, `--json`
  data shape, and exit codes.
- [`skills/refs/SKILL.md`](skills/refs/SKILL.md) — the agent-facing skill that orchestrates
  `refs` for Claude Code and Codex.
