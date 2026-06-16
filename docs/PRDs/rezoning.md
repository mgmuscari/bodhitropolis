# PRD: Rezoning

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-15
## Branch: feature/rezoning

## 1. Problem Statement

The player inherits a blighted, over-paved mid-century city (the Moses century
+ urban-density). They can already *build* solarpunk amenities on empty land
and *convert* roads (road diets). But the dominant starting surface is **sealed
parcels** — derelict houses, abandoned projects, parking craters, the open
pavement of urban-density — and the player has no restorative move that acts on
**existing zones**. Maddy's proposal:

> "rezoning could work like upgrades/plops on top of existing zones. community
> gardens, parks, rewilded land for water retention, etc."

This is the restorative counter-move the game is missing: take a parcel the
century scarred and **convert it in place into green, unsealed, soil-healing
land**. It closes the loop with the prior features — urban-density left a city of
over-paved, derelict **parcels** (parking craters and fields, abandoned Projects,
open pavement), and rezoning is the in-place move that heals them — and it makes
the ecology layer (already simulated, already overlaid via the Eco key/button)
*respond to player action* for the first time: depaving a **sealed** parcel lets
the soil recover above the paved cap.

**Scope is convert-only — on sealed alive parcels** (Maddy's "plops on top of
**existing zones**"). The mechanism acts on the tiles you cannot otherwise build
on (an alive ParkingLot/Projects/etc parcel). The *empty* demolition craters
(`built = 0`) and green block-interiors urban-density also left are deliberately
**out of scope here**: they are already unsealed (their soil already recovers, no
depaving needed — the `sealed` rule in `tick.ts`) and already greenable with the
existing build-on-empty greens (Parklet, Community Garden — whose tech nodes
`parklets`/`community-gardens` are the very prereqs of `pocket-parks`/`rewilding`,
so they are always co-available wherever rezoning is). A build-on-empty
Park/RewildedLand path is a clean additive follow-up if Maddy wants it later
(Open Question 5).

This is the third of four playtest features (ui-revival ✓ → urban-density ✓ →
**rezoning** → city-life). It is a player **runtime** action (a new tool), not
worldgen.

## 2. Proposed Solution

Add two green parcel kinds and a *convert-in-place* tool that turns any alive
building parcel into one of them, healing the land beneath it — reusing the
existing conversion/tool/tech/repair machinery wherever possible, with **no new
mechanism invented**.

1. **Two new kinds — `Park` (61) and `RewildedLand` (62)** in the
   tech-tree-era building band (48–127; 48–60 used, 61/62 next free). `Park` =
   a tended green amenity; `RewildedLand` = naturalized water-retention land.
   Both render as building footprint tiles (solarpunk greens, distinct from
   Parklet/CommunityGarden).

2. **`convertParcel` single-writer** in `fabric.ts` — the building analogue of
   the existing `convertTransport` road-diet. An **in-place kind swap** that
   preserves the parcel's id and footprint (a 3×3 Projects becomes a 3×3 Park;
   a 2×2 parking crater becomes a pocket park), resets condition to pristine
   (fresh green), and writes the `built` layer *and* the `ParcelStore` kind
   **together** (one writer, `checkParcelAgreement` stays green). A new
   `ParcelStore.setKind` (mirroring `setCondition`) is documented
   convertParcel-only. The parcel stays alive, same id, same tiles — a
   conversion, not a placement or demolition.

3. **Depaving heals the soil** (the water-retention payoff), with the ecology
   layer-isolation invariant intact. A new `UNSEALED_KINDS`/`isUnsealed`
   (in `influence.ts`, the ecology-side fabric-taxonomy reader) exempts
   Park/RewildedLand from the ecology tick's paved-soil cap (`tick.ts:107-109`,
   where any parcel tile currently caps soil at `PAVED_CAP = 40`). Once a
   parcel is Park/RewildedLand, its soil is no longer capped and **recovers
   over ecology ticks** at the natural open-land rate. The feature writes **no**
   soil/flora/fauna directly — it only removes the cap; the existing tick does
   the recovery by reading the new kind (exactly as `influenceOf` keys on kind).
   Park/RewildedLand also get small **positive** `INFLUENCE` entries
   (non-fragmenting greens, like Parklet) so they actively heal and lift their
   neighbours — making the restorative move *visibly* rewarding rather than
   merely un-capped. (Soil magnitudes stay **< 6** — see §3 ecology.)

