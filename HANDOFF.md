# Handoff

Written 2026-09-13, after releasing 0.14.0.

## Where things stand

`@kaisers-io/refs` 0.14.0 is on npm with provenance. No open pull requests. Three open issues,
all researched rather than guessed:

- **#120** — `refs resolve` hands back the package's declared entry points. Fully specified,
  smallest of the three, no new dependency and no code parsing. The cheap half of what a packing
  tool would have delivered (see "repomix" below).
- **#124** — an eval suite for the skill, via `claude plugin eval`. Verified locally that it
  accepts a skill folder, so no restructuring is needed. Grader types: `llm`, `baseline`,
  `script`, `contains`, `not_contains`, `regex`, `tool_used`.
- **#125** — offer refs as a plugin without moving the skill. Has an open question that decides
  the trade: whether a manifest can point at `skills/refs` where it is.

## What 0.13.1 and 0.14.0 changed

0.13.1 fixed three defects found in real 0.13.0 use: `tag_format` detected from every tag rather
than the top twenty of a refname sort; a workspace wildcard outside the last path segment
(`crates/*/js`); and printed commands that refs' own parser could not read back (`zPackagePath`
accepts `-new/pkg`).

0.14.0 added two things, both about a `config-drift` check that had stopped carrying information:

- `refs edit --package=<name> --decline --path=<path> <ref>` records a decision not to register a
  discovered package, so the finding stops returning forever.
- Workspace patterns matching at more than one depth (`packages/**/*`) are expanded. Measured
  against the resolvers themselves: astro 554 (pnpm: 554, refs before: 37), next.js 38 (38),
  payload 53 (53).

## Lessons this round paid for

**A test that survives the mutation pins nothing — and "the rule is about spend" is a real
category.** Two tests for the walker's budget rules passed with the rules reverted, because a
small fixture finds the same packages either way. They had to drive the walker with a budget small
enough to run out.

**A test that restates the rule it is testing proves nothing about what ships.** The exclusion
tests stubbed the production predicate with literal equality and missed a defect where
`minimatch('<dir>/**', negation)` treats `**` as ordinary text in the subject string. They now
build the predicates through `excludedDirsFor`.

**Ground truth beats fixtures.** `pnpm ls -r` and `@npmcli/map-workspaces` settled questions that
eight rounds of argument would not have. Matching manifest paths agrees with npm on six of six
pattern shapes; matching directory paths on four.

**`*/` closes a doc block.** Writing a glob into a `/** */` comment terminated it early — twice in
one session. Line comments, or do not spell the glob out.

**Do not run `npx skills add` from the repository root.** It replaced the tracked
`.agents/skills/refs` symlink with a real directory and wrote `skills-lock.json`. Run it from a
neutral directory; it installs into `~/.agents` either way.

## repomix, evaluated and declined

Measured on real checkouts: a mid-size library packs to 3.7 MB / 1.32M tokens in 8 s, a large
monorepo to 74 MB in 37 s. Output that size can only be grepped, and grepping a concatenation is
not obviously better than grepping the tree the agent already has. It would also mean running a
third-party parser over untrusted checkout content on every sync, where refs runs nothing but
`git` — and repomix executes a `repomix.config.ts` found in the working directory, verified both
ways with a marker file. #120 is the cheap half of the benefit.

## Working method that held

Coordinate with Codex before building and at PR end; reproduce every finding before fixing it, and
say so plainly when one does not hold. `pnpm check` after each step, `pnpm test:coverage` at the
end (ratchet 96/90/98/96). Every test that pins a fix must fail when the fix is reverted — check
it. Test against a real repository with the built bundle, and run printed commands verbatim.

One PR per topic. Issues, PRs and the changelog are public: no local paths, no process detail, no
private configuration.
