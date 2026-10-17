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

## The Codex plugin

Codex users can install the skill as a Codex plugin instead. The plugin holds the same skill as `npx skills add`, read from the same directory in this repository, and it needs the CLI installed the same way: Node.js, git and `npm i -g @kaisers-io/refs`. The plugin does not install the CLI. When the CLI is missing or older than the skill, the skill names the command to run and stops.

```bash
codex plugin marketplace add kaisers-io/refs --sparse .agents/plugins --sparse skills
codex plugin add refs@kaisers-io
```

The first command registers this repository as a plugin marketplace called `kaisers-io`. The `--sparse` flags keep Codex's clone of it to the two directories the plugin needs; without them it checks out the whole repository. The second command copies the plugin, which is the `skills/` directory and nothing else, into `~/.codex/plugins/cache/kaisers-io/refs/<version>/`.

In Codex the skill is called `refs:refs`, so type `$refs:refs` where the README says `$refs`. A plain `$refs` does not reach the plugin's copy. Like the standalone skill, the plugin never activates on its own.

To update, refresh the marketplace. Codex installs the new version and removes the old one:

```bash
codex plugin marketplace upgrade kaisers-io
```

The plugin's version is the CLI's version, so a new copy arrives with each release, not with each commit to the repository. `refs doctor` reports a plugin that has fallen behind the CLI and names the upgrade command.

To remove it:

```bash
codex plugin remove refs@kaisers-io
codex plugin marketplace remove kaisers-io
```

**Install it one way, not both.** With the plugin and a standalone copy installed, Codex lists two skills, `refs` and `refs:refs`, and keeps both. Pick one and remove the other: delete the standalone directory (`.agents/skills/refs` in the project, or `~/.agents/skills/refs` for a global install), or remove the plugin as above. `refs doctor` checks every copy it finds, so a stale one is reported either way.

Checked against Codex CLI 0.163.0. The manifest is `skills/.codex-plugin/plugin.json`, Codex's own plugin format. The newer portable format, a `plugin.json` at the plugin root with skills under `skills/<name>/`, would mean either making the repository root the plugin, which copies the whole repository into every install, or keeping a second copy of the skill. Codex does not follow symlinks when it installs a plugin, so a linked copy installs empty.

## Checking it

```bash
refs doctor
```

`doctor` reports the git and Node versions it found, whether the skill (standalone or Codex plugin) matches the CLI, whether the config parses, whether every configured package path still resolves in its checkout, whether any checkout is dirty, and whether the home's access modes are right. Each check prints what it examined, so a passing run tells you what was looked at rather than only that nothing was wrong.

## Where things live

`REFS_HOME` defaults to `~/.kaisers-io/refs`. It holds `config.toml`, `state.json`, the hooks directory every managed checkout points at, and `sources/`, where the checkouts themselves sit. Set `REFS_HOME` to put all of that somewhere else. [`configuration.md`](configuration.md) has the details.