4. **Tech gating via the existing grant machinery** — two `tree.ts` nodes:
   `pocket-parks` (New Urbanism, after `parklets`) granting `kind(Park)`, and
   `rewilding` (Green Development, after `community-gardens`) granting
   `kind(RewildedLand)`. No new gating mechanism: `grantedKinds()` already
   drives tool availability, and the unlock surfaces the tool in the dock with
   the ui-revival unlock-flash.

5. **The tools are conversions: `convert-61` / `convert-62`.** Reusing the
   `convert-${kind}` tool family (keyed by target kind) means the entire
   pipeline already exists — `CONVERT_TABLE` entry, `availableTools` gating,
   preview/cost/effort, and crucially `isRepairTool` (`repairTools.ts`), which
   returns true for **any** `convert-*` tool, so rezoning credits neighborhood
   **trust through the existing repair forwarding with zero new code**.
   `geometryValid`/`applyTool` gain a one-line dispatch: a building convert
   target routes to `convertParcel`, a transport target to `convertTransport`.
   User-facing labels read "Rezone: Park" / "Rezone: Rewilded Land".

6. **Point-plop interaction (`isLineTool`).** `isLineTool` (`main.ts:151`)
   currently returns true for *any* `convert-*`, which would make `convert-61/62`
   drag-paint: one drag across a block would mass-rezone every alive parcel it
   crosses and debit the cost per parcel. That contradicts Maddy's per-parcel
   "plops." Fix: a tool is a line tool iff its kind is a **transport** kind
   (`isTransportKind(tool.kind)`) — so transport build/convert (road diets) stay
   drag-paint, while building convert (`convert-61/62`, and every building build)
   are point-apply (click = one parcel, drag = pan). Extract `isLineTool` to a
   pure, unit-tested predicate (the `repairTools.ts` precedent) so the
   interaction is pinned by a test, not left to the live pass.

## 3. Architecture Impact

**Engine — `src/engine/fabric.ts`** (the built/parcel single-writer module):
- `BuiltKind` gains `Park: 61`, `RewildedLand: 62` (auto-valid in `tree.ts`'s
  `VALID_KINDS`, in `isBuildingKind` 16–127, treated as buildings by
  `parcelTouchesRoad`/`footprintPos`/`checkParcelAgreement`).
- `ParcelStore.setKind(i, k)` — new setter mirroring `setCondition`
  (`fabric.ts:194`), documented convertParcel-only.
- `REZONE_TARGETS = new Set([Park, RewildedLand])`; `canConvertParcel(map,
  store, x, y, to)` (tile holds an alive building parcel; `to ∈ REZONE_TARGETS`;
  reject same-kind no-op) and `convertParcel(map, store, x, y, to)` — find the
  parcel via `map.parcel[idx]`, swap kind across its whole footprint in `built`
  + `store.setKind` + `store.setCondition(255)`. Joins
  placeParcel/demolishParcel/convertTransport in the single-writer block.

**Ecology — `src/ecology/influence.ts` + `src/ecology/tick.ts`:**
- `influence.ts`: `UNSEALED_KINDS`/`isUnsealed(kind)` (Park/RewildedLand) +
  `INFLUENCE` entries for Park/RewildedLand (small positive soil/flora/fauna,
  `fragmenting: false`). **Soil ceiling: keep both `< 6`** — `influence.test.ts`
  pins CommunityGarden (soil 6) as the strongest soil boost in the table;
  RewildedLand's "stronger soil" (open Q2) means stronger-than-Park, still < 6.
- `tick.ts:107`: `sealed = water || transport || (parcel[i] !== 0 &&
  !isUnsealed(built[i]))` — the *only* change; the recovery loop is otherwise
  untouched. Still writes ONLY the three ecology layers (isolation preserved).

**Tech — `src/tech/tree.ts`:** `pocket-parks` (NU, prereq `parklets`,
`kind(Park)`) + `rewilding` (GD, prereq `community-gardens`, `kind(RewildedLand)`).

