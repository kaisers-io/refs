<p align="center">
  <img src="assets/logo-wordmark-horizontal.svg" alt="refs logo" width="400">
</p>

<p align="center"><strong>Real source code for coding agents.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kaisers-io/refs"><img src="https://img.shields.io/npm/v/@kaisers-io/refs?label=npm&color=blue" alt="npm version"></a>
  <a href="https://github.com/kaisers-io/refs/actions/workflows/ci.yml"><img src="https://github.com/kaisers-io/refs/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
</p>

# Ask about your dependencies and your team's repositories

```
/refs I want to upgrade effect. what changed since the version we use, and what do I have to adjust
```

That takes four steps. The agent reads the version your project depends on, finds the repository behind the package, compares that release with the current one, and then goes back through your own code for the places the change touches. Answers name the file and line they came from, so you can check them.



```
/refs I changed how our orders API paginates. check billing-worker and the admin dashboard: do they call it, and what has to change
```

This one runs the other way. It starts with a change in your own repository and asks what it reaches. The agent reads the consumers you name, finds the call sites, and tells you which ones your change breaks. None of those repositories are public, and no model has seen any of them. `refs` keeps them as read-only git checkouts on your machine, through the git credentials you already have.

## Why not just clone it?

Your agent can already clone a repository. Cloning is the easy part. `refs` keeps the repositories you name, sends a question to the right one, refreshes them when they go stale, and gives the agent a repeatable way to read them.

## You talk to the agent, not to the CLI

Everything below is something you say to your agent, and it runs the commands. `/refs` is what reaches the skill in Claude Code. In Codex the same thing is `$refs`.

```
/refs add effect as a ref
```

The agent clones the repository, works out how the project tags its releases, and shows you what it found. Nothing enters your configuration until you approve it.

That happens once. Effect is a ref from then on, and every later question about it goes straight to the checkout, from any project and any session.

> **TODO screenshot.** The approval step: what the agent found, waiting for your yes.
> Save it as `assets/screenshots/add-approval.png`, then replace this block with the line below.

