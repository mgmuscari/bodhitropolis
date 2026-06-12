# PRP: Build Tools

## Source PRD: docs/PRDs/build-tools.md
## Date: 2026-06-12

## 1. Context Summary

The game's core verb: a pure tool system (select → preview → apply,
spending communal effort) over new fabric capabilities — an explicit
transport-conversion table (road diets as transformations), the kinds 5-9
fence replaced with empty-land placement, frontage reconciliation — plus
the renderer's kind-dispatch extension behind a pure `builtRenderKey`
seam, a toolbar dock, and click-apply input. This lands the three changes
the tech-tree PRP contractually coupled to this feature, together.

## 2. Codebase Analysis

(Line refs verified at branch HEAD `d978c77` merge-base.)

- **Fence + merge** — src/engine/fabric.ts: `MERGEABLE_TRANSPORT_MAX = 4`
  :273, `canPlaceTransport` :321 with the 5-9 fence at :326,
  `placeTransport` merge `max()` :344-350, `demolishTransportAt` :388,
  `demolishParcel` :360s, placement single-writer block comment ~:258.
  The conversion function joins this block; the fence line at :326 is
  REPLACED by empty-land placement rules for 5-9 (no merge: same-category
  merge check must exclude >4 on BOTH sides — placing street onto an
  existing QuietStreet(7) tile must NOT merge (capacity-unsafe direction);
  it is REJECTED; the reverse direction is a conversion, not a placement).
- **FROZEN suites** (byte-unmodified, same contract as tech-tree):
  tests/engine/fabric.test.ts classic merge :292, rail-crossing :304,
  16-config mask sweep :371, 4-way junction :403. The tech-tree fence
  tests ("rejects each 5-9 on empty land") are REQUIRED edits this
  feature — they encode the old fence and flip by design (placement on
  empty land becomes legal); rewrite them as the new placement-rule
  tests. The "no merge/no crossing for 5-9" property they also carried
  must be preserved in the rewrite.
- **Frontage** — `parcelTouchesRoad` (fabric.ts ~:430s) currently
  `isRoadKind`; swaps to `transportCategory(k) === 1` (QuietStreet
  counts). Existing frontage tests (classic cases) must pass unchanged;
  add QuietStreet cases.
- **Renderer** — src/ui/renderer.ts: `BUILDING_STYLES` record :76
  (16-23), atlas keys `road-{kind}-{mask}` / `rail-{mask}` :229-232,
  binary dispatch :334 (`built === Rail ? rail : road-...`) — replaced by
  `builtRenderKey(kind, mask, condTier)` from a new pure module
  `src/ui/renderKey.ts` (allowlisted) returning the atlas key; atlas
  builder grows: `bike-{mask}`, `ped-{mask}`, `streetcar-{mask}`,
  `elev-{mask}` transport sets + building styles for 48-60 (solarpunk
  palette per PRD). Preview overlay: renderer gains
  `setPreview(tiles: {x,y,valid}[] | null)` drawn as translucent
  green/red tints after the built pass.
- **Input** — src/ui/input.ts `attachInput` :8 (drag pan, wheel zoom,
  arrows). Click-apply: track pointerdown position; on pointerup with
  total movement < 5px and a tool selected → apply at the tile under the
  cursor (`camera.screenToWorld` floor). Hover: pointermove with tool
  selected → preview recompute (throttled to tile changes). Line drag for
  transport tools: pointerdown→pointerup straight-line tiles (axis-major)
  applied per tile.
- **Wiring** — src/main.ts: techPanel mount :87, `panelDirty` :111-122
  pattern; toolbar mirrors it. Tool effects mark canvas `dirty` AND
  `panelDirty` (effort changed).
- **Guard** — tests/architecture.test.ts: scanned dirs include src/tech;
  add `src/tools`; `PURE_UI_ALLOWLIST` gains `src/ui/toolbarContent.ts` +
  `src/ui/renderKey.ts`.
- **Effort spend** — TechState.effort is public number (src/tech/state.ts);
  tools debit it directly via a `spendEffort(state, n)` helper in tools
  (clamped, integer, rejects insufficient) — do NOT reach into TechState
  internals beyond the public field.

**Execution mechanics:** full team pipeline; lead owns the live browser
pass + tier strip.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Transport conversion table + fence replacement (fabric)
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
- `TRANSPORT_CONVERSIONS: ReadonlyMap<BuiltKind, readonly BuiltKind[]>`:
  Street→[QuietStreet, Promenade, BikePath]; Avenue→[Street, QuietStreet];
  Highway→[Avenue]; Rail→[Streetcar]. Exported.
- `canConvertTransport(map, x, y, to)`: tile holds a `from` whose entry
  contains `to`. `convertTransport(map, x, y, to)`: validates, writes
  `built[i] = to`. Single-writer block. Never touches parcel layer/store.
- Fence replacement in `canPlaceTransport`: kinds 5-9 → legal on EMPTY
  land only (in-bounds, land, `built === 0`); merges involving any kind
  >4 on either side rejected (no quiet-street-eats-avenue in either
  direction); crossings still rejected. Classic 1-4 path byte-identical
  behavior.
**Tests (RED):** every table entry converts in place (built changes, map
otherwise hashWorld-stable except that tile); every non-entry (incl.
reverse directions, converting empty/building tiles, to-kinds ≤4 not in
tables) rejected without mutation; 5-9 placement on empty land succeeds
per kind; 5-9 onto ANY occupied tile rejected (both directions tested:
street onto QuietStreet, QuietStreet onto street); REQUIRED rewrite of
the old fence tests preserving no-merge/no-crossing properties; FROZEN
suites untouched; conversions don't disturb adjacent parcels' frontage
(placed parcel on a street, convert street→QuietStreet, agreement clean).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Frontage reconciliation
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:** `parcelTouchesRoad` internal check → `transportCategory(k)
=== 1`. (QuietStreet=7 is category road; BikePath/Promenade/rail kinds
are not.)
**Tests (RED):** QuietStreet-fronted parcel → true; Promenade/BikePath-
fronted → false (pedestrian/bike are not road frontage); all existing
frontage tests pass UNCHANGED; integration: parcel fronting a street,
street converted to QuietStreet → still fronted.
**Validation:** `npx vitest run`

