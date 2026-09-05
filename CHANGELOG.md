# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A failed lookup no longer reads as an absent repository.** `refs resolve` exits `4` when a query
  matches nothing, and the message ended "run refs list, or add it: `refs add <url>`". That second
  half is a guess: a query can miss every route while the repository is tracked perfectly well under
  another identifier — a monorepo root whose own package name was never registered, for instance.
  An agent read the suggestion as confirmation and told someone a repository they had tracked was
  not tracked, then stopped.

  The message now states what was searched and points at evidence rather than prescribing a fix, and
  `--json` carries a `reason` on `resolve`'s routing misses: `unmatched_query` (nothing matched, by
  any route), `package_not_registered` (the ref is tracked and registers no such package), or
  `ref_not_registered` (that exact ref is absent — the one case where adding it is the right
  answer). There is deliberately no reason meaning "this repository does not exist", because nothing
  refs can observe establishes that; and `reason` is absent on every other `not_found`, where its
  absence means no narrowing is available rather than being a fourth value.

  The skill's instruction changed with it. It used to say exit `4` means the ref is not tracked; it
  now says exit `4` means the query matched no route, and requires a second lookup before any
  conclusion. `refs resolve --ref <ref>`'s own miss also stopped suggesting a bare `refs show`,
  which reports a package count and no names — it now suggests `--packages`, which actually shows
  the map the reader was sent to inspect.

- **A stale-lock reclaim could delete a lock another process was using.** refs reclaims a lock left
  behind by a crashed process. The check that decided a lock was abandoned and the removal that
  acted on it were two separate steps, and in the gap between them the lock could legitimately
  become somebody else's: the original holder releases, a waiting process takes the same path, and
  the reclaim then deletes a lock that is actively in use. Both processes go on to `reset --hard`
  the same checkout.

  Three changes close it for processes running this version:

  - **Only a process the operating system reports as gone is reclaimed from automatically.** A lock
    whose lease has run out but whose process still answers is now reported rather than taken — a
    live process can release at any instant, and that release is what opened the gap. Same for a
    lock whose metadata never finished being written, or carries no usable identity.
  - **The acquisition is re-identified after the death check.** Proving the recorded process gone is
    not enough on its own: the metadata is read first and the process probed after, so the path can
    change hands in between and the probe then answers about the departed owner. Re-reading the
    identity immediately before the removal is what ties the two together.
  - **The marker that stops two reclaims colliding no longer expires.** It used to be taken over
    after two seconds, so it only excluded a reclaim fast enough to finish inside that window; a
    suspended one lost its marker mid-work and a second reclaim started on the same lock. Age is
    not evidence of abandonment.

  The protocol's own markers also moved into `locks/.claims/` and `locks/.tombstones/`, which no
  lock name can reach — lock names must start with a letter or digit. That removes a collision
  where a repository literally named `foo.steal-claim` produced the marker path of the lock for
  `foo`, and with it the name-shape guessing `refs doctor` needed to tell the two apart.

  **What this costs.** Three situations no longer recover on their own and need one explicit
  command, which `refs doctor` prints along with the condition for running it safely — stop every
  refs process on that home first, suspended ones included: a crash after the operating system has
  reused the process id, a crash before the lock finished writing its metadata, and a crash while a
  reclaim was starting.

  The messages changed to match. `refs doctor`'s `locks` check separates a lock refs will reclaim
  by itself from one it will not, and the failure message when a lock cannot be acquired no longer
  says "already reclaimable — retry" for a lock nothing will ever reclaim. It also stopped
  describing the window as the thing that frees a lock: waiting does not, and only a recorded
  process the operating system reports as gone does.

  **What it does not fix.** A refs process running an _older_ version follows none of this and
  reclaims on its own terms. And no lock protocol can help when refs is hard-killed while its `git`
  child survives: the successor's lock is honest about the lock, not about the directory.

- **Two unrelated refs could share one lock.** The per-ref lock name replaced `/` with `_`, and `_`
  is legal inside a ref key — so `github.com/acme_tools/widget` and `github.com/acme/tools_widget`
  both derived `ref.github.com_acme_tools_widget`. The two then serialized against each other:
  `sync` fans out four refs at a time and the loser failed on a lock conflict after the timeout,
  `resolve`'s verification could block on a sync of a ref it has nothing to do with, and `doctor`'s
  `config-drift` check reported the wrong ref as busy.

  The name is now injective. A key containing no `_` encodes exactly as before, so it keeps the
  lock name refs has always written for it; a key containing one moves into an escaped form under
  `ref._`, where `_` becomes `_u` and `/` becomes `_s`. The two forms cannot collide, because a ref
  key always starts with `[a-z0-9]` and so a plain name never begins `ref._`.

  A lock name is one directory entry, so a key long enough to overflow one now falls back to a
  digest under `ref.__` rather than failing `mkdir` with `ENAMETOOLONG`. The budget reserves room
  for the sibling entries the steal protocol derives from a lock name — a name that could be
  created but not renamed to its tombstone would strand an abandoned lock that nothing could then
  reclaim, leaving the ref blocked until someone deleted the directory by hand. Both were already
  true before this change, for keys past roughly 200 characters; reaching it needs a self-hosted
  url, since no forge allows a path that long.

  **One caveat if you run refs concurrently across an upgrade.** The lock name changes for a ref
  whose key contains `_`, and for one long enough to reach the digest form — roughly 200
  characters, either way. For such a ref, a process from any earlier release (the old scheme dates
  to 0.1.1) derives a different name from a new one, so for the length of that overlap the two
  would not exclude each other. The window is a mid-upgrade concurrent run on the same refs home;
  if that is a situation you can be in, let running operations finish before upgrading. Every other
  ref keeps its name and is unaffected.

