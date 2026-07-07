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

## Install

Requirements: Node.js `>=24.12 <25`, git, macOS or Linux (Windows is not supported).

```bash
npm i -g @kaisers-io/refs
```

Then verify the setup:

```bash
refs --version
refs doctor
```

### Agent skill

Install the agent-facing skill with `skills add` — note the GitHub repository is
currently private, so this needs repo access (or a local clone) until `refs` goes
public:

```bash
npx skills add kaisers-io/refs            # with repo access
npx skills add <path-to-a-local-clone> --skill refs
```

If `skills add` doesn't fit your setup, copy the skill directory directly — for Claude
Code:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.claude/skills/refs
```

or for Codex:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.codex/skills/refs
```

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

From here, an agent with the `refs` skill installed drives the rest: it resolves
questions ("how does zod implement codecs") to the right ref/package with `refs
resolve --json`, reads the checkout directly, and uses `refs sync`/`refs doctor` to keep
things fresh — see `skills/refs/SKILL.md`.

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
