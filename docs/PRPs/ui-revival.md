# PRP: UI Revival

## Source PRD: docs/PRDs/ui-revival.md
## Date: 2026-06-15

## 1. Context Summary

Make the game playable and discoverable. Kill the click-eating dock/panel
rebuild (keyed reconciliation + delegated click), refresh DOM only on
visible change (pure signature gating), Safari-proof the pan (explicit
deltas + guarded capture), and surface the keyboard-only depth as dock
meta-buttons [Tech][Eco][Civic] + an unlock flash. `src/ui` + `main.ts` +
`index.html` only; no game-logic changes.

## 2. Codebase Analysis

(Verified at branch HEAD off `main`.)

- **The bug** — `src/main.ts:342-345`: `if (tech.effort !== lastEffort) {
  toolbar.refresh(); lastEffort = tech.effort; }` in the rAF `frame`.
  Effort accrues every `SIM_TICK_MS = 100` (`main.ts:50`, `accrue` in the
  composite tick), so this fires ~10×/s. `toolbar.refresh` is `render`
  (`toolbar.ts:71`), which calls `tools.replaceChildren()` (`toolbar.ts:46`)
  then recreates every `<button>` with a fresh `addEventListener('click',…)`
  (`toolbar.ts:48-54`). The tech panel mirrors it: `main.ts:311` sets
  `panelDirty = true` every tick while open; `main.ts:338-341` calls
  `techPanel.refresh()` → `render` (`techPanel.ts:62`) →
  `columnsEl.replaceChildren()` (`techPanel.ts:65`), rebuilding every node +
  its click listener (`techPanel.ts:98`).
- **Toolbar shell** — `src/ui/toolbar.ts`: `mountToolbar` returns
  `{refresh, setStatus}`; rows arrive via `deps.getRows()` (assembled in
  `main.ts:149` from `toolbarRows(availableTools(tech), selectedToolId,
  tech.effort)`); selection via `deps.onSelect(id)`. `status` is a sibling
  of `tools`, untouched by row rebuilds (keep that).
- **Tech panel shell** — `src/ui/techPanel.ts`: `mountTechPanel` returns
  `{isOpen, refresh}`; binds its own `window` keydown routed through
  `shouldTogglePanel(key, deps.isOverlayActive())` (`techPanel.ts:116`);
  `render` writes `header.textContent = content.effort` (`techPanel.ts:64`)
  then rebuilds columns. Add `toggle()` to the handle for the dock button.
- **Pure row model** — `src/ui/toolbarContent.ts`: `ToolbarRow {id, label,
  selected, affordable}`, `toolbarRows(...)`. Add `refreshSignature(rows)`
  and `addedIds(prev, next)` here.
- **Pure node model** — `src/ui/techContent.ts`: `BranchColumn {title,
  nodes: NodeView[]}`, `NodeView` has `id`, `status`
  ('locked'|'affordable'|'unlocked'), `name`, `cost`, `flavor`, `missing`.
  `shouldTogglePanel(key, overlayActive)` (`:100`). Add
  `panelSignature(columns)`.
- **Overlay gates (reuse, do not duplicate)** — `src/ui/civicOverlayContent.ts`:
  `compositeKeyFor(key, openingActive)` (`:103`) and `cycleComposite(state,
  pressed)` (`:88`) already drive E/C from `main.ts:221-235`. The dock Eco/
  Civic buttons must call a shared closure wrapping the SAME body (extract
  `main.ts:221-235` into `cycleOverlay(kind: OverlayKind)` and have both the
  keydown and the buttons call it). Tech via `shouldTogglePanel` /
  `techPanel.toggle()`.
- **Input** — `src/ui/input.ts:81` `camera.pan(e.movementX, e.movementY)`
  inside the drag branch; `setPointerCapture` `:55`, `releasePointerCapture`
  `:61`. `camera.pan(dxScreen, dyScreen)` takes screen-pixel deltas
  (`camera.ts`), so explicit `lastX/lastY` deltas drop in directly.
- **Allowlist** — `tests/architecture.test.ts:86-94` `PURE_UI_ALLOWLIST`
  array; append `'src/ui/dockContent.ts'`. (Fail-open: the append is
  mandatory or the new module is unguarded.)