## [0.11.0] - 2026-08-31

### Changed

- **The skill's version-question flow moved into its own file.** Every question about a
  dependency's source loads `SKILL.md` and `INVESTIGATE.md` in full, and 30 % of
  `INVESTIGATE.md` was a block on resolving versions to tags and diffing between them — read
  on every plain source question, used on almost none of them. It is now `VERSIONS.md`, with a
  route of its own in `SKILL.md` §5 and a one-line pointer at the end of `INVESTIGATE.md`, so
  a mis-route costs one extra read rather than a wrong answer.

  Alongside it, a compression pass over what remains: the worker output contract was stated
  twice and is now stated once, the five clickable-link rules became one normalization, and a
  handful of sentences that repeated something said a few lines earlier are gone. Nothing
  behavioural was removed — the capability gate, the trust boundary, the five hard rules and
  the worker prompt's own safety rules are untouched, and the measured partial-clone cost model
  (which git commands fetch blobs, and that `git blame` fetches one per visited revision) is
  refs' own measurement rather than something the term "partial clone" implies, so it stays
  verbatim.

  A plain source question now loads 20 % less. A version question loads about what it did
  before, plus one extra file read.

### Added

- **`refs sync` and `refs doctor` now report configuration that has fallen behind its upstream.**
  A configured package path is only a locator, and upstream can delete or move what sits at it.
  Until now only `refs resolve` noticed, for the one package an agent happened to route to, and it
  persisted nothing — so a package deleted upstream could sit wrong in the configuration
  indefinitely while every other package in the same checkout went uninspected.

  Each successful `refs sync` result now carries a nested `structure: {status, packages}`, probed
  inside the lock the sync already holds, right after the checkout was updated. Nothing is stored:
  the answer is reported and thrown away, so there is no drift state that can itself go stale. A
  removal and a relocation are reported as different findings, because they need opposite repairs —
  telling an agent to "fix the path" of a package upstream deleted sends it looking for something
  that is not there. Human output gains indented lines under the affected ref and stays silent when
  everything resolves; the summary counts and exit code are untouched, since a drifted ref synced
  perfectly well.

  Only refs that actually sync are probed, which keeps `--stale-only` a genuine no-op — and is why
  `refs doctor` gains a `config-drift` check as the deliberate "check everything now" counterpart.
  It takes each ref's lock with a short timeout and reports the ref as busy rather than waiting,
  writes nothing, and reports `warn` rather than `fail`: the configuration has fallen behind,
  nothing is broken. `refs list` deliberately stays blind — without stored state it would
  turn a cheap inventory command into a locking filesystem sweep.

- **`refs resolve` answers in one call what used to take three.** The skill's investigation flow
  began `resolve` → `sync` → `resolve` **again**, and the third call was not ceremony: package
  verification had described the checkout as it was _before_ the sync, so reusing that answer meant
  reporting a path that no longer necessarily held what it claimed. `--sync-if-stale` fetches (or
  clones) only when the ref is stale or its checkout absent, and everything it reports describes the
  checkout afterwards. The rule has left the skill and become code.

  It refuses, rather than syncing, when the checkout is `unmanaged` or `unverifiable`. `sync`
  hard-resets and cleans; running it against a directory whose identity was never established is
  how a stray clone loses its history. A failing sync fails the command rather than returning a
  success envelope containing a stale path.

- **`refs resolve --project <dir>` reports the version a project has installed.** The skill used to
  tell the agent to read the project's lockfile by hand, and nothing in refs touched one — so the
  deterministic half of every "what changed between my version and a newer one" question was done
  by the least deterministic component available, against pnpm's peer-qualified keys, aliases,
  overrides and three vendor-specific formats.

  The answer is read from `node_modules`, walking up in Node's own lookup order, and stops at the
  first installation slot that exists rather than the first readable manifest — falling through to
  an ancestor would report a shadowed install Node would not have loaded. There is deliberately no
  lockfile fallback: a lockfile says what _should_ be installed, `node_modules` says what _is_, and
  the second is the question. `installed.status` is `found`, `not_materialized`,
  `unsupported_layout` (Yarn PnP, detected but never loaded — `.pnp.cjs` is project code) or
  `unverifiable`.

- **`refs resolve --ref <ref>`** scopes a query to one ref's packages. A package name registered by
  several refs used to be answered with "use the full ref key" — advice the command could not
  honour, because a full-key query routes by _ref_ and comes back with `package: null`. The error
  now names a remedy that exists.

- `refs doctor` gained a `locks` check. A held lock used to be invisible: acquisition failed with a
  message that named no owner, and `doctor` had no lock check at all — so the one command meant to
  answer "is something stuck?" could not see the thing that was stuck. The check lists every entry
  in the locks directory with its recorded owner, how long it has been held, and against which
  window.

  A held lock is **not** a warning by itself: that is what a concurrent `refs sync` looks like, so
  it reports `ok` with the holder listed. `warn` is reserved for something that will not resolve on
  its own — a recorded process that is gone, a lock past its window and still there, metadata that
  cannot be read, or something that is not a lock at all occupying a lock name. Like every other
  `doctor` warning, it does not change the exit code.

### Changed

