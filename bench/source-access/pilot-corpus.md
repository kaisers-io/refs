# Pilot corpus — refs source-access vs. no-source-access benchmark

**Status:** pilot (recipe-validation), not the confirmatory corpus. Design: GitHub issue
[#16](https://github.com/kaisers-io/refs/issues/16). This file proves out the diff-driven item-authoring
recipe against **real** zod source, so we can judge item quality before scaling to the full corpus
(≈54–72 items across 3 deps) and running any confirmatory pass.

## Provenance (freeze)

- **Dependency:** `github.com/colinhacks/zod` (package `packages/zod`, the `v4` source tree).
- **Checkout freeze:** `refs sync zod` → HEAD `912f0f51` (2026-06-10). Latest release tag at freeze: `v4.4.3`.
- All items were authored by reading the real checkout (`git log`/`git diff`/`git show`/`git grep`),
  not from memory. Every `path:line` and SHA below was verified at freeze.
- Items were **written against source only**; no confirmatory model runs have been executed. Rubrics
  (critical facts / fatal contradictions) are frozen here **before** any model sees the questions.

## How to read an item

Each item is the full bundle from the design: anchor (SHA + version), the minimal question (no answer
leak), the **target-version answer**, the **previous-version counter-answer** (what stale memory /
the prior release would say — items are *contrastive*, so memory is *specifically* wrong, not vague),
source locations + an executable-oracle sketch, the frozen rubric, a **public-exposure audit**, and the
**source-necessity gate** check.

> **Independence note (Codex's clustering caveat).** Items **P1–P3 share one change-unit** (the v4.4.3
> `fallback`-flag fix, `c2be4f81`/`1cab6938`). For statistical purposes they count as **~1 independent
> observation**, not three — they probe different facets (behavior / internal mechanism / cross-module
> propagation) but a model that "gets" the fix may get all three. **P4** (cidrv6 regex) and **P5–P6**
> (iso circular-import refactor) are **independent** change-units. So this pilot spans **3 independent
> change-units**, which is why the full corpus needs many more.

---

## P1 — behavior / edge-case · change-unit CU1 (v4.4.3 `fallback` fix)

- **Anchor:** target `v4.4.3` (commit `1cab6938`, "restore catch handling for absent object keys" #5937/#5939) vs. previous `v4.4.2`.
- **Question:** In zod 4.4.3, what does `z.object({ fruit: z.enum(["apple","orange"]).catch("apple") }).parse({})` return?
- **Target answer:** `{ fruit: "apple" }`. An **absent** object key flows through to the `.catch()` handler, so the catch fallback (`"apple"`) is substituted and parsing succeeds.
- **Previous-version counter-answer (v4.4.2):** parsing **fails** — `safeParse({}).success === false`. In 4.4.2 an absent key did not reach the catch handler.
- **Source:** `packages/zod/src/v4/classic/tests/catch.test.ts:131-146` (the exact assertions flipped from `.success === false` to `.parse({}) === { fruit: "apple" }`); mechanism in `packages/zod/src/v4/core/schemas.ts` (see P2).
- **Oracle:** `z.object({ fruit: z.enum(["apple","orange"]).catch("apple") }).parse({})` deep-equals `{ fruit: "apple" }`.
- **Critical facts:** (1) returns `{ fruit: "apple" }` / succeeds; (2) reason = absent key now reaches the catch handler. **Fatal contradiction:** claiming it throws / `success:false` / returns `{}`.
- **Public-exposure audit:** not in README or API docs; discoverable only via the changelog line or the test/source. Changelog names it but not the exact object-shape result. **Passes** necessity gate.
- **Contamination flag:** low — this is a 4.4.x-specific regression fix; 4.4.2-era memory answers it *wrong* (which is the point).

## P2 — mechanism (internal) · change-unit CU1

- **Anchor:** target `v4.4.3` (commit `c2be4f81`) vs. previous `v4.4.2`.
- **Question:** In zod 4.4.3's v4 core, what new field was added to the internal `ParsePayload` interface to make an outer `.optional()` correctly discard a `.catch()`/`.transform()` result when the input was `undefined`, and how does `handleOptionalResult` use it?
- **Target answer:** A new internal field **`fallback?: boolean | undefined`** on `ParsePayload` (`core/schemas.ts:43`). `$ZodCatch` sets `payload.fallback = true` when its catch value substitutes, and every `$ZodTransform` invocation sets it too. `handleOptionalResult` changed from `if (result.issues.length && input === undefined)` to **`if (input === undefined && (result.issues.length || result.fallback))`** (`core/schemas.ts:3478-3479`) — so on `undefined` input, an optional now clobbers not just *error* results but also *fallback* results, yielding `undefined`.
- **Previous-version counter-answer (v4.4.2):** no `fallback` field existed; `handleOptionalResult` only short-circuited on `result.issues.length && input === undefined`, so a catch/transform substitution on `undefined` input was **not** discarded by the outer optional.
- **Source:** `packages/zod/src/v4/core/schemas.ts:43` (field), `:3478-3479` (`handleOptionalResult`), `:3898` + `:3918-3919` (`$ZodCatch` sets it), `:3425` + `:3436-3444` (`$ZodTransform` sets it).
- **Oracle:** n/a (internal); verified by reading the frozen source.
- **Critical facts:** (1) field name `fallback` (boolean) on `ParsePayload`; (2) set by `$ZodCatch` and `$ZodTransform`; (3) `handleOptionalResult` now also short-circuits on `result.fallback` when input is `undefined`. **Fatal contradiction:** inventing a differently-named public option/flag, or claiming the mechanism is a public API.
- **Public-exposure audit:** **internal-only** (`@internal` JSDoc); appears in no docs, no types surface, no changelog. **Strongly passes** necessity gate — unanswerable without the source.
- **Contamination flag:** very low — internal mechanism introduced in a patch release.

## P3 — cross-module (pipe/optional propagation) · change-unit CU1

- **Anchor:** target `v4.4.3` (commit `c2be4f81`) vs. previous `v4.4.2`.
- **Question:** In zod 4.4.3, given `const s = z.string().catch("X").transform((v) => v + "!").optional();`, what do `s.parse(undefined)`, `s.parse("hi")`, and `s.parse(123)` each return?
- **Target answer:** `s.parse(undefined) === undefined`; `s.parse("hi") === "hi!"`; `s.parse(123) === "X!"`. On `undefined` the outer `.optional()` clobbers the catch+transform fallback chain (via the `fallback` flag threaded across the pipe boundary); on a valid string the transform runs; on an invalid non-undefined value the catch substitutes `"X"` then the transform appends `"!"`.
- **Previous-version counter-answer (v4.4.2):** `s.parse(undefined)` would **not** reliably return `undefined` (the catch/transform fallback leaked through the optional, so `undefined` input yielded a transformed catch value like `"X!"` rather than `undefined`).
- **Source:** `packages/zod/src/v4/classic/tests/catch.test.ts:280-326` ("optional clobbers catch through pipe boundaries"); mechanism `packages/zod/src/v4/core/schemas.ts:4044` (`handlePipeResult` threads `fallback: left.fallback` across the pipe).
- **Oracle:** the three `.parse()` calls above equal `undefined`, `"hi!"`, `"X!"` respectively.
- **Critical facts:** (1) `undefined → undefined`; (2) `"hi" → "hi!"`; (3) `123 → "X!"`. **Fatal contradiction:** claiming `undefined → "X!"` (the pre-fix behavior) or that it throws.
- **Public-exposure audit:** not documented; behavior is subtle enough that memory of zod's general optional/catch semantics gets the `undefined` case wrong. **Passes** necessity gate.
- **Contamination flag:** low.

## P4 — behavior / edge-case (regex) · change-unit CU2 (independent)

- **Anchor:** target commit **`f29f2a6d`** ("cidrv6 JSON schema pattern matches runtime" #5945, main, post-`v4.4.3`, unreleased at freeze) vs. its parent `f29f2a6d^`.
- **Question:** At zod main (post-4.4.3), does the v4 `cidrv6` validator accept the compressed CIDR string `"2001:db8:1::/48"`, and does the JSON-Schema `pattern` emitted by `z.toJSONSchema()` for a cidr-v6 string match the runtime validator on inputs like `"fe80::/10"` and `"::/0"`?
- **Target answer:** **Yes to both.** The `cidrv6` regex was rewritten to accept RFC-5952 compressed forms (`"2001:db8:1::/48"`, `"2001:db8:85a3::8a2e:370:7334/64"`, etc.), and the emitted JSON-Schema `pattern` now matches the runtime regex on compressed inputs (`"2001:db8::/32"`, `"fe80::/10"`, `"::/0"`).
- **Previous-version counter-answer (`f29f2a6d^`):** the old `cidrv6` regex only accepted a narrow set of forms (`(…:){7}…`, `::`, or `(…)?::(…:?){0,6}`) and **rejected** many valid compressed CIDRs like `"2001:db8:1::/48"`; the JSON-Schema pattern diverged from runtime.
- **Source:** `packages/zod/src/v4/core/regexes.ts:75` (the rewritten `cidrv6` regex); new assertions `packages/zod/src/v4/classic/tests/string.test.ts` (added in `f29f2a6d`: `safeParse("2001:db8:1::/48").success === true`, plus the `toJSONSchema(...).pattern` round-trip loop).
- **Oracle:** `z.string().check(z.cidrv6?)` / the exported `cidrv6` regex `.test("2001:db8:1::/48") === true`; and `new RegExp(z.toJSONSchema(cidrV6).pattern).test("::/0") === true`.
- **Critical facts:** (1) `"2001:db8:1::/48"` accepted; (2) JSON-Schema pattern matches runtime on compressed inputs. **Fatal contradiction:** claiming compressed forms are rejected, or that pattern↔runtime already agreed before the fix.
- **Public-exposure audit:** the *existence* of cidr validation is documented; the *specific compressed-form behavior and the pattern/runtime parity fix* are not — they require the diff/source. **Passes** necessity gate.
- **Contamination flag:** medium — a model may know zod has cidr validation; it should **not** know this specific unreleased regex rewrite. Watch for lucky guesses on the "yes it validates cidr" surface without the compressed-form specifics.

## P5 — mechanism / architecture · change-unit CU3 (independent)

- **Anchor:** target commit **`dfd8766b`** ("break circular import between classic schemas and iso" #5275/#5926, main, post-`v4.4.3`) vs. parent `dfd8766b^`.
- **Question:** At zod main (post-4.4.3), where are the `ZodISODateTime`/`ZodISODate`/`ZodISOTime`/`ZodISODuration` **class definitions** located in the v4 classic source, and what role does `classic/iso.ts` now play? Is the public API (`z.iso.datetime()`, top-level `ZodISODateTime`, `z.string().datetime()`) changed?
- **Target answer:** The class definitions now live in **`packages/zod/src/v4/classic/schemas.ts`** (next to their `ZodStringFormat` base). **`classic/iso.ts` is now a thin facade** that re-exports those classes from `./schemas.js` and exposes the `z.iso.{datetime,date,time,duration}` builder functions (each calling the underlying `core._iso*` builder directly). The **public API is unchanged** — all of `z.iso.datetime()`, `z.iso.ZodISODateTime`, top-level `ZodISODateTime`, and `z.string().datetime()` behave as before.
- **Previous-version counter-answer (`dfd8766b^`):** the classes lived in `iso.ts`, and `classic/schemas.ts` imported `./iso.js` while `iso.ts` imported back from `./schemas.js` — a **two-way circular import** that Rollup flagged.
- **Source:** `packages/zod/src/v4/classic/iso.ts:2,4` (now `import`/`export … from "./schemas.js"`) and `:6-7` (thin builder facade); the class defs relocated into `classic/schemas.ts`; regression guards `packages/zod/src/v4/classic/tests/no-circular-imports.test.ts` and `packages/treeshake/tests/no-circular-imports.test.ts`.
- **Oracle:** static — `iso.ts` contains no `class ZodISO…` definitions (only re-exports); `schemas.ts` contains them; the no-circular-imports tests pass.
- **Critical facts:** (1) class defs moved to `classic/schemas.ts`; (2) `iso.ts` is now a re-export/facade; (3) public API unchanged. **Fatal contradiction:** claiming the public API changed, or that the classes still live in `iso.ts`.
- **Public-exposure audit:** internal module structure — **not** in any public doc (public API is explicitly unchanged, so docs are silent on the move). **Passes** necessity gate.
- **Contamination flag:** low — internal refactor in an unreleased commit.

## P6 — history / rationale · change-unit CU3 (independent)

- **Anchor:** target commit **`dfd8766b`** vs. its recorded rationale.
- **Question:** At zod main, *why* was `classic/iso.ts` refactored into a thin facade with the ISO class definitions moved into `classic/schemas.ts` — what concrete problem did this solve, and what tooling surfaced it?
- **Target answer:** To **break a two-way circular import** between `classic/schemas.ts` and `classic/iso.ts` (`schemas.ts` imported `./iso.js` to forward the deprecated `ZodString.{datetime,date,time,duration}` proxies, while `iso.ts` imported back from `./schemas.js` to extend `ZodStringFormat`). **Rollup** (and other bundlers) reported the cycle as a `CIRCULAR_DEPENDENCY` warning. The refactor removes the cycle in both directions while keeping the public API identical; two regression tests were added (a fast static import-graph DFS, and a rollup-based treeshake test mirroring the pass that first surfaced it).
- **Previous-version counter-answer:** memory would likely offer a generic/plausible-but-unsupported reason ("cleanup", "tree-shaking size") rather than the specific Rollup circular-dependency between `schemas.ts` and `iso.ts`.
- **Source:** commit message body of `dfd8766b` (records the rationale explicitly — this is why the "why" is answerable from source rather than speculation); regression tests as in P5.
- **Oracle:** n/a (history) — grounded in the commit body.
- **Critical facts:** (1) purpose = break a circular import between `classic/schemas.ts` ↔ `classic/iso.ts`; (2) surfaced by Rollup as a circular-dependency warning; (3) public API deliberately unchanged. **Fatal contradiction:** attributing the change to an unrelated motive with no source support (e.g. "performance", "new feature").
- **Public-exposure audit:** rationale exists **only** in the commit history, not in docs/changelog. **Passes** necessity gate. (This item respects the design caveat: history questions are only fair where the commit/PR explicitly records intent — here it does.)
- **Contamination flag:** very low — requires the actual commit message.

---

## Negative controls (to add before confirmatory runs, per design)

Not yet authored — flagged here so they aren't forgotten:

1. **Source-shouldn't-help control:** a common, well-documented zod question (e.g. "what does `z.string().email()` validate?") where A1/B should score equally — if B beats A0/A1 here, something is leaking.
2. **Genuinely-unanswerable control:** a question the frozen source does **not** establish (e.g. "why did the author choose regex X over a parser?" where no commit records it) — measures whether source access *reduces or increases* unsupported claims.

## Open pilot questions for review

- Are P1–P3 too correlated to keep all three, or is probing the same fix from three angles worth it for the pilot?
- Is P4's medium contamination flag acceptable, or should it be replaced with a lower-popularity dep's regex change?
- Confirm the two additional corpus deps: **`payloadcms/payload`** (large monorepo, cross-package wiring) and a **medium-popularity, rapid-churn** dep — is `next.js` too heavily-trained to be the churn slot, or keep it and add a smaller lib?
