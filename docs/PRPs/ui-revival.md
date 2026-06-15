# PRP: UI Revival

## Source PRD: docs/PRDs/ui-revival.md
## Date: 2026-06-15

## 1. Context Summary

Make the game playable and discoverable. Kill the click-eating dock/panel
rebuild (a PURE reconcile-plan + apply-only shells + a delegated click bound
once at mount), refresh DOM only on visible change (pure signature gating,
evaluated at the sim cadence not per rAF frame), Safari-proof the pan
(clientX/Y deltas + guarded capture), and surface the keyboard-only depth as
dock meta-buttons [Tech][Eco][Civic] + an unlock flash. `src/ui` + `main.ts`
+ `index.html` only; no game-logic changes.

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
  of `tools`, untouched by row rebuilds (keep that). Extend `ToolbarDeps` with
  `getMetaButtons()`/`onMeta(id)` and `ToolbarHandle` with `refreshMeta()`/
  `flash()` for the meta row + unlock flash (Task 4).
- **Tech panel shell** — `src/ui/techPanel.ts`: `mountTechPanel` returns
  `{isOpen, refresh}`; binds its own `window` keydown routed through
  `shouldTogglePanel(key, deps.isOverlayActive())` (`techPanel.ts:116`) →
  `setOpen` (`:109-113`); `render` writes `header.textContent = content.effort`
  (`techPanel.ts:64`) then rebuilds columns. Add `toggle()` to the handle (dock
  button) + `refreshHeader()`, and an `onToggle?(open)` dep fired INSIDE
  `setOpen` so key + button + dismiss all notify the host (Task 5 / Y3).
- **Pure row model** — `src/ui/toolbarContent.ts`: `ToolbarRow {id, label,
  selected, affordable}`, `toolbarRows(...)`. Add `refreshSignature(rows)`,
  `addedIds(prev, next)`, and `toolbarToolClass(row)` (the full className) here.
- **Pure node model** — `src/ui/techContent.ts`: `BranchColumn {branch, title,
  nodes: NodeView[]}`, `NodeView` has `id`, `status`
  ('locked'|'affordable'|'unlocked'), `name`, `cost`, `flavor`, `missing`.
  `shouldTogglePanel(key, overlayActive)` (`:100`). Add `panelSignature(columns)`
  and `techNodeClass(node)` (the full className) here.
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
  (`camera.ts`), so explicit `lastClientX/lastClientY` deltas drop in directly
  (clientX/Y, not offset — capture-stable; Task 8 / Y4). `offsetX/Y` stays for
  the non-captured `tileUnder`/click-classification paths (`:64`, `:94`).
- **Allowlist** — `tests/architecture.test.ts:86-94` `PURE_UI_ALLOWLIST`
  array; append `'src/ui/reconcile.ts'` (Task 3) and `'src/ui/dockContent.ts'`
  (Task 6). (Fail-open: each append is mandatory or the new module is
  unguarded.) `toolbarToolClass`/`techNodeClass` live in the already-listed
  `toolbarContent.ts`/`techContent.ts`, so they are already guarded.
- **CSS hooks** — `index.html`: `.toolbar` `:175`, `.toolbar-tools` `:193`,
  `.toolbar-tool` `:209` (+ `-selected` `:224`, `-unaffordable` `:229`),
  `.tech-node-*` `:135-167`. Add `.toolbar-meta` row + `.toolbar-meta-active`
  + `.toolbar-tool-flash` animation alongside (Task 9).
- **Test env** — vitest with `vite.config.ts` pinned to `environment: 'node'`
  (no jsdom/happy-dom installed, and none is added). The defining regression
  is locked WITHOUT a DOM env by extracting the reconcile DECISION into a pure
  module `src/ui/reconcile.ts` (`reconcilePlan`) and the class derivation into
  pure `toolbarToolClass`/`techNodeClass`, all node-env unit-tested like the
  engine. The thin DOM shells (`toolbar.ts`/`techPanel.ts`) only APPLY the
  plan. Delegated-click-survival is an inherently browser property left to the
  Safari+Chromium live pass — but it is now structurally GUARANTEED, not
  hoped: the delegated listener is bound ONCE at mount and reconcile preserves
  node identity (no-delta plan → no recreate), so buttons are never rebuilt
  ~10×/s and a click can't land on a detached node. Existing ui pure tests
  live in `tests/ui/*.test.ts`.