- **`refs resolve` establishes that the path it hands back is really this ref's checkout.** It used
  to report presence from a `.git` entry alone, while `add` and `sync` both ran a stronger guard
  before mutating — so the one command whose result is read as "the source is here" was the one
  that did not check what was there. A manual clone at the derived path, a half-finished `remove`,
  a restored backup or a symlinked second home all produced a confident answer about the wrong
  repository, with no error and no warning.

  Every reply now carries `checkout: {status, reason?}` — `managed`, `missing`, `unmanaged` or
  `unverifiable` — read straight out of `.git/config` without spawning git, so the hot path stays
  subprocess-free. The origin URL is never echoed back in `reason`; it can carry credentials.

  `managed` requires the `core.hooksPath` marker to be **this home's** hooks directory, not merely
  present — the comparison `add` already makes — so a manual clone that sets it for its own purposes
  does not pass. A config git itself would reject (an unterminated quote, an undefined escape, a
  line that is neither a section nor an assignment) is `unverifiable` rather than partially read: a
  file git would not accept is not evidence of identity.

  **Package verification is gated on it.** A manifest read inside an unrelated checkout can answer
  `verified` for a package that has nothing to do with the query, so anything other than `managed`
  or `missing` now yields `package.status: "unverifiable"` instead of a confident location.

  `missing` is unchanged and still means `checkout.status === "missing"`. Callers should branch on
  `checkout.status`, which answers the question `missing` was often assumed to.

- **The "lock is held" error now says who holds it and for how long.** It used to read `lock <name>
is held — another refs process is running`, which left no way to tell a running `sync` from
  something that crashed 90 seconds ago. It now names the recorded pid, whether that pid is still
  present, how long the lock has been held, and when it becomes reclaimable.

  It deliberately says "recorded pid … is present (identity not verified)" rather than "held by pid
  …": only `ESRCH` establishes that a process is gone, so a pid that answers may equally be an
  unrelated process that reused the number. And it says "reclaimable", never "released
  automatically" — nothing removes a lock in the background; the phrase means the next acquisition
  attempt is entitled to take it.

- **An operation that ran without the lock it asked for now fails instead of reporting success.**
  A lock can still be lost while its holder works — a stolen lock is detected by the next renewal,
  or by release finding a foreign token. Previously the callback's result was returned as if
  nothing had happened. It is now reported as a `conflict` (exit code 5), because the work ran
  without the mutual exclusion it requested and its result is not trustworthy. An operation that
  failed on its own keeps precedence: its own error is what the caller sees.

### Fixed

- The `rm -rf` commands `refs doctor` and `refs add` suggest are now quoted. Ref keys derive from
  user-supplied urls and permit spaces, `$()`, backticks, semicolons and quotes, and the refs home
  itself routinely sits under a path containing a space — so pasting an unquoted suggestion could
  delete several wrong paths and leave the intended one, or execute a command substitution embedded
  in a repository name. The form is now `rm -rf -- '<path>'`; `--` additionally stops a path
  beginning with `-` from parsing as options.

- A pid in a lock's metadata is now required to be a positive integer within the range
  `process.kill` accepts. `0` and negative values are
  process-_group_ selectors for `process.kill`, so metadata carrying either made the liveness probe
  answer for a whole group — reporting a long-gone owner as present, and keeping its lock
  unreclaimable for the rest of its window. A value past that range is worse still: Node rejects it
  with a `TypeError` rather than an errno, which the probe read as "not gone, therefore present".
  Such metadata is now reported as malformed instead of acted on.

- A lock is no longer taken away from a holder that is still working, however long the work takes.
  Locks were judged by a fixed ten-minute age: past it, a waiter treated the lock as abandoned and
  stole it even when its owner was demonstrably alive and mid-operation. Since the per-ref lock is held across a whole clone or
  fetch, any repository large enough to take ten minutes could end up with two processes running
  `checkout -B` / `reset --hard` / `clean -fd` against the same directory.

  A holder now renews a lease while it works, so a lock is abandoned when its process is definitely
  gone **or** its lease has expired — never merely because the work took a long time. "The pid still
  exists" does not override an expired lease, which is what keeps a recycled pid from stranding a
  lock forever.

  The same constant was also too long at the other end: a crashed `sync` or `add` left its lock
  behind and blocked the ref for the full ten minutes. An abandoned lock is now reclaimable after
  two minutes rather than ten.

  Two limits are worth knowing. A holder whose event loop is stopped for longer than the lease — a
  suspended process, a sleeping machine — cannot renew, and is stealable after two minutes where it
  used to take ten; in practice a sleeping machine suspends every refs process on it, and the
  pending renewal fires on resume. And a lock written by an older CLI carries no lease and is still
  judged by the ten-minute rule it was written under, so upgrading never dispossesses a running
  older process. The reverse does not hold:
  an older CLI reads no lease, so it can still take a lock from a live current holder once ten
  minutes pass. Holds longer than that during a rolling upgrade are not protected.

## [0.10.0] - 2026-08-13

### Added

- `refs resolve` now verifies that the package it routes to is actually where the config says
  it is. A configured `path` is only a locator; the package name is its identity, and upstream
  repos restructure on their own schedule. Previously a package that had moved — or a different
  package that had taken over its directory — was handed back regardless, so an agent read the
  wrong source and answered confidently. That failure produced no error and no warning.

  `package.status` now reports what was established: `verified`, `relocated` (found at exactly
  one new path, which is returned in place of the stale one), `unmaterialized` (no checkout yet),
  `unverifiable` (verification could not complete — `reason` says why), `ambiguous` (the name
  exists at several paths, listed in `candidates`), or `missing`. All six exit `0`; see
  `docs/commands.md` for the full contract.

  `relocated` corrects the answer for that call only and never writes to `config.toml`. Persist
  it with `refs edit <ref> --package <name> path <new-path>`.

