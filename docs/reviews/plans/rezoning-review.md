# Plan Review: rezoning

## Verdict: APPROVED
## Reviewer Stance: Team — Interlocutor + Proposer
## Date: 2026-06-15
## Mode: Agent Team (concurrent review + revision)

> Six yield points (2 Structural, 3 Moderate, 1 Minor), all resolved. The
> engine/ecology/tech/tools spine was verified sound throughout (six checked
> strengths); the gaps clustered at the edges. The two headline exchanges: the
> interlocutor caught that the PRD's "fill the craters/interiors" motivation
> over-claimed what a convert-only mechanism can do (YP1), and that rezoning a
> *gathering* parcel silently dropped a belonging bonus the civic sim reads
> (YP6 — a real kind-miscount). Both produced a better, honest plan.

## Yield Points Found

### 1. Empty craters / green interiors are un-rezonable (motivation ≠ mechanism)
**Severity:** Structural
**Evidence:** `convertParcel` requires an alive building parcel (PRP Task 2);
no build path for 61/62 (`BUILD_TABLE` lacks them), so only `convert-61/62`
surface. But `era5Disinvestment` (`moses.ts`) leaves ~50% of demolition craters
at `built=0` (only `craterChance=0.5` become ParkingLot parcels), and the green
block-interiors are empty too. The draft PRD §1 said "rezoning is what fills the
craters/interiors" — which a convert-only mechanism cannot touch.
**Resolution (team-lead ruling, after exploring both directions):** the team
explored **expanding** to a build-on-empty path (`build-61/62`) to literally
fill the empty land, then converged on **convert-only** as the right scope:
(a) it matches Maddy's exact framing — "plops **on top of existing zones**";
(b) empty land is already unsealed (its soil already recovers — the `tick.ts`
`sealed` rule is false for `built=0`) and already greenable via the
co-available Parklet/CommunityGarden builds (whose nodes are the very prereqs of
`pocket-parks`/`rewilding`); (c) urban-density left the blight as over-paved
**sealed parcels** (parking craters/fields, derelict Projects) — exactly what
convert-on-sealed targets. The PRD §1 motivation was narrowed honestly; AC#13
defines the live-pass "parking crater" as an **alive ParkingLot** parcel; a
build-on-empty Park/RewildedLand path is parked as **Open Q5** (a clean additive
follow-up if Maddy later wants those specific kinds on empty land).
**PRP/PRD Updated:** Yes (PRD §1/§7, AC#13; PRP §1/§6).

### 2. `convert-*` inherits line-tool drag semantics (mass-rezone)
**Severity:** Structural
**Evidence:** `isLineTool` (`main.ts:151-159`) is true for any `convert-*`;
`attachInput` drag-paints line tools → a drag would `convertParcel` every parcel
it crosses + spend per tile + record a repair per parcel, contradicting the
per-parcel "plop" framing. The test plan was point-apply only, so this surfaced
only in the live pass.
**Resolution:** Accepted — **point-plop**. Extract a pure `isLineTool(tool)` =
`isTransportKind(tool.kind)` into `src/ui/lineTools.ts` (mirroring
`repairTools.ts`) + test; rewire `main.ts`. Building build/convert (incl.
`convert-61/62`) are point tools (click = plop, drag = pan); transport
build/convert (road diets, kinds ≤15) keep drag-paint. New PRP Task 6.
**PRP/PRD Updated:** Yes (PRP Task 6; PRD §2.6/§3/§5/AC#11).

### 3. Task 4 misnamed the breaking tree tests
**Severity:** Moderate
**Evidence:** adding two nodes breaks `tree.test.ts:41` (`length === 34` → 36)
AND the `DESIGN_BRIEF_IDS` exact-id-set (`:13-31`, asserted `:45-48`). The draft
said "node-count/total-kinds … not the structural checks" — naming neither, and
the required id-set edit reads like the very "structural check" it warned off.
**Resolution:** Accepted — Task 4 now names both, and frames the
`DESIGN_BRIEF_IDS` edit as an intended **manifest** update (the design brief
gained two nodes), with the `validateTree` structural checks explicitly left
untouched.
**PRP Updated:** Yes (Task 4).

### 4. Hidden INFLUENCE soil ceiling
**Severity:** Moderate
**Evidence:** `influence.test.ts:82-88` pins CommunityGarden (soil 6) as the
strongest soil boost over the whole table. Park +2 / RewildedLand +3 pass, but
the draft invited later tuning and called RewildedLand the "stronger soil" — a
tuner raising it ≥ 6 would silently break the contract test.
**Resolution:** Accepted — Task 3 + the uncertainty log + PRD §3 document the
**< 6 ceiling** ("stronger soil" = stronger-than-Park, still < garden); a future
tuner must respect it or consciously re-pin the test.
**PRP/PRD Updated:** Yes (PRP Task 3/§6; PRD §3/AC#5).

### 6. Rezoning a gathering kind drops belonging (a real kind-miscount)
**Severity:** Moderate
**Evidence:** `GATHERING_KINDS` (`dynamics.ts:45-51`) =
{Bazaar, MakerSpace, HealingCommons, CommunityGarden, Civic}; a present gathering
tile gives +1 belonging → civicMean → wellbeing (`effort.ts`). Park/RewildedLand
were not in the set, and the PRD allows rezoning *any* alive parcel — so a legal
CommunityGarden→Park convert would **remove** the gathering bonus, dropping
wellbeing, contradicting the PRD's "intended restorative lift." The civic code
special-cases kinds; greens were the asymmetric loser. (Raised by the team lead,
elevated by the interlocutor to its own finding.)
**Resolution:** Accepted — **Park joins `GATHERING_KINDS`** (a park is a
gathering place; reuses the existing belonging mechanism for the new kind,
exactly as Park joins `INFLUENCE`), making CommunityGarden→Park belonging-neutral
and parks community-building (on-theme). **RewildedLand stays OUT** (wild, not
social); a gathering→RewildedLand convert is a documented deliberate trade-off,
so the "wellbeing rises-or-holds" guarantee is scoped to →Park and
non-gathering→RewildedLand. New PRP Task 7 (the former vague Task 6).
**PRP/PRD Updated:** Yes (PRP Task 7; PRD §3 Civic/§5/AC#12).

### 5. Task 6 (civic guard) underspecified
**Severity:** Minor
**Evidence:** no named file/fixture/assertion, conditional GREEN — yet (modulo
YP6) the base case is determinate (wellbeing has no kind branch; RESIDENTIAL
excludes 61/62).
**Resolution:** Accepted — folded into Task 7 as concrete named tests
(`dynamics.test.ts` + `effort.test.ts`) with the expected result stated up front.
**PRP Updated:** Yes (Task 7).

## What Holds Well

The spine was verified sound at the line level (interlocutor's six checks):
- **`convertParcel` single-writer** is correct — leaving the parcel-id layer
  untouched (same id/footprint, store kind + tile built both set to `to`, parcel
  stays alive) keeps `checkParcelAgreement` green; `snapshotBytes` covers
  kind+condition so `hashWorld` stays deterministic; the same-kind reject keeps a
  repeat-convert sequence hash-stable.
- **Ecology change is minimal + isolated** — the one-line `sealed`-cap exemption
  reads `built[i]` only and still writes just the three ecology layers (isolation
  byte-tests hold); `isUnsealed` in `influence.ts` adds no new import direction.
  *And it is load-bearing:* a converted park has `parcel≠0`, so the exemption is
  what stops it sealing its own soil at 40 — pinned by the Task 3 soil-40→>40
  convert test.
- **3-way `availableTools` gate** does not loosen road-diets (building →
  granted-kind, transit 5–9 → granted-kind, classic road → `road-diets`
  capability); the `convert-*` dispatch keeps road diets routing to
  `convertTransport`.
- **`isRepairTool` reuse** — `convert-` prefix → trust credit, no change.
- **61/62 are free** and break no BuiltKind-enumeration test.
- **Soil-recovery test is non-vacuous** — the cap clamps *after* influence, so a
  broken exemption keeps a Park pinned at 40 and fails the test; ParkingLot
  control stays ≤ 40.

## Summary

6 yield points (2 Structural, 3 Moderate, 1 Minor), all resolved; no remaining
structural or moderate weakness. The two Structural finds were the
motivation-vs-mechanism gap (YP1 → honest convert-only scope, build-on-empty as
Open Q5) and the untested drag interaction (YP2 → point-plop via an extracted
pure `isLineTool`); the Moderates tightened the tree-test manifest naming (YP3),
documented the < 6 soil ceiling (YP4), and fixed a genuine civic kind-miscount
(YP6 → Park ∈ GATHERING_KINDS). Final plan: **7 tasks, 13 ACs**, convert-only,
reusing the convert/tool/tech/repair/civic machinery; determinism and ecology
layer-isolation preserved; no worldgen change; only kinds 61/62.

**APPROVED** — proceed to `/execute-team`. The team lead owns the live browser
pass in **both Chromium and WebKit** (unlock pocket-parks/rewilding; rezone a
derelict parcel + an alive ParkingLot crater; confirm green render, point-plop
drag, and Eco-overlay soil climbing above the paved cap) and the
`.dialectic-tier` strip before merge.
