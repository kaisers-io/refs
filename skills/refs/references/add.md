# Add — tracking a new ref

Use this flow when the user wants to start tracking a repo as a ref ("add X as a ref",
"track this repo", "add these repos"). Adding is always two-phase: a dry-run proposal,
then a human-approved finalize. Never skip the approval step.

## 1. Dry-run

```bash
refs add <git-url|npm:pkg> --dry-run --json
```

This resolves the source, clones it into its final location, detects metadata, and
prints a **proposal** on stdout — nothing is written to config yet. The proposal's
`data` shape:

```
{ key, url, default_branch, tag_format_candidate, description, packages }
```

`description` starts empty (`""`); a package that has no detected description simply
has **no `description` key at all** (never `null` — check with "is the key present",
not "is it falsy"). Save this JSON payload's `data` object to a file — it's what you'll
edit and eventually pass back via `--proposal`.

### npm fallback (exit 4, no repository field)

If the source was `npm:<pkg>` and the package has no usable `repository` field, `refs`
exits `4` with a message like:

```
package '<pkg>' has no usable repository field — find the repository and run: refs add <git-url>
```

Don't give up here: research the package yourself (its docs, npm page, GitHub search)
to find its git repository, then retry with the URL directly:

```bash
refs add <git-url> --dry-run --json
```

## 2. Description workers

The dry-run has already cloned the repo locally — analyze that checkout (read-only, per
the invariant in `SKILL.md` §3) to fill in the missing descriptions. Dose per `SKILL.md`
§5:

- **Plain repo (no packages, or a single package):** one worker reads the README,
  `docs/`, top-level project structure, and any examples directory, and writes the
  top-level `description` (and the lone package's description, if it's missing).
- **Monorepo (several packages):** one worker per package, each given that package's
  path, reading its own README/source/`package.json` description to write its
  `description`. **Cap at ~10 packages.** Above that, don't blindly fan out — ask the
  user which packages matter, or batch several packages per worker (e.g. 5 packages per
  worker) and say so.
- **Batch add (several repos in one request):** one worker per repo, run in parallel,
  each doing its own dry-run + description-worker(s) as above.

Workers should return just the filled-in description text (and any note about
uncertainty) — not raw file dumps.

## 3. Mandatory approval

Never call `refs add --proposal` without explicit user approval. Compose the completed
proposal (every description filled in, `tag_format_candidate` unchanged unless the user
wants a different pattern) and show it in full — this is not optional, and it is not
satisfied by a one-line summary:

- the ref key and URL
- `default_branch`
- `tag_format_candidate`, asked for explicit confirmation (or a correction) in the same
  question — this becomes the ref's `tag_format` once written
- the top-level `description`
- **every** package with its `path` and `description` (monorepos: the full list, not a
  sample)

Ask something like: _"Here's the proposal for `<key>` — please review the description(s)
and confirm the tag format `<candidate>` (or suggest a different pattern). Approve to
add it?"_ Incorporate any change requests directly into the proposal object before
proceeding. Do not finalize on partial or implicit approval.

## 4. Finalize

Write the approved proposal object to a file, then:

```bash
refs add --proposal <file> --json
```

(`--proposal -` reads from stdin instead of a file, if that's more convenient.) This
validates the full proposal (every package needs a non-empty `description` at this
point — finalize will reject an incomplete one) and writes the config entry. Repeat once
per repo for a batch add; each finalize is independent.

Simple, non-agent shortcut (for the record, not the default agent path):
`refs add <url> --description "…"` does dry-run + finalize in one step, applying a
single description everywhere one is missing. Skip this for monorepos or whenever
per-package descriptions matter — it doesn't let you set them individually.

## 5. Report

Confirm what was added: the ref key, and (if useful) its local path — fetch it with
`refs show <ref> --json` or `refs resolve <ref> --json` if the finalize response didn't
already surface it. Mention any warnings from the dry-run or finalize (e.g. a
partial-clone fallback to a full clone).