- **Conventions**: TDD per task; atomic commits ≤72-char subject + the
  `Co-Authored-By: Claude Fable 5` trailer; pure logic tested in the node env
  (signatures, addedIds, reconcilePlan, class strings, metaButtons); DOM
  shells stay thin (apply-the-plan), confirmed by the live pass. No
  transcendental Math / DOM in allowlisted modules.

**Execution mechanics:** full team pipeline (`/review-plan-team` →
`/execute-team`); the team lead owns the live browser pass in **Safari AND
Chromium** and the `.dialectic-tier` strip before merge.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Pure toolbar helpers (toolbarContent)
**Files:** `src/ui/toolbarContent.ts`, `tests/ui/toolbarContent.test.ts`
**Approach:**
- `refreshSignature(rows: ToolbarRow[]): string` =
  `rows.map(r => `${r.id}:${r.selected ? 1 : 0}:${r.affordable ? 1 : 0}`).join('|')`
  (ids included → unlock growth changes it).
- `addedIds(prev: readonly string[], next: readonly string[]): string[]` =
  ids in `next` not in `prev`, in `next` order.
- `toolbarToolClass(row: ToolbarRow): string` = the FULL className the shell
  sets wholesale — `'toolbar-tool'`, plus `' toolbar-tool-selected'` iff
  `selected`, plus `' toolbar-tool-unaffordable'` iff `!affordable`. (Pure
  className so the shell can do `el.className = toolbarToolClass(row)` and drop
  stale classes by construction — no bare `classList.toggle` flip footgun.)
**Tests (RED):** signature stable on equal rows; changes on affordability
flip, selection change, id-set growth (the unlock case, explicit); addedIds
empty when equal, returns the new id(s) on growth, ignores removals;
toolbarToolClass = base when not-selected & affordable, adds `-selected` when
selected, `-unaffordable` when `!affordable`, both when selected & unaffordable.
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Pure tech helpers (techContent)
**Files:** `src/ui/techContent.ts`, `tests/ui/techContent.test.ts`
**Approach:**
- `panelSignature(columns: BranchColumn[]): string` over each node's
  `${id}:${status}` (NOT the effort header). Order-stable.
- `techNodeClass(node: NodeView): string` = the FULL className the shell sets
  wholesale — `'tech-node tech-node-${status}'`, plus `' tech-node-clickable'`
  iff `status === 'affordable'`. (Same wholesale-className discipline as the
  toolbar: setting `el.className` drops a stale `tech-node-locked`/`-affordable`
  + `tech-node-clickable` when status flips, by construction.)
**Tests (RED):** panelSignature stable on equal columns; changes when a node's
status flips (locked→affordable); never sees the effort header (depends only
on node id+status); techNodeClass for each status — locked/unlocked omit
`tech-node-clickable`, affordable includes it, and the `tech-node-${status}`
segment matches the status.
**Validation:** `npx vitest run`

