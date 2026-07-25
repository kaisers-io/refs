# Pilot corpus — refs source-access vs. no-source-access benchmark

**Status:** pilot (recipe-validation), not the confirmatory corpus. Design: GitHub issue
[#16](https://github.com/kaisers-io/refs/issues/16). This file proves out the diff-driven item-authoring
recipe against **real** zod source, so we can judge item quality before scaling to the full corpus
(≈54–72 items across 3 deps) and running any confirmatory pass.

> **v2 — corrections applied after Codex cross-model review (all re-verified against the checkout).**
> The first draft had real errors that the review caught: **P3's v4.4.2 counter-answer was wrong** (the
> `"X!"` leak was a *transient* state in commit `1cab6938`, not v4.4.2 — v4.4.2 already returned
> `undefined` via optin short-circuiting); **P4 overclaimed** (the cidrv6 regex is pattern-metadata
> only — `// not used for validation` — runtime always used `new URL(...)`); **P2** had wrong line
> refs and a false "internal-only, undocumented" claim (the `fallback` field is documented in the
> in-repo `wiki/optionality.md`). Details in each item's *Review note*. This is itself evidence that the
> recipe needs the source-grounded verification loop — memory-plausible items were specifically wrong.

## Provenance (freeze)

- **Dependency:** `github.com/colinhacks/zod` (package `packages/zod`, the `v4` source tree).
- **Checkout freeze:** `refs sync zod` → HEAD `912f0f51b0ced654d0069741e7160834dca742ee` (2026-06-10). Latest release tag at freeze: `v4.4.3` (tag SHA `1fb56a5c`).
- **Commit-vs-tag note:** commits `1cab6938` and `c2be4f81` are *contained in* the v4.4.3 release but are **not** the tag SHA (`1fb56a5c`). Commits `f29f2a6d` and `dfd8766b` are on `main` **after** v4.4.3 and are **unreleased** at freeze — those items are anchored to the commit SHA vs. its parent, not to a release diff.
- All items were authored by reading the real checkout (`git log`/`git diff`/`git show`/`git grep`) and re-verified after review. Every `path:line` and SHA below was checked at freeze.
- Rubrics (critical facts / fatal contradictions) are frozen here **before** any model sees the questions. No confirmatory model runs have been executed.

## How to read an item

Each item is the full design bundle: anchor (SHA + version), the minimal question (no answer leak),
the **target-version answer**, the **previous-version counter-answer** (contrastive — stale memory /
the prior state is *specifically* wrong, not vague), source locations + an executable-oracle sketch,
the frozen rubric, a **public-exposure audit**, and the **source-necessity gate** check.

> **Independence note (clustering).** Items **P1–P3 share one change-unit** (the v4.4.3 `fallback`-flag
> fix). For statistics they count as **~1 independent observation**, not three. **P4** (cidrv6 pattern)
> is independent. **P5–P6 share one change-unit** (the iso circular-import refactor) → ~1 observation.
> So this pilot spans **3 independent change-units**. For the confirmatory corpus: one primary scored
> item per change-unit, or total weight 1 per cluster — otherwise prompt count masquerades as sample size.

---

## P1 — behavior / edge-case · change-unit CU1 (v4.4.3 `fallback` fix)