- **CSS hooks** — `index.html`: `.toolbar` `:175`, `.toolbar-tools` `:193`,
  `.toolbar-tool` `:209` (+ `-selected` `:224`, `-unaffordable` `:229`),
  `.tech-node-*` `:135-167`. Add `.toolbar-meta` row + `.toolbar-tool-flash`
  (or `.toolbar-flash`) animation alongside.
- **Test env** — vitest; existing ui pure tests in `tests/ui/*.test.ts`.
  jsdom is available for a focused reconcile-identity DOM test if used.
- **Conventions**: TDD per task; atomic commits ≤72-char subject + the
  `Co-Authored-By: Claude Fable 5` trailer; pure logic tested, DOM shells
  thin (manual/live). No transcendental Math / DOM in allowlisted modules.

**Execution mechanics:** full team pipeline (`/review-plan-team` →
`/execute-team`); the team lead owns the live browser pass in **Safari AND
Chromium** and the `.dialectic-tier` strip before merge.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Pure signature + diff helpers (toolbarContent)
**Files:** `src/ui/toolbarContent.ts`, `tests/ui/toolbarContent.test.ts`
**Approach:** `refreshSignature(rows: ToolbarRow[]): string` =
`rows.map(r => `${r.id}:${r.selected ? 1 : 0}:${r.affordable ? 1 : 0}`).join('|')`
(ids included → unlock growth changes it). `addedIds(prev: readonly
string[], next: readonly string[]): string[]` = ids in `next` not in
`prev`, order of `next`.
**Tests (RED):** signature stable on equal rows; changes on affordability
flip, on selection change, on id-set growth (the unlock case, explicit);
addedIds empty when equal, returns the new id(s) on growth, ignores
removals.
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Pure panel signature (techContent)
**Files:** `src/ui/techContent.ts`, `tests/ui/techContent.test.ts`
**Approach:** `panelSignature(columns: BranchColumn[]): string` over each
node's `${id}:${status}` (NOT the effort header). Order-stable.
**Tests (RED):** stable on equal columns; changes when a node's status
flips (locked→affordable); identical for two column sets that differ only
in the effort header context (i.e. the function never sees the header — pin
that it depends only on node id+status).
**Validation:** `npx vitest run`

### Task 3: Toolbar keyed reconciliation + delegated click
**Files:** `src/ui/toolbar.ts`
**Approach:** keep one `<button>` per row keyed by `data-tool-id`. `render`
becomes a reconcile: build/refresh a `Map<id, HTMLButtonElement>`; for each
row, reuse the existing button (update `textContent`, toggle
`toolbar-tool-selected`/`toolbar-tool-unaffordable` via `classList.toggle`)
or create it; remove buttons whose id is gone; reorder by appending in row
order (cheap; DOM append moves existing nodes). ONE delegated
`tools.addEventListener('click', e => { const el =
(e.target as HTMLElement).closest('[data-tool-id]'); if (el)
deps.onSelect(el.dataset.toolId!); })` bound once at mount, NOT per render.
**Tests:** none (thin shell) — covered by the reconcile-identity test in
Task 7 if used, and the live pass.
**Validation:** `npx tsc --noEmit`; `npm run build`

### Task 4: Tech-panel keyed reconciliation + delegated click + toggle()
**Files:** `src/ui/techPanel.ts`
**Approach:** split `render` into `renderHeader()` (just
`header.textContent = content.effort`) and `renderColumns()` (keyed
reconcile by `data-node-id`: reuse node divs, update name/flavor/missing
text + `tech-node-${status}` class + `tech-node-clickable` toggle; columns
themselves keyed by title). ONE delegated `columnsEl` click listener
dispatching via `closest('[data-node-id]')` → `if (deps.onUnlock(id))
renderColumns()`. Add `toggle()` to the handle (sets open = !open) and a
`refreshHeader()` for the per-tick cheap update. Keep the keydown→
`shouldTogglePanel` path; `toggle()` shares the `setOpen` body.
**Tests:** none (thin shell); live pass.
**Validation:** `npx tsc --noEmit`

