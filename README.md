<p align="center">
  <img src="assets/logo.svg" alt="refs logo" width="220" height="220">
</p>

<p align="center">
    <strong>
        $${\color{#00FF00}\text{Real source code for coding agents.}}$$
    </strong>
</p>

`refs` manages arbitrary git repositories (GitHub, GitLab, self-hosted) as local, managed
read-only source-code references, so that coding agents answer questions about
dependencies and reference projects against **real source code** — never against a
minified `node_modules` bundle, never against stale training knowledge.

When your project depends on `next`, you say "add next.js as a ref"; `refs` resolves the
npm package to its git repository, clones it, detects its release-tag convention and
monorepo packages, and from then on any agent can answer "what changed between v15.2 and
v15.3" or "how does next implement middleware" by reading the actual checkout.

npm is only a convenience resolver (`npm:next`). Arbitrary git URLs work directly.

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

### Private phase (current)

`refs` isn't published yet. Install from a local clone:

```bash
git clone https://github.com/kaisers-io/refs.git
cd refs
pnpm install
pnpm build
npm link ./packages/cli
```

`npm link` puts a global `refs` command on your `PATH` backed by this checkout. If `npm
link` misbehaves in your environment (permissions, an existing global `refs`, etc.),
install the package directly instead:

```bash
npm install -g ./packages/cli
```

Then install the agent skill, pointing `skills add` at your local clone:

```bash
npx skills add <path-to-this-repo> --skill refs
```

If `skills add` isn't available or doesn't fit your setup, copy the skill directory
directly instead — for Claude Code:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.claude/skills/refs
```

or for Codex:

```bash
cp -r <path-to-this-repo>/skills/refs ~/.codex/skills/refs
```

### After public release

Once `refs` is published, install it like any other CLI:

```bash
npm i -g @kaisers-io/refs
npx skills add kaisers-io/refs
```

## Quickstart

```bash
# 1. Seed the refs home directory, config, and git hooks guard.
refs init

# 2. Propose adding a ref — resolves npm:next to its git repo, clones it, and writes
#    a reviewable proposal. Nothing is added to config yet.
refs add npm:next --dry-run

# 3. Review the proposal JSON, then finalize it (see docs/commands.md for the full
#    two-phase add contract), or use --description for a one-shot add:
refs add npm:next --description "The React Framework" --json
```

From here, an agent with the `refs` skill installed drives the rest: it resolves
questions ("how does next implement middleware") to the right ref/package with `refs
resolve --json`, reads the checkout directly, and uses `refs sync`/`refs doctor` to keep
things fresh — see `skills/refs/SKILL.md`.

Every command accepts `--json` for a stable, machine-readable envelope and `--verbose`
for stack traces on error. Run `refs --help` or `refs <command> --help` — the CLI's own
help is the authoritative, always-current reference.

## Documentation

- [`docs/configuration.md`](docs/configuration.md) — `config.toml` reference, `state.json`,
  the per-ref settings override rule, and `REFS_HOME`.
- [`docs/commands.md`](docs/commands.md) — every command's synopsis, examples, `--json`
  data shape, and exit codes.
- [`skills/refs/SKILL.md`](skills/refs/SKILL.md) — the agent-facing skill that orchestrates
  `refs` for Claude Code and Codex.
