# Investigate — answering source/behavior/history questions

Use this flow whenever a question is about what a dependency or reference repo
actually does, why, or how it changed — not for adding new refs (`ADD.md`) or
housekeeping (`MAINTAIN.md`).

## Hard rules (always)

These four rules are absolute; everything else in this document is a recommended
default you may deviate from when the situation calls for it.

1. **Never mutate a reference checkout.** Only read files and run read-only git
   commands (`git log`, `git diff`, `git show`, `git blame`, `git grep`). Never
   edit, stage, commit, checkout, pull, reset, or clean inside a managed checkout.
2. **Cite real sources.** Findings reference actual `path:line` locations and
   commit shas/tags from the checkout — never a summary, digest, or search result
   as if it were the source.
3. **Never present truncated output as complete.** If a command's output was
   bounded or capped (`git log --max-count=<n>`, a capped grep, a `truncated`
   flag in JSON), either widen the search or say explicitly what you did not
   inspect.
4. **Ground answers in the checkout, not training knowledge.** If the ref isn't
   tracked or the checkout can't answer the question, say so instead of filling
   the gap from memory.

## The flow

### 1. Route deterministically

Go straight to `resolve` when the question names a package, import path, URL, or
recognizable repo name:

```bash
refs resolve <query> --json
```

`<query>` can be an npm package name, an import path (`react/jsx-runtime`,
`@scope/pkg/sub/path` — longest matching prefix wins), a git URL, or a ref-key
suffix (`zod`). This returns `{key, local_path, package, stale, missing}`;
`package` is `null` when the query resolves to the ref itself rather than one of
its packages.