### Changed

- **`resolve`'s `package.local_path` can now be `null`.** It is `null` for `missing` and
  `ambiguous`, where no safe location is known. A caller that treated a zero exit as "here is a
  usable path" must check `package.status` first; previously the field was always a string.

- Workspace detection now reports why it found nothing. An unreadable or malformed workspace
  declaration, an unreadable manifest, a candidate resolving outside the repo, an unsupported
  pattern, a package directory reachable only through a symlink — each used to collapse into the
  same empty result, leaving a transient read error indistinguishable from "every package was
  removed". Each is now reported, and a scan carrying any of them is treated as possibly
  incomplete: it can neither conclude that a package is gone nor that a single sighting of one is
  unique. `refs add` is unaffected — it consumes the same best-effort list it always has.

  A manifest that reads fine but declares no usable `name` is reported too, but does **not** make
  a scan incomplete: there is demonstrably no resolvable package at that path. Nameless manifests
  are common enough (zod's own repository root has none) that treating them as failures would
  permanently suppress detection for those repos.

  One limit is deliberate and worth knowing: a scan only covers what the repo's workspace
  declaration points at. A package registered by `refs add`'s npm fallback — at `path: "."`, or
  the packument's `directory` — lives outside that coverage, so if it moves, `resolve` reports
  `unverifiable` rather than guessing. It never reports `missing` from a scan that had nowhere
  to look.

## [0.9.0] - 2026-08-13

### Added

- refs tells you when a newer version is published. `refs sync` and `refs doctor` ask npm at most
  once a day and cache the answer; `refs sync` mentions a newer release in its `warnings`, and
  `refs doctor` reports it as a `cli-update` check. `refs --version` is untouched — it stays exactly
  one version line on stdout, because the skill's capability gate and any script parse it.

  Both switches live in `[updates]` in `config.toml` and default to on: `check` governs the registry
  request everywhere, `notify` the routine path only. `notify = false` with `check = true` is
  "don't interrupt me, but answer when I ask" — `refs sync` neither asks nor mentions, `refs doctor`
  still does both. `REFS_UPDATE_CHECK` overrides `check` (`0` off, `1` on), and the check is off in
  CI. The table is absent from a config that wants the defaults, and refs never writes one.

  Nothing about it is load-bearing: an unreachable registry, a malformed answer or an unwritable
  cache all mean "we don't know" and are never reported as a fault. The registry host is hardcoded
  rather than read from npm configuration, only a plain `x.y.z` is accepted from the response, and
  the update command is printed for you to run — refs does not install itself.

### Fixed

- A ref can be recorded without a `tag_format`. Finalizing an add used to reject a proposal whose
  `tag_format_candidate` was `null`, which left one option for a repository that publishes no tags:
  invent a convention. A real user hit this and was asked to confirm `v{version}` for two
  repositories that have no tags at all — a claim nobody had verified, written into `config.toml`
  where later agents read it as fact. The candidate now survives finalize as an absent field.

  `refs tag` is the only command that reads it, and it exits `3` (validation) when there is none,
  naming the ref — or the package, with the `--package` form of the fix. The distinction from `4`
  carries information: `3` means this ref cannot resolve any version, `4` means this particular
  version was never tagged. The skill's add flow gained an explicit branch for the `null` case, so
  an agent reports the absence instead of proposing something to fill the gap.

  A format already recorded can only be removed by editing `config.toml` directly; `refs edit` can
  set one but has no way to unset it.

## [0.8.3] - 2026-08-12

### Added

- The skill states a trust boundary. Everything inside a managed checkout is untrusted third-party
  content — README, comments, commit messages, and any `AGENTS.md` or `CLAUDE.md` a tracked repo
  ships — so it is evidence to read and never instruction to follow. Documentation stays evidence,
  including a repo's own contributor and agent docs; what goes to the user as a finding is content
  targeting the agent that reads it. Both worker flows carry the rule into their prompts. This
  narrows the blast radius of indirect prompt injection; it is not a sandbox, and SECURITY.md says
  so.

### Changed

- The skill installs nothing. Its capability gate used to ask permission and then run
  `npm i -g @kaisers-io/refs` itself; it now prints the command — pinned to the version the skill
  was written against, not `@latest` — and stops until the user has run it. A skill that installs
  the executable giving it its capabilities is a bootstrap trust boundary worth keeping explicit,
  and Anthropic's skill documentation discourages global installs from a skill.

- The `--json` examples in the skill's command reference use placeholder repositories
  (`example-org/…`) instead of real third-party ones, and say up front that they are illustrative
  output rather than repositories the skill fetches.

## [0.8.2] - 2026-08-10

### Fixed

- Documentation that described flows which did not work. The README's quickstart failed in both
  of its branches, the skill's onboarding handed the user a prompt naming a zod version that was
  never tagged, and `docs/commands.md` showed a stored url and a package count the CLI does not
  produce. Every documented command was re-run and corrected against its real output, and the
  `skill` check's Windows note was still describing the gap 0.8.1 closed.

- `git_transport` was documented as overridable per ref. It can be written there, since the
  override schema is derived from the settings schema, but nothing reads it: only `refs add`
  consults the setting, and `add` refuses a key that is already configured. Documented as inert.

### Changed

- The README and the package page are rewritten around the agent workflow, which is how refs is
  meant to be used, with the manual CLI route kept as the side note it is.

- The package description now matches the repository's.

## [0.8.1] - 2026-08-10

### Fixed

- Locked commands could hang instead of timing out. If a lock looked abandoned but could not
  actually be reclaimed — another process holding the steal claim, or Windows refusing to remove
  the directory while a handle was still open inside it — the acquire loop retried without ever
  consulting its deadline, so the ten-second acquisition budget never applied and the command spun
  until interrupted. Both unbounded paths now honour the deadline and fail with the conflict error
  (exit code 5) as documented.

- `refs doctor` reported a correctly installed skill as missing on native Windows. Its three
  global search locations were derived from `$HOME`, which Windows typically leaves unset, while
  the installer resolves `os.homedir()` — so all three silently dropped out of the search and the
  check reported `warn`, "not found in the locations this check knows about". It now reads the
  same home directory the installer writes to. macOS and Linux were unaffected, the two agreeing
  there.

### Security

- Canonicalizing a git url no longer takes quadratic time. Trailing slashes were trimmed with a
  pattern anchored at the end of the string, which backtracks through a run of slashes from every
  position; a url carrying a long run in the middle of its path took 14 seconds to be rejected.
  Such a url is reachable — `refs add npm:<package>` reads `repository.url` straight out of the
  registry's packument, and nothing bounds its length — so a published package could stall the
  command that adds it. Trimming is now linear.

- Every git invocation that receives a url now ends option parsing with `--` first. Without it,
  git honours a url shaped like `--upload-pack=<command>` and executes it. Urls accepted through
  `refs add` were already refused by canonicalization, but `refs sync` re-reads them from the
  config file, where they are only checked for being non-empty — the guarantee therefore held one
  step away from the call that depended on it. It now holds at the call.

### Changed

- Published packages carry a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements).
  npm produces these automatically for public repositories, and `0.8.0` shipped without one
  because the repository was private at the time and the check for that fails silently. The
  release workflow now states `--provenance` and refuses to publish if the repository is not
  public.

