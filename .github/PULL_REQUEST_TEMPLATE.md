<!--
Thanks for the pull request. The checklist below is what a maintainer would otherwise
have to verify by hand; ticking it honestly is the fastest path to a merge.
-->

## What changes

<!-- One or two sentences. The diff shows what; this should say why. -->

## Why

<!--
If this fixes an issue, link it. If the reason is not obvious from the diff — a race
condition, a platform difference, a behavior that only shows up under load — explain it
here rather than in a code comment.
-->

## Verification

<!-- Paste the tail of the run, not a claim that it passed. -->

```
$ pnpm check

```

## Checklist

- [ ] `pnpm check` passes locally on Node 24 (lint, format, typecheck, tests)
- [ ] No configuration was loosened to make a check pass
- [ ] Behavior changes are covered by a test that fails without the fix
- [ ] If CLI output changed, `docs/commands.md` was updated to match **character for character**
- [ ] If this is user-facing, both `CHANGELOG.md` and `packages/cli/CHANGELOG.md` were updated
      identically, under `[Unreleased]`
- [ ] Version numbers were not edited by hand (use `pnpm versions --set <version>`)

## Notes for the reviewer

<!--
Anything you are unsure about, decisions you made that could reasonably have gone the
other way, or parts that deserve a closer look.
-->
