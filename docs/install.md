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

The plugin packages the same `skills/refs` directory used by `skills add` and manual
copies. It contains no MCP server, hooks, embedded CLI, or automatic installation code.
Install Node.js 24.2 or newer, git, and `@kaisers-io/refs` as above. The Codex process
must inherit a `PATH` on which `refs --version` works; restart Codex after changing PATH.
Installing the plugin alone does not install those prerequisites.

### Supported client and format

The installation and discovery commands below were tested with **Codex CLI 0.159.2**.
The package uses [Agent Plugins 1.0.0](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json):
root `plugin.json` and fixed `skills/<name>/SKILL.md` paths. See OpenAI's
[packaging reference](https://developers.openai.com/plugins/build/plugins) and
[skill invocation policy](https://learn.chatgpt.com/docs/build-skills#optional-metadata).
Other client versions and public-directory publishing are not covered by this package.

The marketplace is `refs`, the plugin is `refs@refs`, and its skill is **`refs:refs`**.
Open `/skills` or type `$refs:refs` in Codex CLI. For example:

```text
$refs:refs How does a tracked dependency implement its type checks? Name the exact revision and source lines you read.
```

### Install a minimal local package

```bash
git clone https://github.com/kaisers-io/refs.git refs-plugin-source
cd refs-plugin-source
node scripts/package-plugin.mjs ../refs-plugin-marketplace
codex plugin marketplace add ../refs-plugin-marketplace
codex plugin add refs@refs
```

The packaging script needs only Node.js, not pnpm or a build. Its destination must not
already exist. It copies `plugin.json`, `LICENSE`, and `skills/refs`, including the
supporting Markdown and icon. The marketplace entry is outside the installed plugin.
There is one maintained skill source; packaging does not edit its instructions.
The installed plugin contains no repository history, tests, CLI sources, dependencies,
or developer configuration. Keep the generated marketplace directory for updates.

Alternatively, register this repository directly with `codex plugin marketplace add`
and install `refs@refs`. Codex copies the selected plugin source, not an npm `files`
allowlist: registering a full local checkout can copy unrelated files, including `.git`
and `node_modules`. Use the minimal package above for a bounded installation footprint.
Git-backed marketplace sources support `--sparse`; their source refresh is
`codex plugin marketplace upgrade refs`. A local marketplace is refreshed by rebuilding
its files, not by `marketplace upgrade`.

### Verify and troubleshoot

```bash
refs --version
codex plugin list --json
refs doctor --json
```

The plugin list should include `refs@refs`, enabled, at the expected version. Doctor's
`skill` check recognizes the enabled plugin under Codex's home (including `CODEX_HOME`)
and compares the installed skill's `cli_version` with the running CLI. Disabled or
removed plugins do not count merely because files remain in a cache. The diagnostic
supports this package's `refs@refs` identity; renamed marketplaces are outside its scope.

- Missing CLI: the skill checks Node first, gives the pinned npm installation command,
  and stops. It does not install or upgrade software itself.
- Major/minor CLI mismatch: the skill names both versions and stops. A patch mismatch is
  reported, and CLI help takes precedence over the skill's command reference.
- Missing skill or assets: inspect `/skills` and `codex plugin list --json`, reinstall the
  package, and restart Codex. A successful plugin install alone is not a source-answer test.
- Duplicate entries: installing both ways exposes `refs` and `refs:refs`; Codex does not
  merge them. Doctor checks both pins and mentions the duplicate. Remove the unneeded
  standalone copy through its installer, or disable that specific skill with Codex's
  `[[skills.config]]` setting. To keep standalone instead, remove the plugin below.
- Unverifiable cache: reinstall through Codex rather than editing its cache. Doctor does
  not guess which of several prerelease cache directories is active.

Both distribution paths preserve `allow_implicit_invocation: false`, the CLI capability
gate, approval before configuration changes, and read-only reference-checkout guidance.

### Updates

The CLI package version is authoritative. `node scripts/versions.mjs --set <version>`
updates the CLI, skill pin, and plugin manifest together; CI and release checks reject
version drift. Released plugin content must get a new version, even for skill-only fixes.
Updating the CLI does not update an installed plugin, or vice versa.

For a local staged package, pull the new source and build into a fresh directory. For
example, from `refs-plugin-source`:

```bash
git pull --ff-only
node scripts/package-plugin.mjs ../refs-plugin-marketplace-next
codex plugin marketplace remove refs
codex plugin marketplace add ../refs-plugin-marketplace-next
codex plugin add refs@refs
refs doctor --json
```

Choose a new destination name for each update. Codex loads the version copied by
`plugin add`; changing the source manifest alone does not update the installed cache.
After updating a Git-backed marketplace, also run `codex plugin add refs@refs`.
If a running session still shows the previous skill, start a new session.

### Remove

```bash
codex plugin remove refs@refs
codex plugin marketplace remove refs
```

You can then delete your generated marketplace and source clone if no longer needed.
Plugin removal leaves the npm CLI, standalone skill copies, and `REFS_HOME` untouched.

### Maintainer checks

```bash
node --test scripts/versions.test.mjs scripts/plugin-package.test.mjs
pnpm plugin:smoke
```

The smoke command rebuilds the CLI, then uses a disposable client home and the real
Codex plugin commands plus app-server `skills/list`. It checks the minimal installed
contents, skill and icon discovery, plugin-only doctor, duplicate discovery, updates,
and removal. It requires Codex 0.159.2 and does not need a login or make model calls.
A live source investigation and the skill's missing/incompatible-CLI behavior also need
an authenticated Codex session; this packaging smoke does not substitute for those evals.

## Checking it

```bash
refs doctor
```

`doctor` reports the git and Node versions it found, whether the config parses, whether every configured package path still resolves in its checkout, whether any checkout is dirty, and whether the home's access modes are right. Each check prints what it examined, so a passing run tells you what was looked at rather than only that nothing was wrong.

## Where things live

`REFS_HOME` defaults to `~/.kaisers-io/refs`. It holds `config.toml`, `state.json`, the hooks directory every managed checkout points at, and `sources/`, where the checkouts themselves sit. Set `REFS_HOME` to put all of that somewhere else. [`configuration.md`](configuration.md) has the details.