**Tools — `src/tools/tools.ts`:** `CONVERT_TABLE` gains `[Park]`/`[RewildedLand]`
("Rezone: Park"/"Rezone: Rewilded Land", small costs); the `availableTools`
convert gate becomes three-way: a **building** target → `grantedKinds().has(to)`,
a **transit** target (5–9) → `grantedKinds().has(to)`, a **classic road** target →
the `road-diets` capability (unchanged); `geometryValid` + `applyTool` `convert-*`
branches dispatch `isBuildingKind(kind)` → `canConvertParcel`/`convertParcel`, else
`canConvertTransport`/`convertTransport` (the road-diet path is untouched).

**Interaction — `src/main.ts` (+ a new pure predicate module):** `isLineTool`
becomes "line iff `isTransportKind(tool.kind)`", so building convert tools (incl.
`convert-61/62`) are point-apply and transport build/convert (road diets) stay
drag-paint (building builds were already point). Extract it to a pure, unit-tested
predicate (`isLineTool(tool: ToolDef)`) mirroring `repairTools.ts`, so the
point-vs-line contract is tested rather than buried in the DOM shell.

**Civic — `src/civic/dynamics.ts`:** add `Park` to `GATHERING_KINDS` (a park IS a
gathering place — reusing the existing belonging mechanism for the new kind,
exactly as Park joins `INFLUENCE`). This dissolves the otherwise-unintuitive −1
belonging when a CommunityGarden (a gathering kind) is rezoned into a Park, and
makes parks build community (on-theme). **RewildedLand stays OUT** (wild, not
social): rezoning a gathering amenity into wilderness is a deliberate belonging
trade-off, not a bug. No other civic change; `wellbeing` (`effort.ts`) has no kind
branch — a green parcel is an ordinary alive parcel at pristine condition.

**UI — `src/ui/renderKey.ts` + `src/ui/renderer.ts`:** Park/RewildedLand in
`BUILDING_RENDER_KINDS` (→ `b-61-`/`b-62-{pos}-{tier}`) and `BUILDING_STYLES`
(tended-green Park; wilder RewildedLand) — required or `buildAtlas` throws on
the new keyspace entries. `repairTools.ts` needs **no change** (convert-prefix
already classifies).

**Data model:** no new tile layers; no `ParcelStore` field changes beyond the
`setKind` accessor. `hashWorld` already covers kind+condition via
`snapshotBytes`, so convertParcel is deterministic. **No dependencies added.**

## 4. Acceptance Criteria

