# Code Review: urban-density

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-15
## Mode: Agent Team (message-gated incremental review)

> Eight PRP tasks, eight commits, all APPROVED. Suite **666 → 752** tests,
> `tsc` clean, `build` clean, determinism byte-stable per seed. The defining
> moment was an empirical escalation the proposer raised mid-Task-4: the PRP's
> `era1Parcels: 150` was an unmeasured estimate that *saturates* the compact
> founding core and structurally collapses the era-5 far cohort (the
> less-blighted side of the Moses blight gradient — the game's central
> starting tension). The team lead ruled it down to 80 and reframed density as
> cumulative across eras; the proposer then carried a measure-and-moderate
> discipline through every later era, calibrating three budgets to keep all
> invariants green on all three seeds. Live-passed in **both Chromium and
> WebKit — pixel-identical.**

## PRP Compliance

All 8 PRP tasks implemented; scope held to `src/ui` (renderKey, decoration,
renderer) + `src/worldgen/moses.ts` + the era/ecoseed tests + the
`PURE_UI_ALLOWLIST` append. **Zero engine / ecology / civic / tech / tools
logic changes; no new `BuiltKind`s.** The renderer changes are canvas2d
shells; every decision lives in the pure, headless-tested
`src/ui/decoration.ts`.

| Commit | Task | Verdict |
|---|---|---|
| `6925dee` | 1 render-key wide variant (`-w` for WIDE_ROAD_KINDS=[1,2,3]) | ✅ APPROVED, 1 optional Nit (declined) |
| `6de4af9` | 2 pure `decoration.ts` (wideRoadAt/powerPoleAt/poleWireDirs) + allowlist + exact-set fixture | ✅ APPROVED, 1 informational Nit |
| `3056693` | 3 renderer wide-slab + power-line decoration (zero-branch shell) | ✅ APPROVED, 1 optional Nit (declined) |
| `a089dc3` | 4 denser era-1 via all-lane `fillFrontage` (amended from `a81ce13`) | ✅ APPROVED — 1 Significant (transient, closed at T5) + Minors resolved |
| `cd9d3b3` | 5 era-2 2-row avenues, dense fill, parking fields | ✅ APPROVED — hard gate met (743/0, transient closed) |
| `2d3f088` | 6 era-3 3-row highway slab + aggregated demolition chronicle | ✅ APPROVED — highest-scrutiny; balance equation exact under widening |
| `f876c9f` | 7 era-4/5 density, crater fields, triple-snapshot determinism | ✅ APPROVED — clean, no deviations |
| `38282e9` | 8 ecology corridor-width soil-suppression characterization | ✅ APPROVED — test-only over unchanged `seedEcology` |

## Issues Found