### Task 5: dockContent pure module + allowlist
**Files:** `src/ui/dockContent.ts` (new),
`tests/ui/dockContent.test.ts` (new), `tests/architecture.test.ts`
**Approach:** `MetaButton {id: 'tech'|'eco'|'civic', label: string, active:
boolean}`; `metaButtons(panelOpen: boolean, activeOverlay: {kind:
'eco'|'civic'} | null): MetaButton[]` → Tech active iff panelOpen, Eco
active iff overlay kind 'eco', Civic iff 'civic'. Append
`'src/ui/dockContent.ts'` to `PURE_UI_ALLOWLIST`.
**Tests (RED):** labels fixed ("Tech (T)" etc.); active flags track inputs
(panel open → tech active; eco overlay → eco active, others not; null → none);
guard scans the file (architecture suite passes).
**Validation:** `npx vitest run`

### Task 6: main.ts wiring — signature gating + shared overlay closure + meta buttons
**Files:** `src/main.ts`
**Approach:**
- Replace `lastEffort` gating (`main.ts:294, 342-345`) with
  `lastToolSig`: each frame compute `sig = refreshSignature(rows)`; refresh
  only when it changes. Track `prevToolIds`; when the id set grows
  (`addedIds` non-empty) trigger the dock flash (add a class, remove after
  timeout).
- Panel: keep `panelDirty` but split — each tick while open call
  `techPanel.refreshHeader()` (cheap); compute `panelSignature(columns)`
  and call the full `techPanel.refresh()` only when it changes.
- Extract `main.ts:221-235` body into `cycleOverlay(kind: OverlayKind)`;
  the keydown calls `compositeKeyFor(...)` then `cycleOverlay(kind)`; the
  dock Eco/Civic buttons call `cycleOverlay('eco'|'civic')`; the Tech
  button calls `techPanel.toggle()`. After any of these, refresh the meta
  buttons' active state.
- Mount the meta-button row via the toolbar (pass `metaButtons` deps), or a
  small sibling element — keep it in the toolbar shell so it shares the dock.
**Tests:** none (wiring); covered by pure tests + live pass.
**Validation:** `npx tsc --noEmit`; `npm run build`

### Task 7: Safari-proof input + (optional) reconcile-identity DOM test
**Files:** `src/ui/input.ts`, optionally
`tests/ui/reconcile.test.ts` (jsdom)
**Approach:** in `attachInput`, track `lastX/lastY`; set on `pointerdown`;
in the drag branch of `pointermove` compute `dx = e.offsetX - lastX; dy =
e.offsetY - lastY; camera.pan(dx, dy); lastX = e.offsetX; lastY = e.offsetY`
(replacing `e.movementX/Y` at `:81`). Wrap `setPointerCapture` (`:55`) and
`releasePointerCapture` (`:61`) in try/catch. If a reconcile-identity test
is included: mount the toolbar in jsdom, refresh with unchanged rows, assert
the same button reference persists; refresh with a grown id set, assert a
node added without disturbing existing references.
**Tests:** the optional jsdom identity test (RED first if included).
**Validation:** `npx vitest run`

### Task 8: CSS + docs
**Files:** `index.html`, `README.md`
**Approach:** `.toolbar-meta` row styling (sits in the dock with the tool
row), `.toolbar-tool-flash` keyframe (~1s, meadow-gold pulse). README: note
the dock buttons + T/E/C equivalence and that the dock surfaces unlocks.
**Validation:** `npx vitest run`; `npm run build`; live pass.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev   # lead: SAFARI + CHROMIUM — click every dock tool + tech node
              # repeatedly during effort accrual (no dropped clicks); T/E/C as
              # keys AND buttons; unlock flash; pan via drag; zoom.
```

## 5. Rollback Plan

Additive/behavioral within `src/ui` + `main.ts` + `index.html`; no engine,
schema, or persistence surface. Revert = don't merge; reverting the branch
restores the prior (broken-button) behavior exactly.

## 6. Uncertainty Log

- **Reconcile reorder cost** is negligible at dock/panel sizes; if a future
  huge node list shows churn, key columns and skip untouched ones — not now.
- **jsdom identity test** vs. live-only: the PRP includes it as optional;
  if jsdom's `closest`/`dataset` behaves, keep it (cheap regression lock);
  if it fights the thin-shell convention in review, drop to live-pass-only —
  the pure helpers carry the testable contract either way.
- **Flash timing** is cosmetic, tuned live.
- **Safari `offsetX/offsetY`** are well-supported (unlike `movementX/Y`);
  the explicit-delta approach relies only on `offsetX/Y`, which the hover
  path already uses successfully.