### Task 3: Tool system (pure)
**Files:** `src/tools/tools.ts`, `tests/tools/tools.test.ts`,
`tests/architecture.test.ts` (scan src/tools)
**Approach:**
```ts
type ToolId = 'inspect' | 'bulldoze' | `build-${number}` | `convert-${number}`;
interface ToolDef {id, name, hotkey?, cost, kind?, footprint?: {w,h}}
BUILD_COSTS: per-kind table (parcels 8-30 by footprint/kind tier;
  transport 3-6/tile; conversions 2-4/tile; bulldoze 1)
availableTools(tech): ToolDef[]  // inspect+bulldoze always; build-K per
  granted kind (footprints: parklet 1x1, garden 1x1..2x2 → fixed per kind
  table; transit kinds → transport tools; conversion tools appear when
  their TARGET kind is granted)
previewTool(world, tech, tool, x, y): {valid, reason?}   // pure, no mutation
applyTool(world, tech, tool, x, y): {ok, reason?}        // validates incl.
  effort, debits via spendEffort, calls single-writers (placeParcel/
  placeTransport/convertTransport/demolishParcel/demolishTransportAt)
```
Inspect: applyTool returns info without mutation (and without cost).
**Tests (RED):** availableTools across an unlock sequence (parklets unlock
→ build-48 appears; streetcar-revival → convert-6 + build-6); preview
never mutates (hashWorld + tech snapshot byte-equal before/after, valid
AND invalid cases); apply: exact cost debit, insufficient-effort
rejection (no mutation), each tool family routes to the right
single-writer (build parcel/transport, convert, bulldoze parcel +
transport), determinism ((world,tech,action) replayed on a regenerated
world → identical hashWorld); agreement sweep clean after a scripted
mixed sequence; inspect free + non-mutating.
**Validation:** `npx vitest run`

### Task 4: builtRenderKey + atlas extension + preview overlay
**Files:** `src/ui/renderKey.ts`, `tests/ui/renderKey.test.ts`,
`src/ui/renderer.ts`, `tests/architecture.test.ts` (allowlist)
**Approach:** `builtRenderKey(kind, mask, condTier): string` — total over
all placeable kinds: transport → category-keyed sets (`road-{k}-{m}`,
`rail-{m}`, `streetcar-{m}`, `elev-{m}`, `bike-{m}`, `ped-{m}`),
buildings → `b-{kind}-{pos}-{tier}` (existing scheme). Renderer: dispatch
:334 replaced by the seam; atlas builder adds the new transport tile sets
+ BUILDING_STYLES 48-60 (solarpunk palette: parklet/garden greens, solar
blues, compost browns, commons warm sandstone, bazaar textiles);
`setPreview(tiles|null)` + translucent tint pass (green valid / red
invalid) after built rendering.
**Tests (RED):** renderKey totality sweep — for every kind in BuiltKind
(except None) × all 16 masks × both tiers, the key is non-empty AND a
generated-atlas membership test (export the atlas key list builder as a
pure function or assert renderKey outputs ⊆ enumerated key space);
deterministic; allowlist green. Renderer drawing stays the untested thin
shell.
**Validation:** `npx vitest run`

### Task 5: Toolbar content (pure) + dock shell + input + wiring
**Files:** `src/ui/toolbarContent.ts`, `tests/ui/toolbarContent.test.ts`,
`src/ui/toolbar.ts`, `src/ui/input.ts`, `src/main.ts`, `index.html`,
`tests/architecture.test.ts` (allowlist)
**Approach:** content: `toolbarRows(tools, toolState, effort)` →
{id, label `Name · cost`, selected, affordable}; shell `mountToolbar`
(zero game imports; deps {getRows, onSelect}); input: click-vs-drag
(<5px), hover preview recompute on tile change, line drag for transport,
Escape deselects, hotkeys (i/x for inspect/bulldoze); main wiring: tool
state, preview → renderer.setPreview, apply → dirty + panelDirty.
**Tests (RED):** toolbarContent states across selection/afford changes;
input/dock are thin shells (lead browser pass); smoke headless safety.
**Validation:** `npx vitest run`; `npm run build`

### Task 6: Docs
**Files:** `README.md`
**Approach:** Tools section: dock, hotkeys, conversions-as-road-diets,
effort costs, what bulldoze does. **Validation:** suite green.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev   # lead: unlock→tool→place→convert→bulldoze→tints→pan/drag
```

## 5. Rollback Plan

Branch revert. Fabric changes are additive (new functions) plus the fence
swap and frontage internal change — both covered by rewritten/extended
tests; frozen suites prove classic behavior intact. No persistence.

## 6. Uncertainty Log

- **Conversion table contents** are design calls (avenue→street as "road
  diet" narrowing; highway→avenue as the boulevard reversal); cheap to
  amend — they're data + per-entry tests.
- **Costs** are placeholder economy values; balancing later.
- **Line-drag UX** (axis-major straight line) is v1; freeform paths later.
- **Inspect surface** minimal (dock line); full inspector panel later.
- **Inspect as applyTool** is a slight modeling stretch (non-mutating
  "tool") — kept for uniform input handling; revisit if it grows.
