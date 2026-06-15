// Dock meta content: the pure view-model for the dock's [Tech][Eco][Civic] meta
// buttons — the keyboard-only depth (T/E/C) surfaced as always-visible controls.
// No DOM, no transcendental Math (it will join the architecture guard's pure-ui
// allowlist in Task 6, alongside the metaButtons() derivation). This file
// currently declares the shared MetaButton type the toolbar shell renders; the
// pure metaButtons(panelOpen, activeOverlay) derivation is added in Task 6 so the
// active-state logic is unit-tested rather than left to manual QA.

/** One dock meta button: which control it is, its label, and whether it's active. */
export interface MetaButton {
  id: 'tech' | 'eco' | 'civic';
  label: string;
  active: boolean;
}
