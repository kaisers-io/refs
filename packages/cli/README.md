# @kaisers-io/refs

**Real source code for coding agents.**

`refs` manages arbitrary git repositories (GitHub, GitLab, self-hosted) as local, managed
read-only source-code references, so that coding agents answer questions about
dependencies and reference projects against **real source code** — never against a
minified `node_modules` bundle, never against stale training knowledge.

When your project depends on `zod`, you say "add zod as a ref"; `refs` resolves the npm
package to its git repository, clones it, detects its release-tag convention and monorepo
packages, and from then on any agent can answer "what changed between v4.0.0 and v4.1.0"
or "how does zod implement codecs" by reading the actual checkout.

npm is only a convenience resolver (`npm:zod`). Arbitrary git URLs work directly.

**Read-only is a workflow promise, not a security boundary.** Every checkout under
`sources/` is a managed reference, not a working copy: agents are instructed never to
edit, commit, or push inside one. `refs` installs git hooks that reject commits/pushes in
a checkout as a backstop, and `refs sync` self-heals a dirty checkout if something slips
through anyway — but this is discipline enforced by convention and tooling, not a sandbox.

## Install

Requirements: Node.js `>=24.12` and git. macOS, Linux, and Windows are fully supported —
every command, locking, sync, and the read-only guards behave the same on all three (on
Windows, use [Git for Windows](https://gitforwindows.org/)).

```bash
npm i -g @kaisers-io/refs
```

Then verify the setup:

```bash
refs --version
refs doctor
```

## Quickstart

```bash
# 1. Seed the refs home directory, config, and git hooks guard.
refs init

# 2. Propose adding a ref — resolves npm:zod to its git repo, clones it, and writes
#    a reviewable proposal. Nothing is added to config yet.
refs add npm:zod --dry-run

# 3. Review the proposal JSON, then finalize it, or use --description for a
#    one-shot add:
refs add npm:zod --description "TypeScript-first schema validation" --json
```

Every command accepts `--json` for a stable, machine-readable envelope and `--verbose`
for stack traces on error. Run `refs --help` or `refs <command> --help` — the CLI's own
help is the authoritative, always-current reference.

## Commands

| Command        | What it does                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `refs init`    | Seed or migrate the refs home directory, its config, and the git hooks guard.                                                           |
| `refs add`     | Add a git reference in two phases: propose (`--dry-run`), then finalize (`--proposal`).                                                 |
| `refs list`    | List configured refs with their staleness/missing checkout status.                                                                      |
| `refs show`    | Show a configured ref: entry, state, local path, package count (`--packages`/`--tags` add the package map and sample tags to `--json`). |
| `refs sync`    | Fetch (or re-clone, if the checkout is missing) configured refs — all by default.                                                       |
| `refs resolve` | Resolve a git url, npm package name, import path, or ref-key suffix to its ref/package.                                                 |
| `refs tag`     | Resolve a version to its git tag, via the ref's (or a package's) `tag_format`.                                                          |
| `refs edit`    | Edit one field of a global setting, a ref, or a package.                                                                                |
| `refs remove`  | Remove a configured ref: its config/state entry AND its checkout directory.                                                             |
| `refs doctor`  | Run environment/integrity checks (git, node, config, hooks, checkouts, ssh).                                                            |
| `refs migrate` | Migrate the refs config to the current schema, seeding it if absent.                                                                    |

## Agent skill

The CLI pairs with one thin, cross-agent skill (Claude Code and Codex) that routes agent
questions ("how does zod implement codecs") to the right checkout via `refs resolve
--json` and keeps things fresh with `refs sync`/`refs doctor`. It is user-invoked — it
does not activate on its own; invoke it with `/refs` in Claude Code or `$refs` in Codex.
`refs init` prints the exact install command for your setup. The skill is distributed
from the GitHub repository, which is private during the current development phase — it
opens up when `refs` goes public.

## Changelog

`CHANGELOG.md` ships inside this package (npm's "Code" tab shows it) — the GitHub
repository is private during the current development phase.

## License

MIT
