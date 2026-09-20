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

## Checking it

```bash
refs doctor
```

`doctor` reports the git and Node versions it found, whether the config parses, whether every configured package path still resolves in its checkout, whether any checkout is dirty, and whether the home's access modes are right. Each check prints what it examined, so a passing run tells you what was looked at rather than only that nothing was wrong.

## Where things live

`REFS_HOME` defaults to `~/.kaisers-io/refs`. It holds `config.toml`, `state.json`, the hooks directory every managed checkout points at, and `sources/`, where the checkouts themselves sit. Set `REFS_HOME` to put all of that somewhere else. [`configuration.md`](configuration.md) has the details.