- `refs init`'s skill-install hint now presents the second form as installing from a local
  clone, rather than as a workaround for the repository's development phase. Both commands
  are unchanged; only the wording differs.

## [0.8.0] - 2026-08-04

### Changed

- Lowered the supported Node.js floor from `>=24.12` to `>=24.2`. The real requirement was
  always `import.meta.main` (used by the CLI's entry-point check), which Node added in 24.2.0 —
  the higher number had no other reason behind it. Users on Node 24.2 through 24.11 were
  previously blocked for no reason and can now run `refs` as-is.

### Fixed

- The agent skill's citation contract now binds every source reference, not only
  worker-relayed ones. An inline investigation (no worker dispatched, per the step 3
  dosing rule) previously fell outside the contract and could emit bare absolute paths
  instead of clickable relative-text links.

### Removed

- The Claude Code and Codex plugin packaging (`.claude-plugin/`, `.codex-plugin/`, and the
  `.agents/plugins/marketplace.json` mirror). Neither manifest carried a payload beyond the
  `refs` skill, so installing one produced a second copy that could drift from the one
  `skills add` installs — observed in practice: two `refs` entries in the Codex skill picker,
  and an icon that reached only one of them. `refs` now ships exactly two ways: the CLI from
  npm (`@kaisers-io/refs`) and the skill from git (`skills add`).

  If you installed the plugin, uninstall it (Claude Code: `/plugin`; Codex CLI: `/plugins`)
  and install the skill instead — see the install section in the README, which covers the
  repository still being private. The `@refs` plugin-mention gap in Codex (codex-cli 0.146.0,
  [openai/codex#22078](https://github.com/openai/codex/issues/22078)) no longer applies: there
  is no plugin to mention. Invoke the skill with `/refs` in Claude Code or `$refs` in Codex.

## [0.7.0] - 2026-08-03

### Changed

- `refs list`, `show`, `resolve` and `init` print one `key: value` per line, with a blank line
  between `list` entries. The `key  description` header line is gone, and `local_path:` is now
  `path:` (`package path:` for the package inside a ref).
- `[stale]`/`[missing]` markers are replaced by `synced: <when>`, plus `status: stale` and
  `missing: …` lines when they apply. Human output only; `--json` keeps `stale` and `missing`.
- `refs init` says `config: unchanged` where it used to print `(noop)`.
- The npm-facing `packages/cli/README.md` now documents the skill-check search locations the
  root README has described since 0.6.1.

### Added

- `last_fetched_at` on `refs list` items and `refs resolve` output, `missing` and `stale` on
  `refs show` — all `--json`, all additive.
- Source citations from the agent skill are now clickable markdown links.

## [0.6.1] - 2026-08-03

### Fixed

- `refs doctor`'s `skill` check no longer reports a skill that is installed and working as
  missing. It only ever looked in `~/.claude/skills/refs` and `~/.codex/skills/refs`, but
  `npx skills add kaisers-io/refs` — the documented installer — writes neither: it keeps one
  real copy in a shared `.agents/skills/refs` directory and symlinks each agent's own
  directory at it. A Claude Code user was rescued by that symlink; anyone without one — a
  Codex-only user, or anyone whose install went to the current project rather than `$HOME` —
  was told to install a skill they already had, and never saw the version comparison that
  `0.6.0` made the point of this check. Five locations are now checked, in this order:
  `~/.agents/skills/refs/SKILL.md` (`shared ~/.agents`), `$CLAUDE_CONFIG_DIR` or `~/.claude`
  (`Claude Code`), `$CODEX_HOME` or `~/.codex` (`Codex`), `<cwd>/.agents/skills/refs`
  (`project ./.agents`), and `<cwd>/.claude/skills/refs` (`project ./.claude`). The last two
  are there because `skills add` installs into the current project unless `-g` is passed, and
  implies `-y` when it runs inside an agent, so an agent-driven install never touches `$HOME`
  at all — and because naming a single agent (`skills add … -a claude-code`) switches the
  installer to copy mode, which skips the shared `.agents` directory entirely and writes only
  that agent's own. Unlike its global counterpart, the project path takes no env override:
  the installer hardcodes a relative `.claude/skills` there. Codex needs no counterpart at
  all, being a universal agent whose project install lands in `./.agents` in every mode. The
  locations are deduplicated by resolved real path, so the usual symlinked install is
  reported once rather than once per agent, while two genuinely independent copies are both
  compared and a problem in either wins.
- `refs doctor`'s "skill not found" message no longer claims the skill is not installed, and
  no longer names directories it did not search. That list of locations is best-effort and
  cannot be otherwise: the paths are the `skills` installer's implementation detail rather
  than a documented contract, the canonical directory has moved before, and 74 agents carry a
  global skills directory of their own. A skill installed for some other agent still works
  and is simply invisible here, so the `detail` now names the locations it searched and keeps
  the install hint for the case where the skill really is missing. Those names are derived
  from the paths actually resolved, so with `$CLAUDE_CONFIG_DIR` or `$CODEX_HOME` set the
  message names the override rather than the `~/.claude`/`~/.codex` it replaced — an override
  moves the search, it does not widen it, and pointing anyone at the directory the check just
  skipped would be worse than saying nothing. It stays a `warn`, never a `fail` — the skill's
  own capability gate compares `refs --version` against the pin in the file the agent already
  loaded and depends on none of this.

## [0.6.0] - 2026-08-03

### Changed

- **Breaking (`--json` only):** `refs list --json` and `refs show --json` no longer include
  the ref's package data by default. Both now report a `packages_count` number instead; pass
  `--packages` to get the names back (a sorted `string[]` on `list`, the full package map on
  `show`). `refs show <a-140-package-monorepo> --json` drops from roughly 4,400 tokens to
  about 100. Human output is unchanged — it never showed package data.
- **Breaking (`--json` only):** `refs show --json` no longer includes `sample_tags` unless
  `--tags` is passed, and skips the `git tag` subprocess entirely when it isn't. Human
  output is unchanged: it always probes for tags, and still prints the `tags:` line
  whenever the probe found any.
- The agent skill is now **explicitly invoked only** — it no longer activates on its own.
  Invoke it with `/refs` (Claude Code) or `$refs` (Codex). This is `disable-model-invocation`
  in the frontmatter plus `policy.allow_implicit_invocation: false` in the new
  `skills/refs/agents/openai.yaml`.
- The skill's reference files moved out of `references/` and now sit beside `SKILL.md` as
  `INVESTIGATE.md`, `ADD.md`, `MAINTAIN.md`, and `ONBOARDING.md`, joined by a new
  `COMMANDS.md` CLI reference. `npx skills add` and `skills update` replace the skill
  directory wholesale, so nothing is left behind. **If you installed the skill by copying
  files manually, delete the old `skills/refs/references/` directory** — it would otherwise
  sit alongside the new files with stale instructions.
- The skill now pins the CLI version it was written against
  (`metadata.cli_version` in its frontmatter), and the release workflow fails if that pin
  drifts from the published CLI version.
- `refs doctor`'s `skill` check now compares that pinned `cli_version` against the running
  CLI and names which side is behind, instead of only checking that `SKILL.md` exists. Both
  `~/.claude/skills/refs` and `~/.codex/skills/refs` are checked, and a problem in either
  wins over an `ok` in the other.

### Fixed

- The skill's frontmatter claimed macOS/Linux only. Windows has been fully supported since
  0.5.0; the field is gone.

## [0.5.1] - 2026-07-30

### Added

- The npm tarball now ships a package README (the npm page was empty) and this
  `CHANGELOG.md` — the latter matters because the GitHub repository is private during the
  current development phase, so the packaged copy is the only changelog users can see.
  The release pipeline's tarball-content allowlist covers both, and a new guard fails the
  release if the packaged changelog drifts from the repository one.
- Registry metadata in `package.json`: `keywords`, `homepage`, and `bugs`.

## [0.5.0] - 2026-07-30

### Added

- Full Windows support: every command, the lock/steal machinery, sync/clone/remove with their
  containment guards, and the read-only hook guards now behave on Windows exactly as on
  macOS/Linux (Git for Windows required). CI runs the full test suite plus a PowerShell smoke
  test — which exercises the npm-generated `.cmd` shims — on `windows-latest`.

### Fixed

- Lock directory names no longer contain `:` (illegal in Windows file names; every locked
  command failed with `EINVAL` there). Per-ref locks are now named `ref.<key>`; a stale
  `ref:<key>` directory left by an older version is inert and can be deleted.
- The lock-steal pipeline treats Windows sharing-violation errors (`EPERM`/`EACCES`/`EBUSY` on
  the tombstone rename or on re-creating a directory that is still delete-pending) as a lost
  race and retries, instead of crashing.
- Workspace package paths are `/`-separated identifiers on every platform (they previously used
  `\` on Windows, breaking sorting, deduplication, and stored config paths).
- Child-process cleanup also listens for `SIGBREAK`, so Ctrl-Break on Windows kills spawned
  git/ssh children like Ctrl-C does.

## [0.4.0] - 2026-07-28

### Changed

- Internal: whole-codebase clarity refactor — comments now explain behavior instead of project
  history, inline lint exceptions cut from 75 to 20, `type` aliases replace interfaces
  throughout, dead exports removed, and the workspace-detection logic is split into a pure,
  directly-tested module. No CLI behavior change.

### Removed

- `refs search` and `refs range` (both added in 0.3.0). A dedicated efficiency benchmark
  (18-task corpus built around the two commands, taught inline with worked `--json` examples and
  provably on `PATH`) measured **0 / 324 adoption** — neither Opus 4.8 nor GPT-5.6 invoked either
  command on a single task, including tasks constructed to favor them — while the condition
  carrying the teaching cost _more_ (cost-weighted spend +19% over discipline, +41% over naive for
  Claude). With the dependency source checked out, both commands compete head-to-head with the
  agent's native `git grep` / `git log` / `git diff` and lose: they are redundant with skills the
  agent already has on the very source refs provides. refs' core value — real, local source the
  agent then reads and greps — is unchanged. The agent skill now routes source-search and version
  questions to `resolve`/`sync`/`tag` plus read-only git on the checkout. The now-dead core helpers
  (`git/grep`, `git/range`, `git/changelog`) were removed with them.

## [0.3.0] - 2026-07-23

### Added

- `refs range <ref> <old-version> <new-version>` — a bounded version-diff digest for
  agent-driven "what changed between these versions" questions. Resolves both versions to git
  tags (same `tag_format` inheritance as `refs tag`) and returns, in one call, the commit count,
  the newest `--limit` (default 50) non-merge commit subjects, diff stats, changed paths (capped
  at 200), and a changelog excerpt extracted at the new tag. `--package <name>` scopes the
  diff/paths/changelog to that package's path while the commit log stays repo-wide. Every bounded
  list carries an honest flag in `truncated`; the digest is a starting point, and the full history
  stays available via plain git in the checkout.
- `refs search <ref> <pattern>` — bounded structured code search over a ref's checkout. Wraps
  `git grep -z -n -I --extended-regexp` and returns `{path, line, snippet}` matches (trimmed,
  capped at 200 chars), at most `--limit` (default 50), with `truncated: true` whenever more
  exist. Vendored/generated paths (`dist`, `build`, `node_modules`, lockfiles, …) are excluded by
  default and echoed in `excludes_applied`; `--no-default-excludes` turns them off. `--glob` takes
  plain glob patterns (never raw git pathspec magic — leading `:` or root-escaping `..` are
  rejected), and `--package` is a hard boundary that intersects with any `--glob` and refuses a
  package directory resolving outside the checkout. No matches is a success, not an error.

### Changed

- Rewrote the agent skill's investigation playbook (`skills/refs/references/investigate.md`) as an
  advisory guide built on the "hint, not gate" principle: four hard rules (read real source before
  citing, treat digests as starting points, honour truncation flags, unmask decoy version tags)
  plus recommended investigation funnels with explicit escape hatches, tuned by two real-world
  field tests.

## [0.2.0] - 2026-07-07

### Added

- Onboarding flow for the agent skill (`skills/refs/references/onboarding.md`, triggered by
  "onboard me" / "set up refs" / "what is refs"): health check via `refs doctor --json`, a
  consented `refs init` where needed, the three core jobs explained with copyable example
  prompts, and a first-ref suggestion drawn from the project's own dependency manifests.
- Install flow in the skill's capability gate: when the `refs` CLI is missing, the agent now
  checks the Node version, asks the user for consent, installs `@kaisers-io/refs` from npm,
  verifies with `refs --version`, and runs `refs doctor --json` automatically. A new
  `compatibility` frontmatter field declares the CLI dependency.

### Changed

- All example content (docs, skill references, README, CLI help text) switched from next.js to
  zod (`github.com/colinhacks/zod`) — every example validated against a real zod checkout via
  refs itself.
- Development now requires pnpm 11 or newer (`engines.pnpm` at the workspace root); the
  published CLI has no pnpm requirement.
- The user-facing supported Node range relaxed from `>=24.12 <25` to `>=24.12` (open-ended),
  verified working on Node 25.9 and 26.4 (build, tests, stub, and source fallback). Development
  stays pinned to Node 24.12 via `.node-version`; CI and the root `packageManager` field are
  unchanged.
- `packages/cli/bin/refs.mjs` is now a committed, zero-dependency stub (not build output): it
  checks the Node.js version, then loads and runs the tsdown bundle from `dist/refs.mjs`. If the
  bundle is missing but sources and dependencies are present, it falls back to running the CLI
  directly from TypeScript source via Node's native type stripping. It fails loudly with an
  actionable message (exit 1) only if neither the bundle nor the source fallback can load. The
  tsdown bundle itself moved from `bin/refs.mjs` to `dist/refs.mjs`, and remains gitignored build
  output produced by `pnpm build`.

## [0.1.3] - 2026-07-05

### Added

- Plugin manifests for the Codex app/CLI (`.codex-plugin/plugin.json`) and Claude Code's
  plugin marketplace (`.claude-plugin/plugin.json` + `marketplace.json`), plus a
  `.agents/plugins/marketplace.json` mirror for Codex's own marketplace. A
  `.agents/skills/refs` symlink to `skills/refs/` gives Codex repo-local
  auto-discovery of the skill when run inside this checkout.

### Changed

- `packages/cli/bin/refs.mjs` (the built CLI bundle) is no longer committed to the repo — it's
  build output, regenerated by `pnpm build` and gitignored. CI now proves the build is
  deterministic (two consecutive builds byte-for-byte identical) instead of diffing a committed
  copy, and the release pipeline passes the bundle built and guarded by the unprivileged `verify`
  job to the minimal `publish` job as a workflow artifact, so `publish` still never installs
  dependencies or runs a build while it holds the npm OIDC token.
- Updated the bundled `smol-toml` TOML parser/serializer from 1.6.1 to 1.7.0 (faster
  single-pass string decoding; integers beyond the safe range now serialize as floats;
  no breaking changes).
- `refs add <source> --description <text>` no longer reuses `<text>` as a fallback
  description for detected packages that lack one. `<text>` is now only ever the
  top-level ref description; if one or more detected packages have no manifest
  description (including a single-package repo whose lone package has none, and a
  package whose manifest carries an empty `"description": ""` — the `npm init -y`
  scaffold), the one-shot fails (exit 3) naming every affected package and pointing at
  the two-phase `--dry-run`/`--proposal` flow instead. Consequently, an `npm:<pkg>`
  source without detected workspace packages can effectively never use the one-shot —
  its single seeded package entry never carries a description — and always needs the
  two-phase flow.

- Replaced the `execa` dependency with a small hand-rolled `node:child_process`-based
  process runner. `git`/`ssh` invocations, timeouts, and error handling work as
  before, with two minor observable differences: a command that fails to spawn at
  all (e.g. `git` missing from `PATH`) now reports exit code 127 instead of 1, and
  its OS error message (e.g. `spawn git ENOENT`) now lands on stderr — improving
  `refs doctor`'s failure detail for a missing `git` binary. The published CLI
  bundle is smaller as a result (`bin/refs.mjs`: 305,188 → 196,249 bytes raw,
  89,740 → 55,864 bytes gzipped).

### Fixed

- `refs add --proposal` validation errors now name the offending key(s) for a
  stray/unrecognized field in the proposal — top-level (e.g.
  `unrecognized key(s) in proposal: "okay"`) and nested inside a package entry (e.g.
  `unrecognized key(s) in proposal at packages.<name>: "bogus"`) — instead of a bare,
  contextless `Invalid input`. Named-field validation errors (missing or wrong-typed
  fields, including nested package fields like `packages.<name>.description`) are
  unchanged.

## [0.1.2] - 2026-07-05

### Added

- `refs add` now emits progress lines on stderr while it works (`refs: resolving npm
package '…'…`, `refs: cloning …`, `refs: detecting workspace packages…`) in both
  human and `--json` mode, so long clones no longer look like a hang. stdout is
  unaffected and stays exactly the parseable envelope in `--json` mode.

### Fixed

- `refs add --proposal` now accepts the full `--json` envelope that
  `refs add … --dry-run --json` prints, so the documented pipe workflow
  (`refs add npm:x --dry-run --json > f.json` → edit → `refs add --proposal f.json`)
  works without hand-stripping the `data` wrapper. Bare proposal documents keep
  working unchanged.
- A proposal file containing a failed (`ok: false`) or malformed (no usable `data`
  object) envelope now fails with a clear message instead of a field-by-field
  validation dump.

## [0.1.1] - 2026-07-05

No user-facing changes. First tag-driven release, validating the OIDC
trusted-publishing pipeline end to end.

## [0.1.0] - 2026-07-05

### Added

- Initial release of the `refs` CLI: manage local, read-only checkouts of reference
  repositories ("refs") for agents and humans — `init`, `add` (two-phase
  proposal/finalize or one-shot `--description`), `list`, `show`, `resolve`, `sync`,
  `edit`, `remove`, `migrate`, and `doctor`.
- npm-source resolution (`refs add npm:<package>`), workspace package detection
  (npm/yarn/pnpm monorepos), tag-format detection, blobless clones with full-clone
  fallback, and a configurable git transport (`https`/`ssh`).
- Machine-readable `--json` output with a stable `{ok, data, warnings}` /
  `{ok, error}` envelope on every command, plus stable exit codes.
- Containment-guarded destructive operations, credential redaction in every
  URL-carrying message, and read-only enforcement of managed checkouts via
  installed git hooks.
- Agent skill (`skills/refs/`) documenting the investigate/add/maintain workflows.

[Unreleased]: https://github.com/kaisers-io/refs/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/kaisers-io/refs/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/kaisers-io/refs/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/kaisers-io/refs/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/kaisers-io/refs/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/kaisers-io/refs/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/kaisers-io/refs/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/kaisers-io/refs/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kaisers-io/refs/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kaisers-io/refs/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kaisers-io/refs/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/kaisers-io/refs/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kaisers-io/refs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kaisers-io/refs/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kaisers-io/refs/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kaisers-io/refs/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/kaisers-io/refs/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kaisers-io/refs/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kaisers-io/refs/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kaisers-io/refs/releases/tag/v0.1.0
