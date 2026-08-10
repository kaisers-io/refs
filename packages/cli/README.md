# @kaisers-io/refs

**Real source code for coding agents.**

Ask a coding agent how a library works and it answers from training data that is months
old. Tell it to go look, and the best it finds is a minified bundle in `node_modules`.
Private repositories are worse still. The model has never seen that code at all.

`refs` hands it the source. It keeps read-only git checkouts of the repositories you care
about, so your agent reads the code that actually ships.

You say "add zod as a ref". `refs` resolves the npm package to its git repository, clones
it, and works out how the project tags its releases. After that the agent answers "how
does zod implement codecs" by reading zod's own files, and "what changed between v4.0.1
and v4.1.0" by diffing those two tags in the same clone.

`https` and `ssh` URLs both work, including the `git@host:path` form, so a private repo or
a self-hosted forge is no different from a public one. Private ones use the credentials
your git already has, since refs refuses to take any in the URL.

## Install

You need Node.js 24.2 or newer, and git. On Windows, use
[Git for Windows](https://gitforwindows.org/). The CLI behaves the same on macOS, Linux and
Windows, and its full test suite runs on all three.

```bash
npm i -g @kaisers-io/refs
refs init       # seeds the refs home directory and the git hooks guard
refs doctor     # confirms git, node and the setup are in order
```

## The agent skill

This package is the CLI. The skill that drives it lives in the
[GitHub repository](https://github.com/kaisers-io/refs) and installs separately:

```bash
npx skills add kaisers-io/refs
```

Invoke it with `/refs` in Claude Code or `$refs` in Codex. It never activates on its own.
In Claude Code its description also stays out of the context window until you ask for it,
so questions that need no source code cost you nothing.

The agent route is the one to reach for first. It can search the source, follow what it
finds, and talk with you about it. Its answers name the file and line they came from, so
you can check a claim instead of trusting it, and they are clickable wherever your
terminal or app opens file links.

## Driving the CLI yourself

Useful for scripting, or for checking what the agent did.

```bash
refs add npm:zod --dry-run --json > proposal.json   # clones and proposes, no config entry yet
# open proposal.json and fill in every empty description, including each package's
refs add --proposal proposal.json --json            # finalize
```

Finalize rejects a proposal that still has an empty description, which is what keeps refs
from inventing one for you.

You can skip the file when every package already carries a description in its own manifest:

```bash
refs add https://github.com/stevemao/left-pad --description "Left-pad a string." --json
```

Every command takes `--json` for a stable machine-readable envelope, and `--verbose` for
stack traces. Both are global flags, so they are listed under `refs --help` rather than
under each command's own help.

| Command        | What it does                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| `refs init`    | Seed or migrate the refs home directory, its config and the git hooks guard.          |
| `refs add`     | Add a git reference: propose with `--dry-run`, then finalize with `--proposal`.       |
| `refs list`    | List configured refs with their staleness and missing-checkout status.                |
| `refs show`    | Show one ref: entry, state, local path, package count.                                |
| `refs sync`    | Fetch configured refs, or re-clone the ones whose checkout went missing.              |
| `refs resolve` | Resolve a git url, npm package name, import path or key suffix to its ref or package. |
| `refs tag`     | Resolve a version to its git tag through the ref's `tag_format`, or a package's.      |
| `refs edit`    | Edit one field of a global setting, a ref or a package.                               |
| `refs remove`  | Remove a ref: its config and state entry, and its checkout directory.                 |
| `refs doctor`  | Check the environment and the integrity of what refs manages.                         |
| `refs migrate` | Migrate the config to the current schema, seeding it if absent.                       |

Full reference, including exit codes and `--json` shapes:
[`docs/commands.md`](https://github.com/kaisers-io/refs/blob/main/docs/commands.md).

## Read-only is a promise, not a sandbox

Every checkout is a reference, not a working copy. `refs` installs git hooks that reject
commits and pushes inside one, and `refs sync` restores a checkout that got dirty anyway.

Those hooks are a backstop against mistakes. A determined local process can still write
into a checkout, so treat this as a workflow that holds, not as a security boundary.

## Changelog

`CHANGELOG.md` ships inside this package, so npm's "Code" tab shows it without leaving the
package page.

## License

MIT
