# Investigate — answering source/behavior/history questions

Use this flow whenever a question is about what a dependency or reference repo
actually does, why, or how it changed — not for adding new refs (`add.md`) or
housekeeping (`maintain.md`).

## The 5-step flow

### 1. List

```bash
refs list --json
```

Returns a compact index: `[{key, description, stale, missing, clone_mode,
packages}, …]`. This is the routing map — read it before guessing which ref
applies.

### 2. Route deterministically

Prefer a deterministic match over guessing from the description:

```bash
refs resolve <query> --json
```

`<query>` can be an npm package name, an import path (`react/jsx-runtime`,
`@scope/pkg/sub/path` — longest matching prefix wins), a git URL, or a ref-key
suffix (`zod`). This returns `{key, local_path, package, stale, missing}`;
`package` is `null` when the query resolves to the ref itself rather than one of
its packages.

**Fallback only:** if the question doesn't name a package/URL clearly enough for
`resolve` to match (a fuzzy question like "the caching library we use"), fall back to
matching against the `description` field from `refs list --json`. If nothing matches
confidently, ask the user which ref they mean rather than guessing.

If `resolve` exits `4` (not found), the ref isn't tracked yet — tell the user and
point them at `add.md` instead of inventing an answer from training knowledge.

### 3. Sync only if stale

Check `resolve`'s `stale` (and `missing`) fields. If `stale: false` and
`missing: false`, skip straight to step 4 — the fast path stays fast. Only sync when
needed:

```bash
refs sync <ref> --json
```

`<ref>` accepts the full key or a unique suffix. Never analyze a `missing` checkout
without syncing first (a missing checkout re-clones on sync).

### 4. Dispatch workers

Analyze the checkout **locally** — never paste large excerpts or diffs into your own
context. Dose subagents per the rule in `SKILL.md` §5: one repo + one clear question =
one worker; a multi-repo or multi-angle question = propose a split first.

Each worker gets the ref's (or package's) `local_path` from step 2/3, the specific
question, and must return only the compact contract below — not raw file dumps or
diffs.

**Worker prompt template:**

```
You are investigating <ref key> at <local_path> to help answer this question:

"<question>"

Rules:
- This checkout is a managed, read-only reference. Only read files and run read-only
  git commands here: `git log`, `git diff`, `git show`, `git blame`. Never edit, stage,
  commit, or run any mutating git command in this checkout.
- Stay within <local_path> (and <package local_path>, if given).
- Do not return raw file contents or diffs — return only the output contract below.

Output contract (return exactly this structure):

## Summary
<2-6 sentences directly addressing the question>

## Commits
- <short sha> <subject> (<date>) — <why this commit is relevant>
(omit this section if no commit history is relevant)

## References
- <path>:<line> — <one-line note on what's there and why it matters>

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
## References -> bullet list of { path, line, note } — path:line pointers into the checkout
```

### 5. Synthesize

Combine the worker contracts into the final answer. Cite `path:line` references and
commit shas from the contracts directly — don't re-derive them. Keep the orchestrator's
own context limited to these compact contracts; if you need more detail than a worker
returned, ask that worker a follow-up (or dispatch a narrower one) rather than reading
the raw source yourself into the main thread.

## Version questions ("what changed between vA and vB")

1. Find the version actually installed in the _user's_ project — read its lockfile or
   manifest (`package.json` + `package-lock.json`/`pnpm-lock.yaml`/`npm-shrinkwrap.json`
   for npm; the equivalent lockfile for other ecosystems). This is the project being
   worked on, not the ref checkout.
2. Resolve each version to a concrete tag via the ref's (or package's) `tag_format`:

   ```bash
   refs tag <ref> <old-version> --json
   refs tag <ref> <new-version> --json
   ```

   Add `--package <name>` when the version belongs to one package of a monorepo ref
   (tag conventions can differ per package). Each call returns:

   ```
   { key, version, tag, ref_path }
   ```

   `ref_path` is a git ref (e.g. `refs/tags/<tag>`), not a filesystem path.

   A `4` exit means the tag doesn't exist for that version/tag_format — double-check
   the version string before assuming the release doesn't exist.

3. Dispatch a worker (or do it inline for a single clear case, per the dosing rule) to
   inspect the range **locally**, read-only:

   ```bash
   git log <old-tag>..<new-tag> --oneline
   ```

   and follow up with `git show`/`git log -p <path>` for specific files/commits as
   needed. The worker still returns only the compact contract from step 4 above —
   commit list + `path:line` highlights, never a pasted raw diff.

4. Synthesize as in step 5.
