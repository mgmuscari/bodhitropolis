# PRD: UI Revival

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-15
## Branch: feature/ui-revival

## 1. Problem Statement

The first playtest surfaced two blocking problems: **the dock buttons
don't respond**, and **the tech tree and overlays are invisible** because
they are keyboard-only and the player had no way to discover them. The game
ships eight features of depth that a player literally cannot reach.

Exploration found the exact cause of the dead buttons. Communal effort
accrues every 100ms sim tick; the render loop refreshes the dock whenever
effort changes (`main.ts:342`, `if (tech.effort !== lastEffort)
toolbar.refresh()`), and `toolbar.refresh()` is `render()`, which does
`tools.replaceChildren()` (`toolbar.ts:46`) — **destroying and recreating
every button roughly ten times a second**. A click that straddles a
rebuild lands on a detached node and is dropped. WebKit/Safari is least
forgiving of this, and every prior live pass ran in Playwright Chromium, so
it was never caught. The tech panel has the identical pattern: `panelDirty`
is set every tick while the panel is open (`main.ts:311`), driving a full
`render()` with `columnsEl.replaceChildren()` (`techPanel.ts:65`) — its
unlock nodes are rebuilt every 100ms too.

Two smaller issues ride along: pan uses `e.movementX/e.movementY`
(`input.ts:81`), which WebKit populates unreliably during pointer capture;
and the only ways to reach the tech tree / eco / civic overlays are the T,
E, and C keys, which a new player will never guess.

This is the first of four planned improvement features (ui-revival →
urban-density → rezoning → city-life). It must land first: the others are
invisible until the player can click.

## 2. Proposed Solution

1. **Stop destroying live buttons.** Replace the per-refresh
   `replaceChildren()` rebuild in `toolbar.ts` and `techPanel.ts` with
   **keyed reconciliation**: each entry carries a stable `data-tool-id` /
   `data-node-id`; a refresh updates label/classes/disabled on the existing
   nodes and only inserts or removes nodes when the id *set* changes. Add a
   single **delegated click listener** on each container that dispatches via
   `closest('[data-tool-id]')` / `[data-node-id]`, so a click is handled
   correctly even if a rebuild races it.
2. **Refresh only when something visible changed.** Pure
   signature helpers (`refreshSignature` in `toolbarContent.ts`,
   `panelSignature` in `techContent.ts`) collapse the row/node state to a
   string; the host re-derives the DOM only when the signature changes, not
   on every effort tick. The panel's effort *header* updates cheaply in
   place each tick; its nodes re-derive only on signature change.
3. **Safari-proof pan.** Track explicit `lastX/lastY` pointer deltas
   instead of `movementX/Y`; guard `setPointerCapture`/`releasePointerCapture`
   against throwing.
4. **Make the depth discoverable.** A persistent dock meta-button row —
   **[Tech (T)] [Eco (E)] [Civic (C)]** — toggling the panel and cycling
   the overlays through the *same pure gates the keys already use*, plus a
   brief "new tool unlocked" flash on the dock when the tool set grows.

## 3. Architecture Impact

Purely `src/ui` + `main.ts` wiring + `index.html` CSS. **No engine,
worldgen, ecology, tech, or tools changes** — this feature touches no
game logic and no guard-scanned directory except the allowlist append.

- **Modified shells**: `src/ui/toolbar.ts` (keyed reconcile + delegated
  click + meta-button row + unlock flash), `src/ui/techPanel.ts` (keyed
  reconcile + delegated click + in-place header + `toggle()` on the
  handle), `src/ui/input.ts` (explicit pan deltas, guarded capture),
  `src/main.ts` (signature-gated refresh; shared `cycleOverlay(kind)`
  closure called by both keys and the new buttons).
- **Modified pure modules** (allowlisted): `src/ui/toolbarContent.ts`
  (`refreshSignature`, `addedIds`), `src/ui/techContent.ts`
  (`panelSignature`).
- **New pure module**: `src/ui/dockContent.ts` (`metaButtons(panelOpen,
  activeOverlay)` view model) — appended to `PURE_UI_ALLOWLIST` in
  `tests/architecture.test.ts`.
- **CSS**: `index.html` gains a meta-button-row style and a transient
  flash class. No new dependencies.

## 4. Acceptance Criteria

1. Gates green: `npx tsc --noEmit`, `npx vitest run`, `npm run build`;
   `src/ui/dockContent.ts` is on the pure-ui allowlist and passes the
   guard.