1. **Gates green:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`; the
   `renderKeyspace ⊆ paintable` guard holds with the new `b-61`/`b-62` keys
   (BUILDING_STYLES entries present).
2. **`convertParcel` (tested):** preserves the parcel **id** and **footprint**,
   swaps the kind in the `built` layer **and** the `ParcelStore` together across
   every footprint tile, resets condition to pristine, leaves the parcel alive,
   and keeps `checkParcelAgreement` empty. Rejected (writes nothing) on empty
   tiles, road/transport tiles, dead/tombstoned parcels, an out-of-table target,
   and a same-kind no-op.
3. **`ParcelStore.setKind` is convertParcel-only** — exercised via convertParcel
   + an agreement assertion (a kind set without the matching `built` write would
   fail `checkParcelAgreement`).
4. **Depaving recovers soil (tested):** Park(61)/RewildedLand(62) are in
   `UNSEALED_KINDS`; converting a parking/parcel tile whose soil sits at the
   paved cap (40) and running N ecology ticks raises its soil **monotonically
   above 40** (whereas an unconverted sealed parcel stays ≤ 40). The
   feature performs **no direct ecology-layer write** — verified by the existing
   layer-isolation byte-tests staying green.
5. **Influence signs (tested):** `influenceOf(Park).soil > 0` and
   `influenceOf(RewildedLand).soil > 0`, both `fragmenting: false` (greens, not
   barriers), both **< 6** (CommunityGarden stays the strongest soil boost) —
   magnitudes are placeholder, only the signs + the ceiling are pinned.
6. **Tech gating (tested, pure):** `pocket-parks` grants Park and `rewilding`
   grants RewildedLand; `availableTools` surfaces `convert-61` only once Park is
   granted and `convert-62` only once RewildedLand is granted (and never via the
   `road-diets` capability); `validateTree(TECH_TREE)` stays empty (each kind
   granted once, prereqs reach a root).
7. **Repair-trust credit (tested):** `isRepairTool(convert-61)` and
   `isRepairTool(convert-62)` are true (convert-prefix) — rezoning credits trust
   through the unchanged repair forwarding (`repairTools.ts` is not modified).
8. **Tool validity (tested):** `convert-61/62` preview/apply is valid only on a
   tile holding an alive building parcel (invalid on empty/road/water/dead);
   applying it runs `convertParcel` and debits the cost through `TechState.spend`.
9. **Render keys (tested):** `builtRenderKey(Park, …)` → `b-61-{pos}-{tier}`,
   `RewildedLand` → `b-62-…`; `renderKeyspace()` includes their full pos×tier
   sets; the renderer's BUILDING_STYLE coverage guard stays green.
10. **Determinism (tested):** `hashWorld` is stable across runs for a fixed
    convert sequence (triple-snapshot), and a convert changes it deterministically.
11. **Point-plop interaction (tested):** the extracted `isLineTool(tool)` is
    `false` for `convert-61/62` (and every building tool) and `true` for transport
    build/convert (e.g. `convert-1` road-diet, `convert-6` streetcar, `build-5`
    bike path) — so a building rezone is a single-parcel click, a road diet still
    drag-paints.
12. **Park is a gathering place (tested):** `Park ∈ GATHERING_KINDS`,
    `RewildedLand ∉`; a neighborhood with a Park parcel gets the gathering
    belonging bonus; a CommunityGarden→Park rezone is belonging-**neutral** (the
    gathering bonus is preserved); a derelict-parcel→Park rezone leaves
    `wellbeing` rising-or-holding (alive + pristine condition, no kind miscount).
13. **Live pass (human gate), Chromium AND WebKit:** unlock `pocket-parks` /
    `rewilding`; rezone a derelict parcel and a parking crater — the latter an
    **alive ParkingLot parcel** (the era-5 craters that became ParkingLot
    parcels / parking fields, not the empty cleared tiles, which are out of
    scope) — into Park / RewildedLand; they render green; a drag with a rezone
    tool plops only the clicked parcel (no mass-rezone); via the **Eco overlay**
    the soil under them climbs above the old paved cap over ticks; the dock
    unlock-flash fires when the nodes unlock.

## 5. Risk Assessment

- **Ecology dependency direction.** The tick must read the cap-exemption from
  the **fabric kind** without ecology importing tools/civic or any fabric
  *writer*. Mitigation: `isUnsealed` lives in `influence.ts` and keys on kind
  exactly like `influenceOf`; `tick.ts` already imports from `influence.ts` and
  reads `built` read-only. The architecture guard (ecology DOM-free, no civic
  import) and the layer-isolation byte-tests catch any regression.
- **Condition reset / gathering belonging vs. the wellbeing formula.** Wellbeing
  reads alive/condition/eco/civic; a rezoned park is **alive with pristine
  condition**, which *raises* the condition mean — the intended restorative lift.
  Two real edges: (1) a park miscounted as residential — mitigated: Park/
  RewildedLand are **not** in `RESIDENTIAL` (worldgen-only, moses.ts:1034) and
  `wellbeing` (effort.ts) has no kind branch. (2) **Civic dynamics DOES branch on
  kind** via `GATHERING_KINDS` (dynamics.ts) — rezoning a *gathering* parcel
  (CommunityGarden, Bazaar, HealingCommons, Civic) into a green would remove that
  neighborhood's gathering belonging bonus and could *drop* belonging → wellbeing.
  Resolution: **Park joins `GATHERING_KINDS`** (a park is a gathering place), so
  CommunityGarden→Park is belonging-neutral and Park→anything keeps the bonus.
  RewildedLand is intentionally left OUT — rezoning a social amenity into
  wilderness is a deliberate belonging trade-off, so the "wellbeing rises-or-
  holds" guarantee is scoped to →Park and to non-gathering sources for
  →RewildedLand.
- **`convert-*` dispatch correctness.** The `convert-*` branch currently calls
  `convertTransport` unconditionally; a building target must route to
  `convertParcel`. Risk: a transport target accidentally hitting `convertParcel`
  or vice-versa. Mitigation: dispatch on `isBuildingKind(kind)` in both
  `geometryValid` and `applyTool`; tests cover a transport convert and a parcel
  convert side by side (the road-diet tools must keep working).
- **`availableTools` gate generalization.** Adding building convert targets must
  not loosen the road-diet gate. Mitigation: explicit three-way gate (building →
  granted kind; transit 5–9 → granted kind; classic road → `road-diets`
  capability) with tests for each branch.
- **Line-tool drag semantics.** `isLineTool` returns true for any `convert-*`, so
  a building-convert would inherit drag-paint and mass-rezone a block on one drag
  (per-parcel spend + trust). Mitigation: redefine line-tool as
  `isTransportKind(tool.kind)` (building convert becomes point-apply), extract it
  to a pure predicate, and test the point-vs-line split — so the road diets stay
  drag-paint and the rezone is a single-parcel plop.
- **Soil recovery near suppressors.** A park ringed by highways/parking gets
  net-negative influence and may not visibly recover. Mitigation: the small
  positive Park/RewildedLand influence offsets modest suppression; the recovery
  AC tests an isolated former-paved tile (clean signal); deep-blight recovery is
  expected to be slow (thematically correct — the player heals outward).

## 6. Open Questions

1. **Source restrictions?** Assume *any* alive building parcel is rezonable
   (Maddy's "plops on top of existing zones") — no source-kind allowlist, only
   a same-kind no-op rejection. (Reject rezoning a Park→Park; allow
   Projects/Parking/House→Park.)
2. **Park vs. RewildedLand mechanical difference?** Both un-seal + heal.
   RewildedLand leans water-retention (a moisture/flood role is future scope) and
   gets the stronger (still < 6) soil influence; Park leans civic amenity and **is
   a gathering place** (`Park ∈ GATHERING_KINDS`, a belonging bonus), while
   RewildedLand is wild (not social, excluded). For v1 they differ in **render** +
   **influence magnitude** + **the gathering flag**. Magnitudes are placeholder.
3. **Costs?** Assume cheap (rezoning reuses the parcel): Park ~6, RewildedLand
   ~4 effort. Placeholder, balanced later.
4. **Density on convert?** Assume density is left as-is (or set 1); it is
   meaningless for a green parcel and read by nothing that matters for greens.
5. **Place Park/RewildedLand on empty land too?** v1 is **convert-only** (Maddy's
   "plops on top of **existing zones**"). Empty craters/interiors are already
   unsealed (soil recovers untouched) and already greenable via the co-available
   Parklet/Community Garden build tools, so nothing is un-greenable — only
   *Park/RewildedLand specifically on empty land* is deferred. If Maddy wants it,
   it is a clean **additive** follow-up: `BUILD_TABLE[61/62]` + the `build-61`/
   `build-62` tools, reusing `placeParcel` and the existing `build-*` path, no new
   mechanism. Flagged for human review, **not built in this PRP.**

## 7. Out of Scope

- Ambient animation — cars/pedestrians/birds (Feature D).
- Any **new** tech/tool/trust mechanism (reuse grant machinery, the `convert-*`
  family, and `isRepairTool`).
- Transport/road changes; the junction-merge and `convertTransport` tables are
  untouched.
- **Worldgen** changes — rezoning is a runtime player action; the worldgen
  already leaves the sealed derelict parcels (ParkingLot craters/fields,
  abandoned Projects) to convert.
- **Greening empty land** — placing Park/RewildedLand on *empty* tiles
  (`built = 0`): the ~50% of era-5 demolition craters left as cleared tiles, and
  green block-interiors. Rezoning is convert-only (it depaves *sealed* alive
  parcels). Empty tiles are already unsealed — their soil recovers untouched —
  and already greenable with the existing build-on-empty greens (Parklet/
  Community Garden), so nothing is un-greenable; only *Park/RewildedLand
  specifically on empty land* is deferred. See Open Question 5 for the clean
  additive path if it is later wanted.
- A dedicated flood/water-retention simulation for RewildedLand; economy/cost
  balancing beyond reusing the existing effort/spend path; touch/mobile/
  accessibility/localization.