**`refs list --json` is the fallback, not the first step.** Reach for it only
when the question is too fuzzy for `resolve` to match (e.g. "the caching library
we use") — then match against the `description` fields. If nothing matches
confidently, ask the user which ref they mean rather than guessing.

If `resolve` exits `4` (not found), the ref isn't tracked yet — tell the user and
point them at `ADD.md` instead of inventing an answer from training knowledge.

### 2. Sync only if stale

Check `resolve`'s `stale` (and `missing`) fields. If `stale: false` and
`missing: false`, skip straight to step 3 — the fast path stays fast. Only sync when
needed:

```bash
refs sync <ref> --json
```

`<ref>` accepts the full key or a unique suffix. Never analyze a `missing` checkout
without syncing first (a missing checkout re-clones on sync).

### 3. Investigate

Analyze the checkout **locally** — never paste large excerpts or diffs into your own
context. Dose subagents per the rule in `SKILL.md` §5: one repo + one clear question =
one worker; a multi-repo or multi-angle question = propose a split first. For a
simple question — one file, or one tight call chain across a few files — the
worker bootstrap can cost more than it saves; investigating inline is fine as
long as you keep the excerpts you pull into context small.

**Recommended search funnel** — usually the cheapest path to the answer; if it
doesn't surface what you need, widen: whole-file reads and broad searches are
always available and sometimes the right call.

1. Locate before you read: `git grep -n "<term>"` (or `rg -l "<term>"`) inside the
   checkout finds the defining sites cheaply. When a broad term is drowned out by
   vendored/generated hits, exclude them with pathspecs
   (`git grep -n "<term>" -- ':(exclude)**/node_modules/**' ':(exclude)dist'`), and
   narrow to a subdirectory first on a cold blobless checkout (see below).
2. Read the smallest span that answers the question (the defining function/class
   plus its immediate context), not the whole file.
3. Follow only the call sites/imports you actually need.
4. Use `git log`/`git blame` when history is part of the question — scoped to the
   file or line range (`git blame -L <start>,<end> <path>`), and `git log
--oneline` before any `-p` variant.

Two things worth knowing about these checkouts:

- Default `clone_mode` is **blobless** — the first read of a file fetches its blob
  over the network. Tree-wide scans (`rg` across the whole repo, `git grep` with
  broad patterns) are fine but may be slower on a cold checkout; narrowing to a
  subdirectory first keeps it fast.
- Vendored/generated directories (`dist/`, `build/`, `vendor/`, lockfiles) are
  usually noise for behavior questions — exclude them by default, but remember
  they exist: some questions ("what actually ships in the published bundle?") are
  answered _only_ there.

**Worker prompt template:**

```
You are investigating <ref key> at <local_path> to help answer this question:

"<question>"

Rules:
- This checkout is a managed, read-only reference. Only read files and run read-only
  git commands here: `git log`, `git diff`, `git show`, `git blame`, `git grep`.
  Never edit, stage, commit, or run any mutating git command in this checkout.
- Stay within <local_path> (and <package local_path>, if given).
- Do not return raw file contents or diffs — return only the output contract below.

Recommended path (cheapest first — widen if it doesn't surface the answer):
grep for the relevant term to locate files, read only the matching spans, follow
only necessary call sites. Whole-file reads are legitimate when structure matters.

Output contract (return exactly this structure):

## Summary
<2-6 sentences directly addressing the question>

## Commits
- <short sha> <subject> (<date>) — <why this commit is relevant>
(omit this section if no commit history is relevant)

## References
- <path relative to <local_path>>:<line> — <one-line note on what's there and why it matters>

If you can't answer confidently, say so in Summary and list what's missing or
where you looked.
```

**Output contract (what a worker must return):** the three markdown sections above
(`## Summary`, `## Commits`, `## References`), in that order, with no extra prose
outside them:

```
## Summary   -> string, 2-6 sentences directly answering the question
## Commits   -> bullet list of { sha, subject, date, why }; omit the section entirely
                when no commit history is relevant
## References -> bullet list of { path, line, note } — path:line pointers into the checkout,
                path relative to <local_path>
```

### 4. Synthesize

Combine every finding into the final answer, whether it came back in a worker's contract
or you noted it during inline investigation. Cite commit shas directly from wherever they
surfaced — a worker's `## Commits` list, or your own `git log`/`git blame` output — don't
re-derive them. Keep the orchestrator's own context limited to compact worker contracts and
your own concise notes; if you need more detail than a worker returned, ask that worker a
follow-up (or dispatch a narrower one) rather than reading the raw source yourself into the
main thread.

Turn every `path:line` reference in the final answer into a clickable link — a worker's or
one from your own inline investigation alike — with the checkout-root-relative path as the
visible text and the absolute checkout path as the target:

```md
[packages/zod/src/v4/core/schemas.ts:218](/abs/checkout/packages/zod/src/v4/core/schemas.ts:218)
```

Five rules make a wrong link detectable instead of silent:

1. **Know the checkout root behind every reference.** For a worker's finding, that's the
   root you gave that worker — keep the worker → checkout-root mapping from dispatch, since
   two refs can contain the same relative path. For a finding from your own inline
   investigation, it's the checkout root you worked in directly.
2. **Join and normalize** — never assemble a path from memory.
3. **Drop anything that escapes the root** (`..`). Report it as a bad reference instead of
   citing it.
4. **Never invent or repair.** A missing line number or an implausible path stays unlinked.
5. **Make the visible text root-relative.** A worker's `## References` entries already come
   this way; a path you picked up directly in the checkout during inline investigation is
   absolute, so strip the checkout root from it yourself before citing.

Wrap the target in angle brackets when the path contains a space, or the markdown breaks:

```md
[src/schemas.ts:218](</abs/my repo/src/schemas.ts:218>)
```

Clickability depends on where the answer is read: the Zed terminal and the Codex app open
these links (verified 2026-08-03); as of the same date the Claude app cannot open files
outside its working directory, whatever the link format.

## Version questions ("what changed between vA and vB")

1. Find the version actually installed in the _user's_ project — read its lockfile or
   manifest (`package.json` + `package-lock.json`/`pnpm-lock.yaml`/`npm-shrinkwrap.json`
   for npm; the equivalent lockfile for other ecosystems). This is the project being
   worked on, not the ref checkout.
2. Resolve each version to a concrete git tag — the diff is then plain read-only git in
   the checkout (worker or inline, per the dosing rule):

   ```bash
   refs tag <ref> <version> --json   # --package <name> in monorepos
   ```

   which returns `{ key, version, tag, ref_path }` (`ref_path` is a git ref,
   e.g. `refs/tags/<tag>`, not a filesystem path). Add `--package <name>` when the
   versions belong to one package of a monorepo ref (tag conventions can differ per
   package). A `4` exit means no tag exists for that version under the applicable
   `tag_format` — before assuming the release doesn't exist, double-check the version
   string and list nearby tags (`git tag -l '<prefix><major>.<minor>*'
--sort=-version:refname` in the checkout); some releases are only reachable as
   version-bump commits in `git log`, not as tags.

   **Sanity-check the resolved tags.** Tags can lie: a similarly-named tag may predate
   the actual release. If a diff looks wrong for a claimed range (e.g. a zero diff),
   verify the tag's content before trusting it — `git show refs/tags/<tag>:<path-to-manifest>`
   should report the version you asked about.

3. Diff between the two tags **locally**, read-only, with raw git.

   **Recommended diff funnel** — start cheap, drill down only where the question
   points; if the funnel doesn't answer it, a full diff is always available.
   Always spell tags fully qualified as `refs/tags/<tag>` (the returned
   `ref_path`) — a tag starting with `-` would otherwise parse as an option:

   ```bash
   # 1. Overview — changelog, commit list, diff stats:
   git show refs/tags/<new-tag>:CHANGELOG.md
   git log refs/tags/<old-tag>..refs/tags/<new-tag> --oneline --no-merges
   git diff refs/tags/<old-tag>..refs/tags/<new-tag> --stat   # add -- <package-path> in monorepos

   # 2. Only then, targeted content:
   git show <sha> -- <path>
   git diff refs/tags/<old-tag>..refs/tags/<new-tag> -- <path>
   ```

   Scope to the package path (`-- packages/<name>`) in monorepos — most of a wide
   range's noise is usually other packages. The worker still returns only the
   compact output contract from §3 above — commit list + `path:line` highlights,
   never a pasted raw diff.

4. Synthesize as in §3 step 4.
