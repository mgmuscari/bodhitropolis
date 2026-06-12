# Code Review: ecology-layers

## Verdict: APPROVED
## Reviewer Stance: Team — Proposer + Code Review Partner
## Date: 2026-06-12
## Mode: Agent Team (message-gated incremental review)

> Full team pipeline: `/review-plan-team` (5 yield-point families, 3
> team-lead rulings, a PRD amendment) → `/execute-team` (this artifact).
> Ten commits — 7 task + 3 post-review hardening — all approved; never a
> Blocking or Significant finding. The reviewer scope-checked every commit
> against the read-only boundary cumulatively; the proposer self-disclosed
> every deviation before review reached it. The team lead's live pass
> verified the feature's emotional core: the wound visible, the garden
> healing.

## PRP Compliance

All 7 tasks as specified (plus hardening), suite 493 → **560** tests
(31 files), `tsc` clean, build green, branch fully additive
(+1842/−17), `fabric.ts`/`tools/`/`tech/` sources untouched by every
commit (verified by cumulative diff):

| Commit | What | Verdict |
|---|---|---|
| `123205a` | soil/flora/fauna layers + snapshot fold (reaches hashWorld) | ✅ clean |
| `fccdb51` | Influence table (road-diet `fragmenting` pinned as data) + fail-closed guard scan | ✅ (1 Minor → hardened later) |
| `4b936b5` | Ecology tick: strict double-buffer on persistent scratch, carrying-capacity fauna CAP, CORRIDOR_FLOOR bridge both ways, byte-isolation + AC7 tech-bytes-after-spend | ✅ strong (3 Minor disclosed-and-accepted, 1 Nit) |
| `81f826a` | Eco-seed stage: deterministic wound (corridor soil deficit, periphery fauna), era5 RECORD + both-ways eraHeadline regression guard | ✅ clean |
| `ac73a2f` | simpsonIndex exact rationals (incl. non-dyadic) + floor-scaled field + ecologyReport (tile-mean rings, water filtered, never-NaN) | ✅ (1 accepted arch note: report→fields import, no cycle) |
| `661f58c` | Overlay (E self-bound via pure gate), four pinned tint ramps + legends, ecologyStatLine DISPLAY half wired into the opening | ✅ (1 accepted deviation: legend reuses the dock slot) |
| `10b41f3` | README ecology section (placeholder-rates disclosed) | ✅ docs-only |
| `e8400bb` | readonly KindInfluence fields (reviewer's own Task-2 Minor) | ✅ |
| `f22eaac` | Pins symmetric flora influence as a tested contract (lead ruling: deviation → spec) | ✅ |
| `0294178` | Overlay skips water tiles (reviewer's Task-6 item) | ✅ |

**Team-lead product rulings on the three disclosed Task-3 design
choices — all ACCEPTED as-implemented:** symmetric flora influence
(gardens actively green their block — the more solarpunk reading, now
test-pinned); CORRIDOR_FLOOR for all non-fragmenting transit including
rail-family (rail corridors are real-world wildlife corridors); soil
capped on water tiles (sensible, report filters water from means).

## Issues Found

All Minor/Nit; every actionable one resolved in the hardening commits
(mutable influence singletons → readonly; symmetric-flora superset →
pinned contract; water tinting → skipped). The Task-3 first isolation
test's empty ParcelStore (vacuous on parcels) is covered by AC7's
populated-store path — accepted. The ecology→worldgen `distanceField`
import is guard-permitted, cycle-free, and isolated to report.ts.

## Team-Lead Live Browser Verification

Seed `bodhi-1`: **the opening now names the wound** — "Soil runs 48
thinner along the old corridors; the wild holds at 113 by the edges" —
real report numbers in the established register (plan-review YP1's
display half, live). The soil view shows the **broken-brown corridor
scar** across living greens with water neutral; all four views cycle
with their legends in the dock ("Biodiversity — Simpson index, violet to
gold"). The healing test: a Community Garden placed on degraded soil
visibly **greened its surrounding block over 16 ecology ticks** (halo
radiating around the soil-capped parcel tiles) against gentle baseline
recovery. Unlock-chain → tool appearance, placement, and the
mid-pass HMR reset (the known guard-probe/dev-server interaction, not a
product bug) all behaved as established. The quiet-street fauna bridge
is pinned both directions in fixtures.

## What's Done Well

- **The two-half wound contract landed end-to-end**: era5 record with a
  regression guard proven robust against the real pipeline, display via
  a stat line that degrades to omission — the plan review's structural
  finding closed with the player feeling it.
- **The isolation discipline is now mechanical**: six layers + parcel
  bytes per tick/seed, tech bytes at the exact integration seam the
  civic sim will one day test — the read-only boundary held at file
  level across all ten commits.
- **Determinism extended to a living system with zero rng**: strict
  double-buffering whose tests exercise the inter-step lag, exact
  rational biodiversity, cadence phase pinned.
- **Deviations became specs**: every divergence was disclosed first,
  ruled on, and the accepted ones converted into pinned tests rather
  than lore.

## Summary

10/10 commits approved; 0 Blocking/Significant ever; all Minors resolved
or accepted-with-rationale; 560 tests, gates green, live pass verified
the wound, the overlay, and the healing. The land is a participant now —
the player's road diets and gardens are acts of repair the simulation
measures. Standard tier: no security audit required; proceed to PR.
