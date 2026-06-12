# PRD: Build Tools

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/build-tools

## 1. Problem Statement

Healing is still a noun. The tech tree (PR #5) grants kinds and
capabilities, but no mechanism places them: the player can unlock Parklets
and watch effort accrue, and that is all. Three deferred changes are
contractually coupled to this feature (docs/PRPs/tech-tree.md Task 1
coupling note): the capacity-safe replacement for the kinds 5-9 placement
fence, the renderer's kind-dispatch extension, and the frontage
reconciliation for QuietStreet. This feature delivers the game's core verb
— build, convert, bulldoze — through the engine's single-writer discipline,
paid for in communal effort.

The thematic heart: **road diets are conversions, not demolitions.** A
street becomes a quiet street, an avenue narrows, a highway comes down to
a boulevard, old rail hums back as streetcar — transformation, not
clearance. The opposite of the Moses century, mechanically.

## 2. Proposed Solution

1. **Transport conversion** (`convertTransport`, new fabric single-writer):
   an explicit conversion table — street→{quiet street, promenade, bike
   path}, avenue→{street, quiet street} (the road diet), highway→{avenue}
   (the boulevard reversal), rail→{streetcar} (the revival). Conversions
   transform in place; nothing is demolished. The kinds 5-9 fence is
   replaced: new transit becomes placeable on empty land (no merges, no
   crossings for 5-9 in v1); the classic 1-4 `max(kind)` junction merge is
   untouched (frozen tests stay frozen).
2. **Tool system** (`src/tools/`, pure, guard-scanned): `availableTools`
   derived from tech grants (+ always: inspect, bulldoze);
   `previewTool(world, tech, tool, x, y)` → valid/invalid + reason
   (no mutation); `applyTool` → spends effort per a cost table (bulldoze
   cheapest; gift-economy framing — building is communal effort given),
   then calls fabric single-writers only. Deterministic functions of
   (world, tech, action).
3. **Renderer extension**: pure `builtRenderKey(kind, mask, condTier)`
   seam (allowlisted); atlas grows bike/pedestrian transport tiles,
   streetcar/elevated variants, and building styles 48-60 in a solarpunk
   palette (parklet greens, garden beds, solar blues, warm commons);
   hover preview tint (valid green / invalid red) over the targeted
   tile(s).
4. **Frontage reconciliation**: `parcelTouchesRoad` moves to
   category-road (QuietStreet counts as frontage), with classic-behavior
   regression guards.
5. **Toolbar UI** (thin shell + pure content, established pattern):
   always-on bottom dock listing unlocked tools with costs; click to
   select, Escape deselects, hotkeys for inspect/bulldoze; click on map
   applies (small-movement click vs. drag-pan disambiguation); newly
   unlocked kinds appear as the tree grants them.

## 3. Architecture Impact

- **New**: `src/tools/tools.ts` (+tests; guard-scanned dir),
  `src/ui/toolbarContent.ts` (pure, allowlisted), `src/ui/toolbar.ts`
  (shell), `src/ui/renderKey.ts` (pure, allowlisted).
- **Modified**: `src/engine/fabric.ts` (conversion table +
  `convertTransport`; fence replacement in `canPlaceTransport`;
  `parcelTouchesRoad` category-frontage), `src/ui/renderer.ts` (dispatch
  via renderKey + new tiles + preview overlay), `src/ui/input.ts`
  (click-apply vs drag-pan), `src/main.ts` (tool state wiring),
  `index.html` (dock styles), `tests/architecture.test.ts` (scan
  src/tools; allowlist additions).
- **Data model**: ToolState (small, pure); BUILD_COSTS table in tools.
- **Dependencies**: none added.

## 4. Acceptance Criteria

1. Gates green; guard scans `src/tools`; frozen fabric suites byte-
   unmodified; no DOM/transcendental Math outside ui shells.
2. Conversion table exactly as §2 (each entry tested both directions:
   allowed conversions succeed in place, everything else rejected);
   `convertTransport` is a single-writer beside the others; conversions
   never touch ParcelStore or demolish.
3. Kinds 5-9: placeable on empty land via the normal placement path;
   never merge; never cross roads/rail (rejected); classic 1-4 merge
   unchanged (frozen tests prove it).
4. `parcelTouchesRoad`: QuietStreet frontage counts; all pre-existing
   frontage tests pass unchanged; a converted street keeps its adjacent
   parcels road-fronted (integration test).
5. Tools: availableTools reflects grants exactly (inspect+bulldoze
   always; kind tools appear on unlock — tested across an unlock
   sequence); previewTool never mutates (hashWorld-equal before/after);
   applyTool spends the table cost exactly, rejects on insufficient
   effort, applies via single-writers only, and is deterministic
   ((world, tech, action) twice → identical hashWorld).
6. Bulldoze: removes parcels (tombstone path) and transport; cost
   charged; agreement sweep clean after mixed build/bulldoze sequences.
7. Renderer: `builtRenderKey` total over all placeable kinds × masks ×
   tiers (programmatic sweep — no kind renders as a missing atlas key);
   preview tint reflects previewTool validity.
8. Live browser pass (lead): unlock→tool appears→place a parklet on a
   bulldozed lot→effort drops; convert a street to a quiet street and
   see it re-render; bulldoze; invalid-target red tint; drag still pans;
   `?seed=` determinism unaffected.

## 5. Risk Assessment

- **The conversion table touches placement semantics adjacent to frozen
  behavior** — the byte-frozen suites are the guard; conversions live in
  a NEW function, not inside `placeTransport`'s merge path.
- **Input disambiguation** (click-apply vs drag-pan) is the riskiest UI
  change; a movement-threshold click detector is simple but needs the
  live pass.
- **Renderer totality**: a missing atlas key renders nothing silently —
  hence the programmatic totality sweep in tests.
- **Effort economy balance** is unknowable pre-playtest; costs are data,
  balancing is a later feature.
- **Scope**: condition repair, ecology effects, undo — all explicitly
  out; the dock stays one row of tools.

## 6. Open Questions

1. Should bulldozing a parcel refund anything? (Assume no — demolition
   is loss, framed gently; refunds invite exploit loops.)
2. Drag-to-paint transport lines? (Assume: simple line drag for
   transport only, point placement for parcels; rectangles out of scope.)
3. Inspect tool surface? (Assume: minimal — console-free floating line
   showing kind/condition/parcel info in the dock; full inspector later.)

## 7. Out of Scope

- Condition repair/renovation; ecology effects of new kinds; civic sim
- Undo/redo, save/load, sound, real sprite art, multi-tile rectangles
- Zoning modes, demand simulation, costs balancing pass
