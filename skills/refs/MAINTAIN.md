# Maintain — sync, doctor, remove

Use this flow for housekeeping requests: refreshing refs, checking their health, or
removing one. None of this needs subagents — it's direct CLI calls plus a human-readable
summary.

## Sync ("sync my refs", "update refs")

```bash
refs sync --json
```

Fetches (or re-clones, if a checkout went missing) every configured ref in parallel.
Pass specific ref keys/suffixes as arguments to sync only those, or add `--stale-only`
to skip anything still within its `sync_ttl`.

The response is `{results: [{key, status, warning?, error?}]}` where `status` is one of
`updated`, `fresh`, `cloned`, `restored`, or `failed`. Summarize by group rather than
dumping the raw array:

- **Updated (N)** — fetched new commits.
- **Fresh (N)** — already up to date, nothing to do.
- **Cloned (N)** — checkout was missing and got re-cloned.
- **Restored (N)** — the checkout had local changes (it shouldn't have — these are
  managed, read-only checkouts); they were discarded and the checkout reset to the
  remote state. Worth flagging to the user as unexpected, even though `refs` self-healed
  it.
- **Failed (N)** — report each failed key with its `error` message.

**Important:** a partial batch failure still comes back as `ok: true` in the envelope
(a per-item failure isn't itself a command failure) — check each item's `status`, and
note that the process exit code is non-zero whenever any item failed, so don't rely on
the envelope's `ok` alone to detect trouble.

## Doctor ("run doctor", "check refs health")

```bash
refs doctor --json
```

Runs environment/integrity checks and returns `{checks: [{name, status, detail}]}` with
`status` one of `ok`, `warn`, `fail`: `git`, `node`, `config`, `hooks-guard`,
`dirty-checkouts`, `orphans`, `skill`, and (when any ref uses ssh) `ssh-auth`. Report
every non-`ok` check with its `detail` message, and explain what it means in plain terms.
A `warn` on `skill` means one of three things: the skill wasn't found in
`~/.claude/skills` or `~/.codex/skills` (the only two paths the check looks at — a
project-level, plugin, or symlinked install reads the same way), the installed copy
predates the version gate, or the CLI version it pins in its frontmatter doesn't match the
running CLI. Every `detail` carries the command that fixes it; only the version-comparison
outcomes also name which side is behind. Relay it verbatim rather than guessing. A `fail`
on `dirty-checkouts` means a managed checkout picked up local changes outside of
`refs sync`'s own self-heal, which is worth investigating rather than ignoring. Like
`sync` above, the exit code goes non-zero on any `fail` even though the envelope is
`ok: true`.

## Remove ("remove ref X", "stop tracking X")

`refs remove` is **destructive**: it deletes both the config/state entry _and_ the
checkout directory on disk. **Always confirm with the user before running it** — state
what will be deleted (the ref key and, if you have it, the local path from `refs show`)
and wait for an explicit yes.

```bash
refs remove <ref> --json
```

`<ref>` accepts the full key or a unique suffix. After confirmation and removal, report
that both the config entry and the on-disk checkout are gone — there's no undo short of
re-adding (`ADD.md`). Since checkouts are read-only, there shouldn't be any local-only
history to lose; if doctor's `dirty-checkouts`/`restored` history suggests otherwise,
say so.
