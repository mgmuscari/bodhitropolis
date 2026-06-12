// Browser entry point. Bootstrapping (worldgen, camera, renderer, input,
// sim loop) is wired up in Task 9. Until then this is a placeholder.
//
// IMPORTANT: this module must be safe to import in a headless (non-DOM)
// environment so Vitest can import the entry tree without throwing. All
// DOM access lives behind the `typeof document !== 'undefined'` guard.

export function main(): void {
  // Bootstrapping happens here once the UI layer lands (Task 9).
}

if (typeof document !== 'undefined') {
  main();
}
