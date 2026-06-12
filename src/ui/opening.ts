// Opening overlay: the thin DOM shell that mounts pre-computed opening content
// over the live map. It is a renderer-style shell — no logic worth unit-testing
// (manual validation), and deliberately NO game/worldgen imports: content
// arrives as plain strings (OpeningContent), keeping the dependency direction
// clean and the module safe to import headless (it only touches the DOM inside
// mountOpening, which main() calls only when `document` exists).

/** Plain-data content for the overlay (assembled in main.ts from pure modules). */
export interface OpeningContent {
  name: string;
  /** One headline per chronicle era entry — as few as 1, as many as 5. */
  eras: string[];
  stats: string[];
  challenge: string[];
}

function appendLines(parent: HTMLElement, className: string, lines: string[], tag: string): void {
  if (lines.length === 0) return;
  const box = document.createElement('div');
  box.className = className;
  for (const line of lines) {
    const el = document.createElement(tag);
    el.textContent = line;
    box.appendChild(el);
  }
  parent.appendChild(box);
}

/**
 * Build and mount the opening overlay into `container`. Renders WHATEVER eras the
 * chronicle holds (never assuming exactly five). The Begin button, Enter, and
 * Escape all dismiss: the overlay is removed, the keydown handler unbound, and
 * `onBegin` invoked so the caller can hand focus back to the map.
 */
export function mountOpening(
  container: HTMLElement,
  content: OpeningContent,
  onBegin: () => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'opening-overlay';

  const panel = document.createElement('div');
  panel.className = 'opening-panel';

  const name = document.createElement('h1');
  name.className = 'opening-name';
  name.textContent = content.name;
  panel.appendChild(name);

  appendLines(panel, 'opening-eras', content.eras, 'p');
  appendLines(panel, 'opening-stats', content.stats, 'p');
  appendLines(panel, 'opening-challenge', content.challenge, 'p');

  const button = document.createElement('button');
  button.className = 'opening-begin';
  button.textContent = 'Begin';
  panel.appendChild(button);

  overlay.appendChild(panel);
  container.appendChild(overlay);

  // Function declarations (hoisted) so dismiss/onKey can reference each other.
  function dismiss(): void {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    onBegin();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  }

  button.addEventListener('click', dismiss);
  window.addEventListener('keydown', onKey);
  button.focus();
}
