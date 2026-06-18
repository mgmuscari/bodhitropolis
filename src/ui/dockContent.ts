// Dock meta content: the pure view-model for the dock's [Tech][Eco][Civic] meta
// buttons — the keyboard-only depth (T/E/C) surfaced as always-visible controls.
// No DOM, no transcendental Math (the architecture guard's pure-ui allowlist scans
// this file). Keeping the active-state derivation here, not in the toolbar shell,
// lets it be unit-tested rather than left to manual QA — and gives main ONE pure
// source of truth that the dock and the keyboard paths both feed.

/** One dock meta button: which control it is, its label, and whether it's active. */
export interface MetaButton {
  id: 'tech' | 'eco' | 'civic' | 'redline' | 'police' | 'coverage' | 'power' | 'life';
  label: string;
  active: boolean;
}

/** Fixed labels — the bracketed key echoes the hotkey the button mirrors. */
const META_LABELS: Record<MetaButton['id'], string> = {
  tech: 'Tech (T)',
  eco: 'Eco (E)',
  civic: 'Civic (C)',
  redline: 'Redline (R)',
  police: 'Police (P)',
  coverage: 'Coverage (V)',
  power: 'Power (U)',
  life: 'Life (L)',
};

/**
 * The five dock meta buttons in fixed tech/eco/civic/redline/life order, with their
 * active flags derived from the live UI state: Tech is active iff the tech panel is
 * open; Eco/Civic/Redline are active iff the single composite overlay is of that
 * kind (they are mutually exclusive, so at most one is ever active); Life is active
 * iff ambient animation is on. Pure — main passes (techPanel.isOpen(), the active
 * overlay's kind or null, the ambientOn flag).
 */
export function metaButtons(
  panelOpen: boolean,
  activeOverlay: { kind: 'eco' | 'civic' | 'redline' | 'police' | 'coverage' | 'power' } | null,
  ambientOn: boolean,
): MetaButton[] {
  return [
    { id: 'tech', label: META_LABELS.tech, active: panelOpen },
    { id: 'eco', label: META_LABELS.eco, active: activeOverlay?.kind === 'eco' },
    { id: 'civic', label: META_LABELS.civic, active: activeOverlay?.kind === 'civic' },
    { id: 'redline', label: META_LABELS.redline, active: activeOverlay?.kind === 'redline' },
    { id: 'police', label: META_LABELS.police, active: activeOverlay?.kind === 'police' },
    { id: 'coverage', label: META_LABELS.coverage, active: activeOverlay?.kind === 'coverage' },
    { id: 'power', label: META_LABELS.power, active: activeOverlay?.kind === 'power' },
    { id: 'life', label: META_LABELS.life, active: ambientOn },
  ];
}