<!-- ![The agent showing what it found about a repository and waiting for approval](https://raw.githubusercontent.com/kaisers-io/refs/main/assets/screenshots/add-approval.png) -->


Three ways to name the same repository, all of which resolve to the key `github.com/Effect-TS/effect`:

```
npm:effect
https://github.com/Effect-TS/effect
git@github.com:Effect-TS/effect.git
```

npm is a convenience for packages. A private repository or a self-hosted forge works the same way, and the credentials stay in your git configuration because `refs` refuses to take any in the URL.

The CLI does the same things, and it is worth knowing for scripting or when typing is quicker. `refs sync` is the usual one. [`docs/commands.md`](docs/commands.md) has all of them. We recommend the agent route. It can search a checkout, follow what it finds, and talk with you about it. It also writes the description every ref needs, one per package, from what the source says. Effect has 41 of them.

## Questions that cross repositories

*An example. The service names are made up, and no answer is implied.*

Add every repository that takes part in a flow, not just the two at its ends. A request arrives at a gateway, a checkout service calls a billing worker, and a shared client library sits between them. Once each of them is a ref, one question can follow the whole path:

```
/refs we are adding retries to checkout-api. follow a payment request through the gateway, checkout-api, the shared client and billing-worker. where could the same request be handled twice, and which tests cover that
```

The agent reads each checkout in turn and names the files it used. What it cannot tell you is whether the deployed versions match what you have checked out, so ask it to name the revisions it read.

## How does this actually work

Reading a library to find out how it does something is the other everyday question, and the answer is spread over files nobody wants to open one at a time. Ask for the shape of it, and for the evidence:

```
/refs how does effect run a fiber? draw it as a diagram, then list every source file you inspected and what each one establishes
```

The agent reads the checkout, follows the calls, and draws what it found. Underneath comes a table: one row per file, each with the line it read and what that line settles. Every row is a link into your own checkout. Click one and the file opens at that line, so you can check the step instead of taking it.

It also names the revision it traced, which matters more than it sounds. A checkout can be a release candidate whose internals differ from the version a model learned, and the answer says which one you are looking at.

This works in a terminal too. The diagram comes out as text and the file references are still there.

And it does not matter which project you are in. The checkouts live in one place on your machine rather than beside the repository you happen to have open, so the same refs answer from any session. You are in the middle of something, you want to know how Effect does it, and you ask there, in the conversation you already have, instead of going somewhere else and coming back. The question does not have to be about the code in front of you either. Working an idea out, or reading to learn how something is built, reaches the same collection.

> **TODO screenshot.** The agent's answer: the diagram, the table of files it inspected, and a source file open at one of the cited lines.
> Save it as `assets/screenshots/effect-fiber-diagram.png`, then replace this block with the line below.

<!-- ![The agent's diagram of how Effect runs a fiber, the files it inspected, and one of them open at the cited line](https://raw.githubusercontent.com/kaisers-io/refs/main/assets/screenshots/effect-fiber-diagram.png) -->

## Try it on a real repository

```
/refs add effect as a ref
/refs I use effect 3.19.2. what changed up to 3.22.2, and what do I have to adjust
```

Effect is a monorepo, and its packages tag releases separately. Detection records one convention for the whole ref, which is not always the package you asked about. When a version does not resolve, tell the agent which convention the package uses:

```
/refs effect tags its own releases as effect@<version>. record that for the effect package
```

Then the versions resolve, and the agent reads the range between the two tags. The commit subjects are the repository's own:

```
fix(effect): TMap.remove/removeAll clears entire bucket on hash collision (#6233)
```

`refs` never invents a tag convention. When it cannot resolve a version it says so, and the tag list is right there to look at.

The same steps run from the CLI, and [`docs/investigations.md`](docs/investigations.md) shows them.

## The CLI and the skill

`refs` is two pieces. The CLI does the deterministic work of cloning, refreshing, and resolving a question to the right path or tag. The skill teaches your agent when to reach for the CLI and how to read what comes back.

The agent uses the terminal tools it already has to search a checkout and read the passages that matter. There is no server to configure and no per-file request over the network.

The skill does not activate by itself. You reach for it, which is why the questions that need no source code cost you nothing.

## Install

### 1. The CLI

You need Node.js 24.2 or newer, and git. On Windows use [Git for Windows](https://gitforwindows.org/), because the read-only guards are `sh` scripts and need the shell it ships with. The CLI behaves the same on all three platforms, and its full test suite runs on each of them.

```bash
npm i -g @kaisers-io/refs
refs init       # seeds the refs home directory and the git hooks guard
```

### 2. The agent skill

```bash
npx skills add kaisers-io/refs
```

This installs into the current project. Pass `-g` to install once for every project. [`docs/install.md`](docs/install.md) covers the manual copy and the agents that have no global location.

Now check the whole setup:

```bash
refs doctor
```

## What lives on your machine

Checkouts sit under `~/.kaisers-io/refs/sources/` as ordinary git repositories, in one place rather than one per project, so every session reaches the same collection. You can open them in your editor, grep them, and read them without an agent. Set `REFS_HOME` to keep them somewhere else, on another disk for instance, and everything `refs` owns moves with it: see [`docs/configuration.md`](docs/configuration.md). No service holds a copy of your code. What the agent reads is handled under that agent's own model and data settings.

A checkout is the default branch at the revision you last fetched. It is not necessarily the version you have installed, and it does not refresh itself. `refs sync` fetches, and the skill runs it when a checkout has gone stale.

## Read-only is a promise, not a sandbox

Every checkout under `sources/` is reference material. Agents are instructed never to edit, commit or push inside one, and `refs` installs git hooks that reject both. When a checkout gets dirty anyway, `refs sync` restores it.

The hooks are a backstop against mistakes, not a security boundary. A determined local process can still write into a checkout.

## Documentation

- [`docs/investigations.md`](docs/investigations.md) works through the questions above in full, including what each answer leaves open.
- [`docs/commands.md`](docs/commands.md) covers every command, its flags, its `--json` output and its exit codes.
- [`docs/configuration.md`](docs/configuration.md) explains `config.toml`, `state.json`, the per-ref settings and `REFS_HOME`.
- [`docs/install.md`](docs/install.md) has the manual skill copy, the platform notes and what `refs doctor` checks.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) has the toolchain, the local development loop and what a pull request has to pass.
- [`SECURITY.md`](SECURITY.md) is what to read before reporting a vulnerability.

MIT licensed. See [`LICENSE`](LICENSE).