### Task 3: reconcilePlan pure module + allowlist
**Files:** `src/ui/reconcile.ts` (new), `tests/ui/reconcile.test.ts` (new),
`tests/architecture.test.ts`
**Approach:** extract the reconcile DECISION into a pure, node-env module so
the defining regression is an automated contract, not a jsdom/manual hope.
`reconcilePlan(prevIds: readonly string[], rows: readonly { id: string }[]):
{ order: string[]; insert: string[]; remove: string[] }` — `order` = the ids
in `rows` order; `insert` = ids in `rows` not in `prevIds` (nodes the shell
must create); `remove` = ids in `prevIds` not in `rows` (nodes the shell must
delete). Pure, deterministic, no DOM. Append `'src/ui/reconcile.ts'` to
`PURE_UI_ALLOWLIST`.
**Tests (RED first — the automated lock on the "defining regression"
decision):** unchanged ids → `insert`/`remove` empty, `order` == ids (the
IDENTITY case: the shell recreates nothing); a row whose affordability/
selection changed but whose id is unchanged → still `insert`/`remove` empty
(reconcilePlan keys ONLY on id, so a visual-only change causes NO structural
churn); id-set growth → `insert` == exactly the new ids, `order` includes them
in row order; removal → `remove` == exactly the gone ids; reorder (same id set,
new order) → `insert`/`remove` empty and `order` reflects the new order; plus
the architecture suite passes (guard scans the new file).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 4: Toolbar shell — apply plan + delegated click + meta row + flash
**Files:** `src/ui/toolbar.ts`
**Approach:** `render` becomes APPLY-the-plan over a persistent
`Map<id, HTMLButtonElement>`: compute `reconcilePlan(prevIds, rows)`; for each
`remove` id delete the node + drop it from the Map; for each `insert` id
`createElement` a `<button>` (set `dataset.toolId`, add to Map); for EVERY row
set `el.className = toolbarToolClass(row)` (wholesale — drops stale classes)
and `el.textContent = row.label`; then re-append children in `order` (`append`
MOVES existing nodes, preserving identity + any in-flight click —
`availableTools` is monotonically growing + ascending-ordered, so mid-list
insert/reorder is the real case, removal only defensive). On a no-delta plan
NOTHING is recreated: the Map is reused (RESIDUAL #1 — the shell never recreates
a node whose id is unchanged). ONE delegated `tools.addEventListener('click',
e => { const el = (e.target as HTMLElement).closest('[data-tool-id]'); if (el)
deps.onSelect(el.dataset.toolId!); })` bound once at mount, NOT per render.
- **Meta row (Y6 — lives INSIDE the toolbar shell):** add a `meta` element to
  the dock (sibling of `tools`/`status`). Extend `ToolbarDeps` with
  `getMetaButtons(): MetaButton[]` and `onMeta(id: 'tech'|'eco'|'civic'): void`;
  extend `ToolbarHandle` with `refreshMeta(): void` and `flash(): void`.
  `refreshMeta` rebuilds/updates the meta buttons (set `dataset.metaId`,
  wholesale className applying a `toolbar-meta-active` class from
  `MetaButton.active`). A SECOND delegated listener on `meta` dispatches via
  `closest('[data-meta-id]')` → `deps.onMeta(id)`. `flash()` adds
  `toolbar-tool-flash` to the dock and removes it after a timeout (the DOM +
  timer stay in the shell, off the host).
**Tests:** none (thin shell, apply-only) — structural correctness is the pure
`reconcilePlan` test (Task 3), className correctness the pure `toolbarToolClass`
test (Task 1), meta active-state the pure `metaButtons` test (Task 6);
delegated click-survival is the named live pass (structurally guaranteed by
listener-once + identity-preserving reconcile, per §2).
**Validation:** `npx tsc --noEmit`; `npm run build`

### Task 5: Tech-panel shell — apply plan + delegated click + toggle() + onToggle
**Files:** `src/ui/techPanel.ts`
**Approach:** split `render` into `renderHeader()` (just
`header.textContent = content.effort`) and `renderColumns()`. The tech tree's
node SET is static (`branchColumns` maps every node regardless of status — only
`status` flips), so the 7 columns + their nodes are built once into a
`Map<nodeId, HTMLDivElement>`; `renderColumns()` REUSES that Map and per node
sets `el.className = techNodeClass(node)` (wholesale — drops the stale
`tech-node-${old}` + `tech-node-clickable`) and updates name/flavor text. No
structural churn is possible (static set → `reconcilePlan` would return empty
`insert`/`remove`); node identity is preserved by construction (RESIDUAL #1).
- **Full sub-structure reconciled to the NodeView each apply (Y8 — sub-element
  staleness under the build-once Map):** the wholesale-className move clears
  stale CLASSES; apply the SAME principle one level down — on EVERY apply,
  bring the reused node's full sub-structure (name / flavor / `tech-node-missing`
  / clickable) into line with the current `NodeView`, leaving NO stale children.
  The "Needs: …" line is a CONDITIONAL child (currently created only when
  `n.missing.length > 0`, techPanel.ts:89-94): CREATE it if the missing list is
  non-empty and the element is absent, UPDATE its text if present, and REMOVE it
  when the missing list empties — the community-gardens / community-ai-nodes
  multi-prereq case, where the last prereq unlocks and `missing` goes to `[]`.
  Otherwise a stale "Needs: …" ghost survives the unlock. This is a shell-
  application clause covered by the same node-update path (no new test). ONE delegated `columnsEl` click listener via
