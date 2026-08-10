<p align="center">
  <img src="assets/logo-wordmark-horizontal.svg" alt="refs logo" width="400">
</p>

<p align="center"><strong>Real source code for coding agents.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kaisers-io/refs"><img src="https://img.shields.io/npm/v/@kaisers-io/refs?label=npm&color=blue" alt="npm version"></a>
  <a href="https://github.com/kaisers-io/refs/actions/workflows/ci.yml"><img src="https://github.com/kaisers-io/refs/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
</p>

Ask a coding agent how a library works and it answers from training data that is months
old. Tell it to go look, and the best it finds is a minified bundle in `node_modules`.
Your company's internal repository is worse. The model has never seen that code at all.

`refs` hands it the source. It keeps read-only git checkouts of the repositories you care
about, so your agent reads the code that actually ships.

## How it works

You say "add zod as a ref". `refs` resolves the npm package to its git repository, clones
it, and works out how the project tags its releases.

After that the agent has zod's own files on disk. "How does zod implement codecs" is
answered by reading them. For "what changed between v4.0.1 and v4.1.0", the agent resolves
both versions to their tags and diffs them in the same clone.

`https` and `ssh` URLs both work, including the `git@host:path` form, so a self-hosted
GitLab or a private company repository is no different. A private one needs credentials
your git already has, since refs refuses to take them in the URL. npm is just a convenient
way to name a repository you would otherwise paste a URL for.

## The CLI and the skill

`refs` is two pieces: a command-line tool, and an agent skill for Claude Code and Codex.

The CLI does the deterministic work of cloning, syncing, and resolving a question to the
right path or tag. The skill teaches your agent when to reach for the CLI and how to use
what comes back.

In Claude Code the skill sets `disable-model-invocation: true`, so it stays out of the
context window until you invoke it. Codex has its own opt-out in the skill's
`agents/openai.yaml`. Either way, questions that need no source code cost you nothing.

## Using it

Invoke the skill explicitly. It will not activate by itself.

```
/refs add zod as a ref
/refs how does zod implement codecs
```

Use `/refs` in Claude Code and `$refs` in Codex. Adding a ref pauses for your approval
before it enters your configuration. The clone happens first, so what the agent shows you
is filled in from the real repository rather than guessed. From then on it finds the right
checkout, reads the source, and runs `refs sync` when one has gone stale.

Its answers name the file and line they came from, so you can check a claim instead of
trusting it. Whether those references are clickable depends on where you read the answer:
the Zed terminal and the Codex app open them, while the Claude app cannot reach files
outside its working directory (checked 2026-08-03).

The agent route comes first because the agent can search the source, follow what it finds,
and talk with you about it. Driving the CLI by hand is still worth knowing, for scripting
or for checking what the agent did. [`docs/commands.md`](docs/commands.md) has every
command.

## Install

### 1. The CLI

You need Node.js 24.2 or newer, and git. On Windows, use
[Git for Windows](https://gitforwindows.org/). The CLI behaves the same on macOS, Linux and
Windows, and its full test suite runs on all three.

```bash
npm i -g @kaisers-io/refs
refs init       # seeds the refs home directory and the git hooks guard
```

### 2. The agent skill

```bash
npx skills add kaisers-io/refs
```

This installs into the current project. Pass `-g` to install once for every project, which
also prints a failure line for the few agents that have no global location. The install
itself still succeeds.

To install without `skills add`, copy the directory yourself:

```bash
mkdir -p ~/.claude/skills                                     # or ~/.codex/skills
cp -r <path-to-this-repo>/skills/refs ~/.claude/skills/refs
```

Now check the whole setup:

```bash
refs doctor
```

## Read-only is a promise, not a sandbox

Every checkout under `sources/` is reference material. Agents are instructed never to edit,
commit or push inside one, and `refs` installs git hooks that reject both. When a checkout
gets dirty anyway, `refs sync` restores it.

The hooks are a backstop against mistakes, not a security boundary. A determined local
process can still write into a checkout.

## Documentation

- [`docs/commands.md`](docs/commands.md) covers every command, its flags, its `--json`
  output and its exit codes.
- [`docs/configuration.md`](docs/configuration.md) explains `config.toml`, `state.json`,
  the per-ref settings and `REFS_HOME`.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) has the toolchain, the local development loop and
  what a pull request has to pass.
- [`SECURITY.md`](SECURITY.md) is what to read before reporting a vulnerability.

MIT licensed. See [`LICENSE`](LICENSE).
