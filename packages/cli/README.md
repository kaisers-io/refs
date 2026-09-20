# @kaisers-io/refs

**Real source code for coding agents.**

## Ask about your dependencies and your team's repositories

```
/refs I want to upgrade effect. what changed since the version we use,
and what do I have to adjust
```

That takes four steps. The agent reads the version your project depends on, finds the repository behind the package, compares that release with the current one, and then goes back through your own code for the places the change touches. Answers name the file and line they came from, so you can check them.

```
/refs I changed how our orders API paginates. check billing-worker and
the admin dashboard: do they call it, and what has to change
```

This one runs the other way. It starts with a change in your own repository and asks what it reaches. The agent reads the consumers you name, finds the call sites, and tells you which ones your change breaks. None of those repositories are public, and no model has seen any of them. `refs` keeps them as read-only git checkouts on your machine, through the git credentials you already have.

## Why not just clone it?

Your agent can already clone a repository. Cloning is the easy part. `refs` keeps the repositories you name, sends a question to the right one, refreshes them when they go stale, and gives the agent a repeatable way to read them.

What you save is the bookkeeping. You do not remember where a clone went, paste a path, or open anything first. You say the name, from whichever project you happen to be in.

## You talk to the agent, not to the CLI

This package is the CLI. The skill that drives it installs separately:

```bash
npm i -g @kaisers-io/refs
refs init                        # seeds the refs home and the git hooks guard
npx skills add kaisers-io/refs   # installs the agent skill
refs doctor                      # confirms git, node and the setup
```

You need Node.js 24.2 or newer, and git. On Windows use [Git for Windows](https://gitforwindows.org/), because the read-only guards are `sh` scripts and need the shell it ships with. The CLI behaves the same on all three platforms, and its full test suite runs on each of them.

`/refs` is what reaches the skill in Claude Code. In Codex the same thing is `$refs`. It never activates on its own, so questions that need no source code cost you nothing.

Then talk to the agent:

```
/refs add npm:effect as a ref
```

It clones the repository, works out how the project tags its releases, and shows you what it found. Nothing enters your configuration until you approve it.

That happens once. Effect is a ref from then on, and every later question about it goes straight to the checkout, from any project and any session.

Three ways to name the same repository. All of them resolve to the key `github.com/Effect-TS/effect`:

| Source                                | What it is                                                         |
| ------------------------------------- | ------------------------------------------------------------------ |
| `npm:effect`                          | The package name. `refs` reads the repository out of the registry. |
| `https://github.com/Effect-TS/effect` | The repository itself, as you would clone it.                      |
| `git@github.com:Effect-TS/effect.git` | The same over ssh.                                                 |

The `npm:` prefix says which registry the name belongs to, so a package and a repository that share a name cannot be confused for one another. A private repository or a self-hosted forge works the same way, and the credentials stay in your git configuration because `refs` refuses to take any in the URL.

## Driving the CLI yourself

The agent runs these. Typing one yourself is quicker for some of them, and `refs sync` is the one most people reach for. `refs doctor` is the one to run after updating refs: the CLI and the skill each carry a version, and it says when they have drifted apart.

```bash
# clones and proposes; nothing is configured yet
refs add npm:effect --dry-run --json > proposal.json
# fill in every empty description, including each package's
refs add --proposal proposal.json --json   # finalize
refs sync --json                           # fetch what has gone stale
```

That middle line is the work the agent does for you. A monorepo ships dozens of packages and each wants a description, written from what the source says rather than copied out of a manifest.

The [full command reference](https://github.com/kaisers-io/refs/blob/main/docs/commands.md) has every flag, every `--json` shape and every exit code.

## What lives on your machine

Checkouts sit under `~/.kaisers-io/refs/sources/` as ordinary git repositories, in one place rather than one per project, so every session reaches the same collection. You can open them in your editor, grep them, and read them without an agent. Set `REFS_HOME` to keep them somewhere else, on another disk for instance, and everything `refs` owns moves with it: see [configuration](https://github.com/kaisers-io/refs/blob/main/docs/configuration.md). No service holds a copy of your code. What the agent reads is handled under that agent's own model and data settings.

A checkout is the default branch at the revision you last fetched. It is not necessarily the version you have installed, and it does not refresh itself. `refs sync` fetches, and the skill runs it when a checkout has gone stale.

## Read-only is a promise, not a sandbox

Every checkout under `sources/` is reference material. Agents are instructed never to edit, commit or push inside one, and `refs` installs git hooks that reject both. When a checkout gets dirty anyway, `refs sync` restores it.

The hooks are a backstop against mistakes, not a security boundary. A determined local process can still write into a checkout.

## More

- [Worked investigations](https://github.com/kaisers-io/refs/blob/main/docs/investigations.md), each ending in what the answer leaves open.
- [Configuration](https://github.com/kaisers-io/refs/blob/main/docs/configuration.md): `config.toml`, `state.json`, per-ref settings and `REFS_HOME`.
- [Changelog](https://github.com/kaisers-io/refs/blob/main/CHANGELOG.md).

MIT licensed.