`closest('[data-node-id]')` → `if (deps.onUnlock(id)) renderColumns()`
(`onUnlock` guards non-affordable, so a locked/unlocked click is a safe no-op;
each node carries `dataset.nodeId`). Add `toggle()` to the handle
(`setOpen(!open)`) and `refreshHeader()` for the per-tick cheap update. Keep
the keydown→`shouldTogglePanel` path; `toggle()` shares `setOpen`.
- **onToggle (Y3 — close the key/button/dismiss divergence at the source):**
  add `onToggle?(open: boolean): void` to `TechPanelDeps`, called INSIDE
  `setOpen` (techPanel.ts:109-113) so it fires for BOTH the internal `T`
  keydown path (techPanel.ts:115-122) AND the new `toggle()` button path. main
  wires it to `toolbar.refreshMeta()` — so the [Tech] meta active-state can't
  drift whether the panel was toggled by key, button, or any future dismiss,
  and that refresh stays OFF the rAF frame (Y5).
**Tests:** none (thin shell, apply-only) — `techNodeClass` (Task 2) pins the
status className including stale-class clearing; `panelSignature` (Task 2) pins
the gate; the live pass confirms click + toggle.
**Validation:** `npx tsc --noEmit`

### Task 6: dockContent pure module + allowlist
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

### Task 7: main.ts wiring — sim-gated signatures + shared overlay closure + meta
**Files:** `src/main.ts`
**Approach:**
- **Sim-cadence gating (Y5 — NOT per rAF frame):** effort/grants/selection
  change only on the 100ms sim tick (`SIM_TICK_MS = 100`) + on discrete tool
  actions, but the `frame` rAF runs ~60Hz. So have the sim tick
  (`main.ts:308-329`) set a cheap `simChanged = true`; the `frame` callback
  recomputes `rows = toolbarRows(...)` + `refreshSignature` (and, while open,
  `branchColumns(...)` + `panelSignature`) ONLY when `simChanged`, then clears
  it — moving the heavy `availableTools`/`branchColumns` derivations to ~10Hz.
  Replace the O(1) `lastEffort` check (`main.ts:294, 342-345`) with
  `lastToolSig`/`lastPanelSig` string compares; `toolbar.refresh()` /
  `techPanel.refresh()` fire only when the signature actually changes.
- **Discrete events** (`onSelect` `:150`, `onHotkey` `:283`, the unlock-click
  path) already refresh directly; have them also update `lastToolSig`/
  `lastPanelSig` so the next sim-gated check doesn't redundantly refresh.
- **Unlock flash (Y7):** track `prevToolIds`, SEEDED from the initial
  `getRows()` id set at mount, so the first diff is empty and the dock does NOT
  flash on load. When a sim-gated check finds `addedIds(prevToolIds, nextIds)`
  non-empty, call `toolbar.flash()` and advance `prevToolIds`.
- **Panel:** while open, each tick call `techPanel.refreshHeader()` (cheap,
  in-place text); call the full `techPanel.refresh()` only when `panelSignature`
  changes (sim-gated as above).
- **Shared overlay closure:** extract `main.ts:221-235` body into
  `cycleOverlay(kind: OverlayKind)`; the keydown calls `compositeKeyFor(...)`
  then `cycleOverlay(kind)`; the dock Eco/Civic buttons (`onMeta('eco'|'civic')`)
  call `cycleOverlay(...)`; the Tech button (`onMeta('tech')`) calls
  `techPanel.toggle()`. After `cycleOverlay` (key OR button) call
  `toolbar.refreshMeta()`.
- **Meta wiring (Y6 + Y3):** pass `getMetaButtons: () => metaButtons(
  techPanel.isOpen(), activeOverlay && { kind: activeOverlay.kind })` and
  `onMeta` into the toolbar; wire `techPanel`'s `onToggle` →
  `toolbar.refreshMeta()` so the key-driven panel toggle refreshes the [Tech]
  active-state from ONE callback (no per-frame poll, no per-path bookkeeping —
  key == button == dismiss).
**Tests:** none (wiring) — meta active-state is pinned by the pure `metaButtons`
test (Task 6); reconcile/class by Tasks 1–3; key/button equivalence + flash +
sim-gating by the live pass.
**Validation:** `npx tsc --noEmit`; `npm run build`