2. **Click survival (the defining regression):** dock tool buttons and
   tech-panel nodes are clickable repeatedly while communal effort is
   actively accruing, with no dropped clicks — verified in the live pass in
   **both Safari and Chromium**.
3. **Reconciliation, not rebuild:** the reconcile *decision* — for a prior
   id list and the next rows, which nodes to keep/update vs. insert/remove
   and in what order — is a **pure, tested helper** (the test environment is
   node-only; no jsdom is added). It is exhaustively unit-tested: unchanged
   rows → no insert/remove (identity preserved); affordability/selection
   change → update-in-place, no structural change; id-set growth/removal →
   exactly the added/removed ids; reorder handled. The thin DOM shell merely
   applies the plan (createElement / textContent / classList / append /
   remove) and is verified by the live pass. So "identity preserved on
   unchanged content" is pinned by an automated test against the plan, not
   left to manual QA.
4. **Signature gating (pure, tested):** `refreshSignature(rows)` is stable
   for equal input and changes on an affordability flip, a selection
   change, and an id-set growth (the tool-appears-on-unlock case, asserted
   explicitly). `panelSignature(columns)` changes on a node status change
   and is insensitive to the effort header value.
5. **`addedIds(prev, next)` (pure, tested):** returns the ids present in
   `next` but not `prev`; empty when unchanged; the new ids on growth.
6. **Pan via explicit deltas:** dragging pans the map (live pass, Safari +
   Chromium); pointer-capture failure does not throw.
7. **Discoverability:** the dock shows [Tech] [Eco] [Civic]; clicking each
   does exactly what the corresponding key does, routed through the
   identical pure gates (`shouldTogglePanel`, `compositeKeyFor` /
   `cycleComposite`) — asserted at the pure level via `metaButtons` +
   the shared gate functions; verified live.
8. **Live pass (human acceptance gate), Safari AND Chromium:** every dock
   button and tech node clicks through during effort accrual; T/E/C work as
   both keys and buttons; the unlock flash fires when a node is unlocked;
   pan/zoom work.

## 5. Risk Assessment

- **Reconciliation correctness vs. delegation overlap.** Both are
  implemented; delegation alone leaves the 10Hz churn (flicker, lost
  `:active`/focus), reconciliation alone with per-node listeners is workable
  but delegation removes listener bookkeeping. Risk: a subtle reconcile bug
  (stale class left on a reused node). Mitigation: reconcile updates every
  visible attribute every refresh; the live pass exercises affordability
  flips.
- **Thin-shell testability.** The shells are DOM and, by project
  convention, untested — but the click-survival behavior is the whole
  point. Mitigation: push all decidable logic into the pure helpers
  (signatures, addedIds, metaButtons) with tests; make the live pass a
  named, explicit acceptance gate in *both* browsers.
- **Signature omissions.** If `refreshSignature` omits a field that the row
  renders, a real change won't repaint. Mitigation: the signature is
  derived from the exact `ToolbarRow` fields the shell renders; a test pins
  each field's effect.
- **Shared-overlay refactor.** Extracting the E/C keydown body into one
  `cycleOverlay(kind)` closure risks diverging key vs. button behavior.
  Mitigation: both call the one closure; the pure gates are unchanged.

## 6. Open Questions

1. Should the meta buttons show active state (e.g. Tech highlighted while
   the panel is open)? (Assume yes — `metaButtons` returns an `active` flag
   per button; cheap and aids discoverability.)
2. Flash duration / style? (Assume ~1s CSS animation, palette-consistent;
   tuning is cosmetic, settled in the live pass.)
3. ~~Does reconciliation need a jsdom test?~~ **Resolved (no jsdom).** The
   test environment is node-only and jsdom would be both an infra change and
   self-deceiving on the Safari axis the bug hid on (jsdom ≠ WebKit). The
   reconcile *decision* (order/insert/remove) is a pure `reconcilePlan`
   module tested in node; class staleness is eliminated by pure
   `toolbarToolClass`/`techNodeClass` helpers the shell applies wholesale
   (`el.className = pureClass(...)`); delegated-click-survival is verified by
   the Safari + Chromium live pass.

## 7. Out of Scope

- Any worldgen/density, sprite/animation, or rezoning work (later features).
- Restyling beyond the meta-button row and the unlock flash.
- New game mechanics, tools, or keybindings beyond surfacing the existing
  T/E/C as buttons.
- Touch/mobile input, accessibility passes, localization.