### 1. Era-1 budget 150 saturates the core and collapses the era-5 far cohort
**Category:** Logic (design/empirical) **Severity:** Significant → resolved
The proposer measured (a throwaway diagnostic sweep, not committed) that at
`era1Parcels=150` the realized density hits the grid frontage capacity (~150),
packing the near-core solid (free 2×2 = 0) and collapsing the era-5
blight-gradient far cohort from ~25 to **0–2** (the test needs ≥5),
unrecoverable by any later lever and *worsened* by the Task-6 3-row carve. It
escalated before committing. **Team-lead ruling:** calibrate to **80** (=
AC#4's "2× the ~40 baseline"; the PRP itself states "the budget is a cap, not
a guarantee — set the floor below realized"), and treat density as **cumulative
across eras** rather than maxed in the compact founding grid. Documented in the
commit body. **Deviation #1.**

### 2. T4→T5 transient: 3 era-2 parking tests red after Task 4
**Category:** Test discipline **Severity:** Significant → resolved at T5
Raising era-1 density consumed the near-core 2×2s era-2's old parking placement
relied on, leaving the suite at **732/3** after T4 (exactly the 3
`era2MotorAge … places at least one parking lot` tests). The proposer left them
**honestly RED — did not weaken them** (correct). The reviewer independently
confirmed in an isolated detached worktree at `a81ce13` that *exactly* those 3
were red and the test diff was purely additive. **Team-lead ruling:** accepted
as a narrowly-scoped T4→T5 transient on the condition T5 restore full green and
no task proceed past T5 with any red. T5 (`cd9d3b3`) restored **743/0**
(verified in an isolated worktree) — finding resolved.

### 3. all-lane test was not a clean RED (Task 4)
**Category:** Test Quality **Severity:** Minor → resolved
The first all-lane property (`maxLaneParcels ≥ 2`) structurally caps at 2 and
wasn't a clean pre-impl RED. The proposer root-caused and replaced it with
`bothSidesBuilt` (72 vs 14, clean RED ≥40); amended to `a089dc3`, reviewer
marked resolved.

### 4. era-2 whole-grid fill re-plugs the office 2×2s
**Category:** Logic **Severity:** Minor (deviation) → resolved
A whole-grid core-weighted era-2 fill re-fills the near-core 2×2s the era-4
offices need after the era-3 carve → offices=0 at every budget (root-caused via
a free-2×2-after-era3 sweep; offices=3 at era2Parcels=0). **Fix:** target the
era-2 fill to the **extension frontage only** (tiles outside the era-1 grid
box), keeping the era-1 core free while realizing the full budget 90
(alive@era2=160). **Deviation #2.**

### 5. office placement near-core room after the 3-row carve (Task 6)
**Category:** Logic **Severity:** Minor (deviation) → resolved
The 3-row carve leaves ~0 free 2×2 strictly inside `coreRadius`. Office
placement widened to the office test's existing "near center" tolerance
(`coreRadius+2`) with a `nearCore` accept pinning the anchor — aligning the impl
to the test's existing bar, not weakening it. **Deviation #3.**

**Nits (declined/non-blocking):** a parametric wide⊆keyspace loop (T1, the two
new describes already prove it); paired poles on wide avenues (T2, matches
spec); `ctx.save/restore` in the decoration pass (T3, matches the renderer's
set-before-use convention); `widenAvenue` counting merges as placed (T5,
cosmetic chronicle).

## Deviations from PRP (all measure-and-moderate, none weaken a test)

1. **`era1Parcels` 150 → 80** — measured saturation + far-cohort collapse;
   80 = AC#4 "2× baseline". (Issue 1.)
2. **era-2 fill → extension frontage only** (not whole grid) — preserve
   near-core office room. (Issue 4.)
3. **office placement → `coreRadius+2`** with a `nearCore` accept — the 3-row
   carve removes strict-core 2×2 room; aligned to the test's existing
   tolerance. (Issue 5.)

The contract behind all three: **AC#4 ("materially denser, ≥2× the ~40
baseline") is the requirement; the PRP's specific budget numbers are
calibratable targets.** No era-test threshold was weakened; budgets were tuned
and impl fixed to keep every verified invariant green.

## Empirical End State (measured, seeds moses-1/2/3)

- **Density (cumulative):** alive ~80 @era1, ~160 @era2 — **≈2.5× the old
  ~64** ("filled-in" delivered across eras, not by saturating one).
- **Far cohort 31 / 21 / 7** (≥5; moses-3=7 is the geometry-bound floor and
  held under the 3-row carve) — the blight gradient survives.
- **Era-5 abandonment 30% / 29% / 25%** (≥10% bar, wide margin) — achieved
  **structurally** (core-weighted numerator + moderate `era4Houses`=55), never
  via the decay formula.
- offices 2/3/3; single road + highway components; `checkParcelAgreement`
  empty; **triple-snapshot `hashWorld` byte-identical**.

## Team-Lead Live Browser Verification (Chromium + WebKit — pixel-identical)

Served `npm run dev`; drove the camera to the seed-`bodhitropolis` city
centroid (62,101). **Chromium** viewport histogram: water 0.9% / green 28.5% /
**pavement 33.3%** / buildings 19.1% (warm 17 + office 2.1) / **builtish
52.4%**; power-line masts+wires **~11,196 px** (≈25 poles in view + their
wires). **0 console errors.** A standalone Playwright **WebKit** pass (webkit
build, headless) returned a **byte-identical** histogram (33.3 / 52.4 /
mast 11196) and **identical worldgen** (centroid [62,101], developedTiles 1148,
roads 942, parcelTiles 206), **0 console errors** — confirming both the
cross-engine determinism guarantee and pixel-identical canvas2d rendering of the
slabs and power lines. Filled blocks, 2-/3-row corridor slabs, parking masses,
and power lines all render; the read is a dense, over-paved, blighted
mid-century city with the green outer fabric the gradient needs.

## What's Done Well

- **The empirical escalation was the dialectic working at its best.** The
  proposer measured rather than guessed, caught a PRP defect that would have
  broken the game's central tension, escalated cleanly with a sweep table, and
  then carried the measure-and-moderate discipline through three more eras —
  calibrating budgets, never weakening a test.
- **The reviewer independently re-ran the suite in isolated detached
  worktrees** to verify the transient was exactly 3 tests and that T5 closed it
  — not taking the proposer's word.
- **Pure-seam discipline held:** every render decision (wide flag, pole, wire
  direction) is in headless-tested `decoration.ts` with an exact-set fixture;
  the renderer shell holds zero branching.
- **The determinism contract is intact** and now *proven cross-engine in the
  browser* (WebKit == Chromium == Node, byte-for-byte).

## Summary

8/8 commits APPROVED; 2 Significant (era-1 saturation/far-cohort; the T4→T5
transient) and 3 Minors, all resolved in-flight; 3 documented deviations, none
weakening a test. 752 tests, gates green, determinism byte-stable and
cross-engine-verified, live-passed pixel-identical in Chromium and WebKit. The
city is dense, paved, and blighted — exactly the playtest ask — while keeping
the blight gradient that makes it a game.

**APPROVED** — proceed to PR after the `.dialectic-tier` strip (standard tier;
no security audit required). Aesthetic fine-tuning of the slab seam / pole look
is a deferred live-tuning call (PRP §6) and a candidate for Maddy's feedback.
