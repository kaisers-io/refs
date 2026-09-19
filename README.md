<p align="center">
  <img src="assets/logo-wordmark-horizontal.svg" alt="refs logo" width="400">
</p>

<p align="center"><strong>Real source code for coding agents.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kaisers-io/refs"><img src="https://img.shields.io/npm/v/@kaisers-io/refs?label=npm&color=blue" alt="npm version"></a>
  <a href="https://github.com/kaisers-io/refs/actions/workflows/ci.yml"><img src="https://github.com/kaisers-io/refs/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
</p>

# Ask about code your agent has never seen

```
/refs I want to upgrade effect. what changed since the version we use, and what do I have to adjust
```

That takes three steps. The agent reads the version your project depends on, finds the repository
behind the package, and compares that release with the current one. Answers name the file and line
they came from, so you can check them.

```
/refs does our payments client still match what the checkout service expects
```

This one reads two private repositories no model has seen. `refs` keeps them as read-only git
checkouts on your machine, through the git credentials you already have.

Your agent can already clone a repository. Cloning is the easy part. `refs` keeps the repositories
you name, sends a question to the right one, refreshes them when they go stale, and gives the agent
a repeatable way to read them.

## Adding a repository

You say "add effect as a ref". The agent runs the CLI, clones the repository, works out how the
project tags its releases, and shows you what it found. Nothing enters your configuration until you
approve it.

Three ways to name the same repository, all of which resolve to the key
`github.com/Effect-TS/effect`:

```
npm:effect
https://github.com/Effect-TS/effect
git@github.com:Effect-TS/effect.git
```

npm is a convenience for packages. A private repository or a self-hosted forge works the same way,
and the credentials stay in your git configuration because `refs` refuses to take any in the URL.

## Two repositories, one question

*An example. `checkout-api` and `billing-worker` are made up, and no answer is implied.*

Two services talk to each other. One team is changing the caller, and the question is whether the
other side still agrees:

```
/refs we are adding retries to checkout-api. read billing-worker and tell me how it handles
      duplicate requests, which tests describe that behaviour, and what could break
```

The agent reads both checkouts, quotes the retry logic and the tests around it, and names the files
it used. What it cannot tell you is whether the deployed versions match what you have checked out.
Ask it to name the revisions it read.

## Try it on a real repository

Every command below was run against the current Effect repository.

```bash
refs add npm:effect --dry-run --json > proposal.json   # fill in the descriptions, then:
refs add --proposal proposal.json
```

Effect is a monorepo, and its packages tag releases separately. Detection records one convention for
the whole ref, which is not always the package you asked about, so set the one you want:

```bash
refs edit github.com/Effect-TS/effect tag_format 'effect@{version}' --package effect
```

Now a version resolves to a tag, and two tags resolve to a diff:

```bash
refs tag github.com/Effect-TS/effect 3.19.2 --package effect   # effect@3.19.2
refs tag github.com/Effect-TS/effect 3.22.2 --package effect   # effect@3.22.2
```

From there the agent reads the range in the checkout. The commit subjects are the repository's own:

```
fix(effect): TMap.remove/removeAll clears entire bucket on hash collision (#6233)
```

`refs` never invents a tag convention. When it cannot resolve a version it says so, and the tag list
is right there to look at.

## The CLI and the skill

`refs` is two pieces. The CLI does the deterministic work of cloning, refreshing, and resolving a
question to the right path or tag. The skill teaches your agent when to reach for the CLI and how to
read what comes back.

The agent uses the terminal tools it already has to search a checkout and read the passages that
matter. There is no server to configure and no per-file request over the network.

Invoke the skill explicitly with `/refs` in Claude Code or `$refs` in Codex. It does not activate by
itself, so the questions that need no source code cost you nothing.

## Install

### 1. The CLI

You need Node.js 24.2 or newer, and git. On Windows use
[Git for Windows](https://gitforwindows.org/), because the read-only guards are `sh` scripts and
need the shell it ships with. The CLI behaves the same on all three platforms, and its full test
suite runs on each of them.

```bash
npm i -g @kaisers-io/refs
refs init       # seeds the refs home directory and the git hooks guard
```

### 2. The agent skill

```bash
npx skills add kaisers-io/refs
```

This installs into the current project. Pass `-g` to install once for every project.
[`docs/install.md`](docs/install.md) covers the manual copy and the agents that have no global
location.

Now check the whole setup:

```bash
refs doctor
```

## What lives on your machine

Checkouts sit under your refs home as ordinary git repositories. You can open them in your editor,
grep them, and read them without an agent. No service holds a copy of your code. What the agent
reads is handled under that agent's own model and data settings.

A checkout is the default branch at the revision you last fetched. It is not necessarily the version
you have installed, and it does not refresh itself. `refs sync` fetches, and the skill runs it when
a checkout has gone stale.

## Read-only is a promise, not a sandbox

Every checkout under `sources/` is reference material. Agents are instructed never to edit, commit
or push inside one, and `refs` installs git hooks that reject both. When a checkout gets dirty
anyway, `refs sync` restores it.

The hooks are a backstop against mistakes, not a security boundary. A determined local process can
still write into a checkout.

## Documentation

- [`docs/investigations.md`](docs/investigations.md) works through the questions above in full,
  including what each answer leaves open.
- [`docs/commands.md`](docs/commands.md) covers every command, its flags, its `--json` output and
  its exit codes.
- [`docs/configuration.md`](docs/configuration.md) explains `config.toml`, `state.json`, the
  per-ref settings and `REFS_HOME`.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) has the toolchain, the local development loop and what a
  pull request has to pass.
- [`SECURITY.md`](SECURITY.md) is what to read before reporting a vulnerability.

MIT licensed. See [`LICENSE`](LICENSE).
