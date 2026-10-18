# Install

The short path is in the [README](../README.md). This page covers the rest.

## Requirements

Node.js 24.2 or newer, and git.

On Windows use [Git for Windows](https://gitforwindows.org/). The read-only guards are `sh` scripts and need the shell it ships with. The CLI behaves the same on macOS, Linux and Windows, and its full test suite runs on each of them.

## The CLI

```bash
npm i -g @kaisers-io/refs
refs init
```

`refs init` creates the refs home and installs the hooks guard. It is safe to run again. It also repairs the access modes of the home's own directories and files, which matters if an older version created them under a permissive umask. Checkouts are not touched.

## The agent skill

```bash
npx skills add kaisers-io/refs
```

That installs into the current project. Pass `-g` to install once for every project. A few agents have no global skill location; the installer prints a line naming them and the install still succeeds for the rest.

To install without `skills add`, copy the directory:

```bash
mkdir -p ~/.claude/skills                                     # or ~/.codex/skills
cp -r <path-to-this-repo>/skills/refs ~/.claude/skills/refs
```

### As a Codex plugin (preview)

Codex can also install the skill as a plugin from this repository's marketplace:

```bash
codex plugin marketplace add kaisers-io/refs
codex plugin add refs@kaisers-io
```

The plugin contains the skill and nothing else: no hooks, no MCP server and no scripts, so installing
it runs nothing. It does not install the CLI. Install `@kaisers-io/refs` from npm as above, together
with Node.js and git. The skill checks the CLI version itself and tells you what to update when the
two disagree.

Codex names a plugin's skill after the plugin, so this one is `refs:refs`. Like the standalone skill,
it only runs when you invoke it explicitly. To update, run `codex plugin marketplace upgrade
kaisers-io`. To remove it, run `codex plugin remove refs@kaisers-io`.

Use either the plugin or the standalone skill, not both. With both installed, Codex lists `refs`
and `refs:refs` as two separate skills. Remove one of them. `refs doctor` reads the plugin's copy
when the plugin is enabled, and names `codex plugin marketplace upgrade kaisers-io` when it is
behind the CLI (see [the `skill` check](commands.md#the-skill-check)).

`codex plugin marketplace upgrade` also refreshes the installed copy when the marketplace has moved
on. That is what Codex's source does (`openai/codex`, `core-plugins/src/manager.rs`: a changed
snapshot force-reinstalls every configured plugin from it). If a copy stays behind anyway,
`codex plugin remove refs@kaisers-io` followed by `codex plugin add refs@kaisers-io` reinstalls it.

## Checking it

```bash
refs doctor
```

`doctor` reports the git and Node versions it found, whether the config parses, whether every configured package path still resolves in its checkout, whether any checkout is dirty, and whether the home's access modes are right. Each check prints what it examined, so a passing run tells you what was looked at rather than only that nothing was wrong.

## Where things live

`REFS_HOME` defaults to `~/.kaisers-io/refs`. It holds `config.toml`, `state.json`, the hooks directory every managed checkout points at, and `sources/`, where the checkouts themselves sit. Set `REFS_HOME` to put all of that somewhere else. [`configuration.md`](configuration.md) has the details.
