# Bodhitropolis

A dharmapunk browser city-builder — a deterministic, procedurally-generated
world atop the GPL-3 Micropolis lineage (the open-sourced SimCity Classic by
Will Wright / Maxis). This repository hosts the modern TypeScript engine in
the root `src/` / `tests/`; the original Micropolis ports live in their legacy
subtrees (`micropolis-activity/`, `MicropolisCore/`, `micropolis-java/`) and
are reference-only.

## Quickstart

```bash
npm install        # install the toolchain (Vite + TypeScript + Vitest)
npm run dev        # serve the app at http://localhost:5173
npx vitest run     # run the test suite
npm run build      # production build (tsc typecheck + vite bundle)
npm run typecheck  # type check only (tsc --noEmit)
```

Open `http://localhost:5173/?seed=<anything>` to generate a specific world.
The same seed always produces the same world — reload to confirm.

## Architecture

Code is split into three layers with a strict, test-enforced purity rule
(`tests/architecture.test.ts`):

- **`src/engine/`** — the deterministic simulation core: a seeded PRNG
  (`rng.ts`, sfc32 with `fork`-by-label streams), a fixed-tick loop
  (`loop.ts`), and the layered typed-array tile map (`map.ts`). Imports
  nothing from `worldgen` or `ui`.
- **`src/worldgen/`** — value noise / fBm (`noise.ts`), the staged generation
  pipeline (`pipeline.ts`), and the terrain stage (`terrain.ts`: elevation,
  ocean/lake/river, moisture, biomes). May import `engine`.
- **`src/ui/`** — a Canvas2D pixel-art renderer, pan/zoom camera, and input.
  Only this layer and `src/main.ts` touch the DOM.

**Determinism is load-bearing.** `engine` and `worldgen` use only integer math
and exactly-rounded float ops (`+ - * / sqrt`, `Math.imul/floor`) — no
transcendental `Math` (`exp`/`pow`/`log`/`sin`/`cos`/`tan`) and no
`Math.random`, because their results vary across JS engines and would break
"same seed → same world" between browsers. The seeded `rng` is the only
randomness source. This is what makes shared-seed worlds (and the planned
historical simulation) reproducible.

## Methodology

This project is built with the Dialectic development methodology. See
[`dialectic.md`](dialectic.md) for the methodology spec and `CLAUDE.md` for
project conventions.

---

# Open Source Micropolis, based on the original SimCity Classic from Maxis, by Will Wright. #

This is the source code for Micropolis (based on [SimCity](http://en.wikipedia.org/wiki/SimCity_(1989_video_game))), released under the GPL. Micropolis is based on the original SimCity from Electronic Arts / Maxis, and designed and written by Will Wright.

## [Description](../wiki/Description.md) ##
A description of the Micropolis project source code release.

## [News](../wiki/News.md) ##
The latest news about recent development.

## [DevelopmentPlan](../wiki/DevelopmentPlan.md) ##
The development plan, and a high level description of tasks that need to be done.

## [ThePlan](../wiki/ThePlan.md) ##
Older development plan for the TCL/Tk version of Micropolis and the C++/Python version too.

## [Assets](../wiki/Assets.md) ##
List of art and text assets, and work that needs to be done for Micropolis.

## Documentation ##

This is the old documentation of the HyperLook version of SimCity, converted to wiki text.
It needs to be brought up to date and illustrated.

  * [Introduction](../wiki/Introduction.md)
  * [Tutorial](../wiki/Tutorial.md)
  * [User Reference](../wiki/UserReference.md)
  * [Inside The Simulator](../wiki/InsideTheSimulator.md)
  * [History Of Cities And City Planning](../wiki/History.md)
  * [Bibliography](../wiki/Bibliography.md)
  * [Credits](../wiki/Credits.md)

## [License](../wiki/License.md) ##
The Micropolis GPL license.

## Tools ##
[![](http://wingware.com/images/coded-with-logo-129x66.png)](http://wingware.com/)