### Task 8: Safari-proof input
**Files:** `src/ui/input.ts`
**Approach (Y4 — pan from clientX/clientY, which are capture-stable):** in
`attachInput`, track `lastClientX/lastClientY`; set them on `pointerdown`
(alongside the existing offset-based `downSx/downSy`). In the drag branch of
`pointermove` (`:79-90`) compute `dx = e.clientX - lastClientX; dy = e.clientY
- lastClientY; camera.pan(dx, dy); lastClientX = e.clientX; lastClientY =
e.clientY` — replacing `e.movementX/Y` (`:81`). `clientX/Y` are always
populated regardless of pointer capture, and pan needs only DELTAS (the canvas
origin cancels), so this sidesteps the WebKit offset-under-capture question
entirely (no non-sequitur "hover path proves it" — that path runs WITHOUT
capture). Keep `offsetX/offsetY` ONLY for `tileUnder` (hover/apply on non-drag
moves, `:94`) and the pointerup click classification (`:64`) — the existing
working non-captured path. Wrap `setPointerCapture` (`:55`) and
`releasePointerCapture` (`:61`) in try/catch.
**Tests:** none (thin shell) — the clientX/Y delta pan + capture-guard are a
NAMED live-pass check: drag-pan under capture specifically in Safari (the
condition PRD §1 concedes was never tested), plus Chromium.
**Validation:** `npx tsc --noEmit`

### Task 9: CSS + docs
**Files:** `index.html`, `README.md`
**Approach:** `.toolbar-meta` row styling (sits in the dock with the tool
row), `.toolbar-meta-active` (highlight for the active meta button,
palette-consistent with `.toolbar-tool-selected`), and a `.toolbar-tool-flash`
keyframe (~1s, meadow-gold pulse on the dock). README: note the dock buttons +
T/E/C equivalence and that the dock surfaces unlocks.
**Validation:** `npx vitest run`; `npm run build`; live pass.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
              # npx vitest run now includes the mandatory PURE reconcilePlan +
              # class-string + signature tests (node env, no jsdom) — the
              # automated lock on the "defining regression" decision.
npm run dev   # lead: SAFARI + CHROMIUM — click every dock tool + tech node
              # repeatedly during effort accrual (no dropped clicks); T/E/C as
              # keys AND buttons (incl. T-key vs Tech-button active-state
              # parity); unlock flash (NOT on load); drag-pan under capture in
              # Safari specifically (clientX/Y deltas); zoom.
```

## 5. Rollback Plan

Additive/behavioral within `src/ui` + `main.ts` + `index.html`; no engine,
schema, or persistence surface. Revert = don't merge; reverting the branch
restores the prior (broken-button) behavior exactly.

## 6. Uncertainty Log

- **Reconcile reorder cost** is negligible at dock/panel sizes; if a future
  huge node list shows churn, key columns and skip untouched ones — not now.
- **Reconcile correctness is a PURE node-env contract, no jsdom** (resolved
  in review, team-lead ruling): rather than add a jsdom devDep, the reconcile
  DECISION lives in `reconcilePlan` (Task 3) and the className derivation in
  `toolbarToolClass`/`techNodeClass` (Tasks 1–2), all node-env tested. The
  thin shells only APPLY the plan. This dissolves the false "jsdom is
  available" claim AND makes the defining regression's decision an automated,
  deterministic contract. Node IDENTITY (no-delta → no recreate) and
  STALE-CLASS clearing (wholesale `el.className`) are guaranteed by
  construction in the apply step; delegated-click-survival stays a named live
  property (structurally guaranteed by listener-once + identity-preserving
  reconcile, so the live pass confirms rather than solely guards).
- **Flash timing** is cosmetic, tuned live; `prevToolIds` is seeded at mount
  so it never fires on load (Task 7).
- **Safari pan uses `clientX/clientY` deltas, not `offsetX/offsetY`** (Y4):
  during a pan, pointer capture IS active, and WebKit's offset-under-capture
  behavior is the exact untested risk; `clientX/Y` are capture-stable and
  pan needs only deltas (origin cancels). `offsetX/Y` are kept solely for the
  non-captured `tileUnder`/click-classification paths that already work.
  Verified in the named Safari live check; no headless coverage (inherently
  a browser/pointer-capture property).