- **Anchor:** target release `v4.4.3` (change commit `1cab6938`, "restore catch handling for absent object keys" #5937/#5939) vs. previous release `v4.4.2`.
- **Question:** In zod 4.4.3, what does `z.object({ fruit: z.enum(["apple","orange"]).catch("apple") }).parse({})` return, and why does the absent `fruit` key no longer cause a failure?
- **Target answer:** `{ fruit: "apple" }`. An **absent** object key now flows through to the `.catch()` handler, so the catch fallback (`"apple"`) is substituted and parsing succeeds.
- **Previous-version counter-answer (v4.4.2):** parsing **fails** — `safeParse({}).success === false`. In 4.4.2 an absent key did not reach the catch handler.
- **Source:** `packages/zod/src/v4/classic/tests/catch.test.ts:142` (assertion flipped from `.success === false` to `.parse({}) === { fruit: "apple" }`); mechanism in `core/schemas.ts` (see P2). Verified against the `v4.4.2..1cab6938` diff.
- **Oracle:** `z.object({ fruit: z.enum(["apple","orange"]).catch("apple") }).parse({})` deep-equals `{ fruit: "apple" }`.
- **Critical facts:** (1) returns `{ fruit: "apple" }` / succeeds; (2) reason = the absent key now reaches the catch handler (this fact is now explicitly asked). **Fatal contradiction:** claiming it throws / `success:false` / returns `{}`.
- **Public-exposure audit:** **medium.** Not in README/API docs; the *fixed* behavior is also the *intuitive* behavior, so a source-less model can plausibly guess the target from ordinary `.catch()` semantics even though 4.4.2-era source knowledge is wrong. Passes the necessity gate only weakly.
- **Review note:** target confirmed at `catch.test.ts:142`; exposure downgraded low→medium; question reworded so critical fact 2 (the "why") is explicitly requested.

## P2 — mechanism (internal) · change-unit CU1

- **Anchor:** target release `v4.4.3` (change commit `c2be4f81`) vs. previous release `v4.4.2`.
- **Question:** In zod 4.4.3's v4 core, what field was added to the internal `ParsePayload` interface to let an outer `.optional()` discard a `.catch()`/`.transform()` result when the input was `undefined`; which internals set or propagate it; and how does `handleOptionalResult` use it?
- **Target answer:** A new field **`fallback?: boolean | undefined`** on `ParsePayload` (`core/schemas.ts:43`). It is set by `$ZodCatch` when its catch value substitutes and by every **successful forward** `$ZodTransform` invocation, and threaded across pipe boundaries by `handlePipeResult`. `handleOptionalResult` changed from `if (result.issues.length && input === undefined)` to **`if (input === undefined && (result.issues.length || result.fallback))`** (`core/schemas.ts:3478-3479`) — so on `undefined` input an optional clobbers not just *error* results but also *fallback* results, yielding `undefined`.
- **Previous-version counter-answer (v4.4.2):** no `fallback` field existed; `handleOptionalResult` only short-circuited on `result.issues.length && input === undefined`.
- **Source:** `core/schemas.ts:43` (field), `:3478-3479` (`handleOptionalResult`), `:3436` + `:3446` (`$ZodTransform` sets it, forward path), `:3921` + `:3939` (`$ZodCatch` sets it), `:4044` (`handlePipeResult` threads `fallback: left.fallback`).
- **Oracle:** n/a (internal); verified by reading the frozen source.
- **Critical facts (atomic):** (1) field name is `fallback` (boolean) on `ParsePayload`; (2) it is set by `$ZodCatch` and by successful forward `$ZodTransform`; (3) `handleOptionalResult` also short-circuits on `result.fallback` when input is `undefined`. **Fatal contradiction:** naming a differently-named *public* option/flag, or asserting the mechanism is public API.
- **Public-exposure audit:** the field is **not** in published docs, the npm artifact, or the type surface — but it **is** documented inside the repo at `wiki/optionality.md:15` (an unpublished in-repo internal wiki that also spells out the exact mechanism at `:132-188`). So it is answerable in **B** (checkout includes the wiki) and **not** in **A0/A1** (no repo). Passes the necessity gate vs. training memory; strong B-vs-A separation.
- **Review note:** chronology corrected (`1cab6938` first introduced this as `caught`; `c2be4f81` renamed it to `fallback`, generalized it to transforms, and added pipe propagation); assignment line refs corrected to 3436/3446 (transform) and 3921/3939 (catch); "every transform invocation" narrowed to "successful forward"; the false "no docs" claim replaced with the in-repo wiki citation.

## P3 — cross-module (pipe propagation) · change-unit CU1 · **commit-anchored (transient state)**

- **Anchor:** target commit **`c2be4f81`** ("generalize optin/fallback to transform" #5941) vs. its parent **`1cab6938`** — a *within-release* commit pair, **not** a v4.4.2→v4.4.3 diff (see review note). Both are contained in v4.4.3.
- **Question:** Given `const s = z.string().catch("X").transform((v) => v + "!").optional();`, what does `s.parse(undefined)` return at commit `c2be4f81`, and what did it return at its parent `1cab6938`?
- **Target answer (`c2be4f81`):** `undefined`. The outer `.optional()` clobbers the catch+transform fallback chain because the `fallback` flag is now threaded across the pipe boundary that `.transform()` introduces. (Also: `s.parse("hi") === "hi!"`, `s.parse(123) === "X!"`.)
- **Previous counter-answer (`1cab6938`):** `"X!"`. After catch was made input-optional but before pipe propagation was added, the flag was lost at the implicit pipe boundary, so the catch+transform value leaked through the optional on `undefined` input.
- **Source:** `packages/zod/src/v4/classic/tests/catch.test.ts:281-326` ("optional clobbers catch through pipe boundaries"); mechanism `core/schemas.ts:4044` (`handlePipeResult` threads `fallback`). The in-repo `wiki/optionality.md:179` names #5941 as the propagation fix.
- **Oracle:** at `c2be4f81`, the three `.parse()` calls equal `undefined`, `"hi!"`, `"X!"`.
- **Critical facts:** (1) at `c2be4f81`, `undefined → undefined`; (2) at `1cab6938`, `undefined → "X!"`; (3) the difference is `fallback` propagation across the pipe boundary. **Fatal contradiction:** claiming v4.4.2 (the release) produced `"X!"` — it did not.
- **Public-exposure audit:** **very strong necessity** — this is a *transient intra-release* behavior that exists in no published version; only the checkout's commit history establishes it. Answerable only in B.
- **Review note (the important correction):** the first draft framed this as v4.4.2→v4.4.3 with v4.4.2 producing `"X!"`. **That was wrong.** In v4.4.2, `$ZodCatch.optin` deferred to the inner string (`core/schemas.ts:3889` at v4.4.2), so a non-optional pipe let the outer optional short-circuit on `undefined` → `undefined`. The `"X!"` leak only appears at the intermediate commit `1cab6938`. Re-anchored to the commit pair; kept because a transient-state question is maximally source-requiring (and documents the recipe's own verification catch). Cut this if the confirmatory corpus restricts to release-diff anchors.

## P4 — behavior / JSON-Schema metadata · change-unit CU2 (independent) · **flagged pilot diagnostic**

- **Anchor:** target commit **`f29f2a6d`** ("cidrv6 JSON schema pattern matches runtime" #5945, `main`, post-`v4.4.3`, unreleased at freeze) vs. parent `f29f2a6d^`.
- **Question:** At zod main (post-4.4.3), the emitted JSON-Schema `pattern` for a cidr-v6 string (`z.toJSONSchema(...).pattern`) was changed. For the input `"2001:db8:1::/48"`, what did the **pattern** accept before vs. after `f29f2a6d`, and did the **runtime** validator's accept/reject decision for that input change?
- **Target answer:** The **new pattern accepts** `"2001:db8:1::/48"` (the old pattern **rejected** it). The **runtime** decision did **not** change — the runtime validator uses `new URL(...)`, not this regex, and accepted `"2001:db8:1::/48"` both before and after. The commit brought the JSON-Schema pattern into *parity* with the (unchanged) runtime for the tested compressed examples.
- **Previous-version counter-answer (`f29f2a6d^`):** the old `cidrv6` pattern rejected many compressed forms (e.g. `"2001:db8:1::/48"`, `"2001:db8::/32"`), so `z.toJSONSchema(...).pattern` diverged from the runtime.
- **Source:** `core/regexes.ts:75` (the rewritten `cidrv6` regex) and `core/schemas.ts:885` (`def.pattern ??= regexes.cidrv6; // not used for validation` — proves the regex is JSON-Schema metadata, not the runtime path; runtime uses `new URL(...)` at `core/schemas.ts:898`); new assertions in `packages/zod/src/v4/classic/tests/string.test.ts` (added in `f29f2a6d`).
- **Oracle:** with `const s = z.cidrv6();` (or the deprecated `z.string().cidrv6()`): `new RegExp(z.toJSONSchema(s).pattern!).test("2001:db8:1::/48")` is `false` at `f29f2a6d^` and `true` at `f29f2a6d`, while `s.safeParse("2001:db8:1::/48").success === true` at both.
- **Critical facts:** (1) the *pattern* newly accepts `"2001:db8:1::/48"` (old pattern rejected it); (2) the *runtime* decision for that input is unchanged (runtime uses `new URL`, not the regex). **Fatal contradiction:** claiming the commit newly enabled *runtime* acceptance, or claiming general pattern↔runtime equivalence over all inputs (the tests prove parity only for a finite set of positive examples).
- **Public-exposure audit / contamination:** **medium-high.** "Valid compressed IPv6 CIDRs should validate" is an easy normative guess; the *pattern-vs-runtime* distinction is not. Keep in the pilot as a deliberate weak-item diagnostic; **replace for confirmatory scoring** with a less-guessable internal or counterintuitive change.
- **Review note:** first draft claimed the regex was "rewritten to make the runtime accept compressed forms" and invoked "RFC-5952" — both wrong (runtime never used the regex; the tests include non-canonical spellings like leading-zero groups). Reframed to the accurate pattern-metadata/parity story; contrastive example `"2001:db8:1::/48"` used in both halves (`"fe80::/10"`/`"::/0"` don't distinguish the versions); oracle corrected.

## P5 — mechanism / architecture · change-unit CU3 (independent)

- **Anchor:** target commit **`dfd8766b`** ("break circular import between classic schemas and iso" #5275/#5926, `main`, post-`v4.4.3`) vs. parent `dfd8766b^`.
- **Question:** At zod main (post-4.4.3), where are the `ZodISODateTime`/`ZodISODate`/`ZodISOTime`/`ZodISODuration` **class definitions** located in the v4 classic source, what role does `classic/iso.ts` now play, and is the public API (`z.iso.datetime()`, top-level `ZodISODateTime`, `z.string().datetime()`) changed?
- **Target answer:** The class definitions now live in **`packages/zod/src/v4/classic/schemas.ts`** (from `:594`), next to their `ZodStringFormat` base. **`classic/iso.ts` is now a thin facade** that re-exports those classes from `./schemas.js` and exposes the `z.iso.{datetime,date,time,duration}` builder functions (each calling the underlying `core._iso*` builder). The **public API is unchanged** — `z.iso.datetime()`, `z.iso.ZodISODateTime`, top-level `ZodISODateTime`, and `z.string().datetime()` all behave as before.
- **Previous-version counter-answer (`dfd8766b^`):** the classes lived in `iso.ts`, and `classic/schemas.ts` imported `./iso.js` while `iso.ts` imported back from `./schemas.js` — a two-way circular import.
- **Source:** `classic/iso.ts:2,4` (now `import`/`export … from "./schemas.js"`) and `:6-7` (facade builders); relocated defs at `classic/schemas.ts:594`. (`dfd8766b` also added two regression tests — a static import-graph DFS and a Rollup treeshake test — but they were later **removed** at HEAD by `e75ca0fc` in favor of a `madge check:circular` guard; don't cite those test files at the frozen HEAD.)
- **Oracle:** static — `iso.ts` contains no `class ZodISO…`/`export const ZodISO…` definitions (only re-exports; verified at HEAD, 0 defs); `schemas.ts` contains them (`:594`).
- **Critical facts:** (1) class defs are in `classic/schemas.ts`; (2) `iso.ts` is now a re-export/facade; (3) each of the named public surfaces (`z.iso.datetime()`, top-level `ZodISODateTime`, `z.string().datetime()`) is unchanged. **Fatal contradiction:** asserting any named public surface changed, or that the classes still live in `iso.ts`.
- **Public-exposure audit:** internal module structure — not in any published doc. Passes the necessity gate.
- **Review note:** structural facts confirmed at HEAD (`iso.ts` facade, defs at `:594`). A second-pass check caught that the regression-test files named in `dfd8766b`'s body were **removed by a later HEAD commit (`e75ca0fc`)** — the stale citation was corrected to the durable structural facts, which is why P5/P6 are anchored to commit `dfd8766b`, not "main".

## P6 — history / rationale · change-unit CU3 (independent)

- **Anchor:** target commit **`dfd8766b`** and its recorded rationale.
- **Question:** At zod main, *why* was `classic/iso.ts` refactored into a thin facade with the ISO class definitions moved into `classic/schemas.ts` — what concrete problem did the commit state it solved, and what tooling did it name as surfacing that problem?
- **Target answer:** To **break a two-way circular import** between `classic/schemas.ts` and `classic/iso.ts` (`schemas.ts` imported `./iso.js` to forward the deprecated `ZodString.{datetime,date,time,duration}` proxies; `iso.ts` imported back from `./schemas.js` to extend `ZodStringFormat`). **Rollup** reported it as a `CIRCULAR_DEPENDENCY` warning. The refactor removes the cycle both directions with the public API deliberately unchanged; two regression tests were added (a static import-graph DFS and a Rollup treeshake test).
- **Previous-version counter-answer:** a source-less model tends to offer a generic motive ("cleanup", "bundle size") rather than the specific Rollup circular-dependency between `schemas.ts` ↔ `iso.ts`.
- **Source:** commit message body of `dfd8766b` (records the rationale explicitly — the `schemas.ts ↔ iso.ts` cycle, the Rollup `CIRCULAR_DEPENDENCY` warning, and the deliberately-unchanged public API — which is why "why" is answerable from source rather than speculation). The regression tests the body describes were later removed at HEAD (`e75ca0fc`), so the durable ground truth here is the commit body itself.
- **Oracle:** n/a (history) — grounded in the commit body.
- **Critical facts:** (1) purpose = break the `classic/schemas.ts` ↔ `classic/iso.ts` circular import; (2) the named tooling is Rollup (`CIRCULAR_DEPENDENCY`). **Fatal contradiction:** attributing the change to a motive that *replaces or denies* the recorded circular-import rationale (e.g. "purely a performance optimization"). A clearly-labeled secondary hypothesis is not fatal.
- **Public-exposure audit:** rationale exists only in the commit history, not in published docs. Passes the necessity gate (history question is fair here because the commit explicitly records intent).
- **Review note:** contamination raised very-low→medium ("break a circular dependency" is somewhat inferable; Rollup is a plausible guess — exact confirmation still needs the commit body); public-API-unchanged demoted from a critical fact to context (it wasn't asked); fatal contradiction narrowed to *denial* of the recorded rationale.

---

## Negative controls (authored, per design)

### NC1 — source should *not* help (expect A1 ≈ B)

- **Anchor:** zod `v4.4.3`.
- **Question:** On invalid input, how do zod's `.parse()` and `.safeParse()` differ?
- **Target:** `.parse()` throws a `ZodError`; `.safeParse()` does not throw and returns `{ success: false, error: ZodError }` (on success, `{ success: true, data }`).
- **Critical facts:** (1) `.parse()` throws vs. `.safeParse()` returns; (2) the `success` discriminant + `error`. **Fatal contradiction:** claiming `.safeParse()` throws or returns `success:true` on invalid input.
- **Purpose:** prominently documented, stable common API — if **B beats A0/A1 here**, something is leaking (a validity check on the whole design).

### NC2 — genuinely unanswerable (does source *reduce* unsupported claims?)

- **Anchor:** commit `f29f2a6d`.
- **Question:** What maintainer-stated reason explains why `f29f2a6d` duplicated the IPv6 alternatives into `cidrv6` rather than building the CIDR pattern programmatically from `ipv6.source`?
- **Target:** **No such reason is recorded.** The commit establishes the parity goal and the implementation, but not why duplication was chosen over composition. The correct answer states the rationale is not established and distinguishes observed implementation from inference.
- **Critical facts:** (1) explicitly says the rationale is not recorded; (2) separates observed implementation from speculation. **Fatal contradiction:** confidently attributing the choice to performance, regex-engine compatibility, JSON-Schema limits, or maintainer preference *as a recorded fact*. Clearly-labeled speculation is acceptable.
- **Purpose:** measures whether source access makes a model *more* honest about the limits of what the source establishes (a qualitative win for refs even where correctness deltas are small).

## Confirmatory hardening (post-pilot)

Work done to de-risk the corpus before any model-run budget is spent.

### P7 — behavior / security · change-unit CU4 (independent) · **confirmatory-grade replacement for P4**

Replaces P4's slot for confirmatory scoring (P4 stays only as a flagged pilot diagnostic). Counterintuitive + low-contamination — a source-less model's intuitive guess is *specifically* wrong.

- **Anchor:** target release **`v4.4.0`** (change commit `76e8f706`, "skip `__proto__` key in object catchall" #5898) vs. previous release **`v4.3.6`**.
- **Question:** In zod 4.4.0, given `const s = z.looseObject({ name: z.string() });` and `const r = s.parse(JSON.parse('{"__proto__":{"isAdmin":true},"name":"alice"}'));`, what are `Object.keys(r)` and `Object.getPrototypeOf(r)`?
- **Target answer (v4.4.0+):** `Object.keys(r)` is `["name"]` — the `__proto__` key is **skipped**, not carried through the catchall — and `Object.getPrototypeOf(r) === Object.prototype` (`r.isAdmin` is `undefined`). `handleCatchall` skips `__proto__` so it can't replace the parsed result's prototype via the assignment setter. Same for `.passthrough()` and `.catchall(z.unknown())`.
- **Previous-version counter-answer (v4.3.6):** `handleCatchall` had **no** `__proto__` guard, so the `__proto__` key reached the catchall assignment and — via the `__proto__` setter on the plain object being built — **replaced the parsed result's prototype**; `Object.getPrototypeOf(r)` was the injected `{isAdmin:true}` object, not `Object.prototype`. (No *global* `Object.prototype` pollution — the result's own prototype was clobbered.)
- **Source:** `core/schemas.ts:1873` (the `if (key === "__proto__") continue;` guard added inside `handleCatchall`, which begins at `:1856`; async path guard at `:2957`). Verified **absent** from `handleCatchall` at v4.3.6 (its only `__proto__` guard was at `:2801`, the regular non-catchall object path). Observable behavior asserted at `classic/tests/object.test.ts:677` ("__proto__ in object catchall paths").
- **Oracle:** `Object.keys(r)` deep-equals `["name"]`; `Object.getPrototypeOf(r) === Object.prototype`; across `looseObject`/`passthrough`/`catchall(z.unknown())`.
- **Critical facts:** (1) `Object.keys(r)` excludes `__proto__` (= `["name"]`); (2) `Object.getPrototypeOf(r) === Object.prototype` (prototype not replaced). **Fatal contradiction:** claiming `__proto__` appears as a normal data key on `r`, or that global `Object.prototype` was polluted.
- **Public-exposure audit:** security fix; not in general docs. Counterintuitive — memory expects catchall/passthrough to preserve *all* input keys. **Low contamination, strong necessity.**

### kysely eligibility audit — **eligible** (provisional third dep confirmed)

Added `github.com/kysely-org/kysely` (single package, `tag_format v{version}`) and scanned `v0.29.0..v0.29.4` (May–Jul 2026). It yields real, contrastive, version-specific source-only items across job types — e.g.:

- **`1ca8834` (#1946):** SQLite DELETE compiled the `RETURNING` clause in the **wrong position** (after `ORDER BY`/`LIMIT`) — fixed in `query-compiler/default-query-compiler.ts` to emit it before. A crisp SQL-generation behavior contrast (before/after produce different SQL strings).
- **`6e1bc5c` (#1919):** PG/MSSQL migrations not running **exclusively** under `disableTransactions: true` — concurrency/behavioral semantics.
- **`00400f8` (#1851):** `$narrowType` mishandling **branded** types — type-level/internal.

Verdict: keep kysely as the medium-popularity churn slot (lower contamination than zod). Author 3–4 items from independent change-units when building the confirmatory corpus.

### Negative controls — status

NC1 (parse vs. safeParse) and NC2 (unrecorded cidrv6-duplication rationale) are authored above with frozen rubrics and are directly runnable; no further work needed before the harness exists.

## Corpus deps (decided with the review)

- **zod** — worked example (this file).
- **`payloadcms/payload`** — large monorepo / cross-package wiring slot. Keep (release history confirms frequent cross-package changes).
- **`kysely-org/kysely`** — medium-popularity, rapid-churn slot (~14k stars; releases 0.29.0–0.29.4 May–Jul 2026). **Eligibility audited → confirmed** (see Confirmatory hardening): yields contrastive source-only items across job types at lower contamination than zod.
- **`vercel/next.js`** — **not** the churn slot (≈141k stars, exceptionally training-exposed). Keep only as a separate *high-contamination stress stratum*, reported apart from the main estimate.

## Rubric conventions (frozen)

- Every critical fact must answer something the question explicitly asks.
- Facts are atomic (no "X and Y" in one scoring unit).
- Fatal contradictions are reserved for explicit incompatible claims, never mere omissions.
- Current-version questions don't score unsolicited historical claims (and vice-versa).
- For finite test sets, score only the listed examples; never turn sampled parity into universal equivalence.
- State accepted semantic equivalents (e.g. `undefined` ≡ "no value" ≡ "the outer optional wins").
- If an answer contains both a correct claim and a fatal contradiction, the contradiction overrides credit.
- Graders score an **`answer`-only** field (agents return `answer` and `evidence` separately); `evidence` is verified in a separate pass and never shown to the correctness judge.

*Co-authored with Codex (headless cross-model review): Claude authored the items against real source; Codex adversarially audited them against the checkout and caught the P3 counterfactual error, the P4 overclaim, and the P2 chronology/exposure/line-ref errors, and proposed the dep set + negative controls. All corrections re-verified against the frozen checkout before landing.*
