# PRP: Opening Challenge

## Source PRD: docs/PRDs/opening-challenge.md
## Date: 2026-06-12

## 1. Context Summary

Turn the merged worldgen output into the game's opening move: a pure
`BlightReport` over the WorldState, a structured chronicle parsed from
`world.log`, a seeded city-name generator, and a pixel-art opening overlay
that names the city, tells its century, shows its wounds, and challenges
the player to heal it. All logic pure and headless-tested; the overlay is a
thin DOM shell.

## 2. Codebase Analysis

- **Chronicle source format** (verified in src/worldgen/moses.ts):
  era-prefixed entries — `era1: founded at (x, y)` (:369), `era1: streetcar
  — N lines, M rail tiles` (:436), `era1: fabric — …` (:482), `era2: motor
  age — …` (:613), `era3: highway <axis> <index> from <lo> to <hi>` (:744,
  :755), `era3: rails removed N (peak M)` (:699, :760), `era3: urban
  renewal — …` (:793), `era4: suburban flight — …` (:954), `era5:
  disinvestment — D decayed, A abandoned, C craters (of P standing)`
  (:1022). Also `era1: no viable site` (:356) on all-water seeds.
  **Caveat:** `runPipeline` pushes bare stage names (`terrain`,
  `moses-century`) into the same log (src/worldgen/pipeline.ts:46) — the
  parser must skip non-`eraN:` lines.
- **Store accessors**: `count()` (fabric.ts:109) and `aliveCount()`
  (fabric.ts:119) exist → abandoned = count − alive; per-kind/condition
  scans via `aliveIndices()` + scalar accessors (`kindAt`, `conditionAt`).
- **Distance fields**: `distanceField(map, isSource, isPassable?)`
  (src/worldgen/fields.ts) — reuse with highway sources for the
  core/periphery split, mirroring the merged blight-gradient cohorts
  (near ≤8, far ≥16; tests/worldgen/moses.test.ts full-assembly suite).
- **Rng forking**: `createRng(seed).fork(label)` (src/engine/rng.ts) — the
  name generator forks `'city-name'` from the world seed, independent of
  pipeline stage streams by the fork-label contract.
- **UI shell pattern**: `src/main.ts` guards DOM access
  (`typeof document !== 'undefined'`, :67) and tests import it headless
  (tests/smoke.test.ts) — the overlay must preserve that. Styling lives
  inline in `index.html` (single-file CSS); renderer palette constants in
  src/ui/renderer.ts PALETTE (:13-21) inform overlay colors.
- **Architecture guard** (tests/architecture.test.ts) scans `src/engine` +
  `src/worldgen` only — `names.ts` (engine) and `report.ts`/`chronicle.ts`
  (worldgen) fall under it automatically; `src/ui/openingContent.ts` does
  not, but stays DOM-free by convention for headless testing.
- **Conventions**: TDD per task, atomic commits, ≤72-char subjects,
  `hashWorld` for any new determinism assertions, non-vacuous invariants.

**Execution mechanics:** team mode restored — this PRP expects
`/review-plan-team` for the plan gate and `/execute-team` for
implementation (proposer + reviewer teammates, message-gated).

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: City name generator
**Files:** `src/engine/names.ts`, `tests/engine/names.test.ts`
**Approach:** `cityName(rng: Rng): string` — 1-2 syllable core from
consonant/vowel tables (rng-indexed), optional American suffix
(`ford|haven|mills|ridge|port|field|crossing|falls`, weighted), title-case;
length clamp 4-16 chars. Pure rng consumer — no transcendental Math, no
state.
**Tests (RED):** pinned exact name for `createRng('bodhi-1').fork('city-name')`
(pin after first GREEN, assert forever); ≥8 distinct names across 10 seeds;
all names match `/^[A-Z][a-z]+$/` and length bounds; same rng fork → same
name twice (fresh forks).
**Validation:** `npx vitest run`

### Task 2: Chronicle parser
**Files:** `src/worldgen/chronicle.ts`, `tests/worldgen/chronicle.test.ts`
**Approach:**
```ts
interface ChronicleEntry { era: 1|2|3|4|5; years: string; events: string[] }
interface Chronicle { entries: ChronicleEntry[]; unparsed: string[] }
parseChronicle(log: readonly string[]): Chronicle
```
Era years fixed: 1=1900-1920, 2=1920-1945, 3=1945-1965, 4=1965-1985,
5=1985-2000. Match `/^era([1-5]):\s*(.+)$/`; group events under their era
in log order; era-prefixed lines with invalid numbers → `unparsed`;
non-era lines (stage names) silently skipped. Verbatim event text — no
rewriting.
**Tests (RED):** real pipeline (terrain + moses) across 3 seeds → entries
for all five eras, each with ≥1 event, years correct; interleaved bare
stage names absent from output; hand fixtures: `era9: x` → unparsed,
`era3:` empty-event handling, empty log → empty chronicle, ordering
preserved within an era.
**Validation:** `npx vitest run`

### Task 3: Blight report
**Files:** `src/worldgen/report.ts`, `tests/worldgen/report.test.ts`
**Approach:**
```ts
interface BlightReport {
  parcelsTotal: number; parcelsAlive: number; abandoned: number;
  conditionMean: number; conditionMedian: number;
  shareDerelict: number;   // alive condition < 64
  shareStruggling: number; // alive condition < 128
  craters: number;         // alive ParkingLot parcels
  projects: number;        // alive Projects parcels
  railLost: { removed: number; peak: number } | null; // from era3 log line
  coreMean: number | null; peripheryMean: number | null; // hwy d<=8 / >=16,
                                                         // null if cohort < 5
  byKind: Partial<Record<BuiltKind, number>>; // alive parcels per kind
}
buildReport(world: { map; parcels; log }): BlightReport
```
Mean/median over alive parcels; `railLost` parsed from the
`era3: rails removed N (peak M)` line (null if absent); core/periphery via
`distanceField` with highway sources (passable: all), cohort thresholds
matching the merged gradient test. All integer/exactly-rounded math.
**Tests (RED):** hand-built fixture map (place + demolish known parcels) →
exact expected numbers for every field; real pipeline across 3 seeds:
determinism (two builds equal), `abandoned === count − aliveCount`,
shares within [0,1] and `shareDerelict ≤ shareStruggling`, byKind sums to
parcelsAlive, coreMean ≤ peripheryMean when both non-null (consistency
with the merged gradient invariant); all-water seed → zeroed report, no
throw.
**Validation:** `npx vitest run`

### Task 4: Opening content (voice + formatting, pure)
**Files:** `src/ui/openingContent.ts`, `tests/ui/openingContent.test.ts`
**Approach:** DOM-free presentation strings:
`statLines(report): string[]` (4-6 legible lines, e.g. "412 parcels stand;
57 lost to abandonment"), `eraHeadline(entry): string` (years + first
event, verbatim), `challengeText(name, report): string[]` — the dharmapunk
register, hopeful and specific, referencing one real number and one real
era fact; no doom framing. 2-3 short paragraphs, ends with the imperative
to begin.
**Tests (RED):** statLines count and that each embeds the exact report
numbers; challengeText includes the city name and ≥1 digit from the
report; no line exceeds 90 chars; functions are deterministic (pure data
in → same strings).
**Validation:** `npx vitest run`

### Task 5: Opening overlay + wiring
**Files:** `src/ui/opening.ts`, `src/main.ts`, `index.html`
**Approach:**
- `opening.ts`: `mountOpening(container, content, onBegin)` builds one
  overlay element (name header, era list, stat lines, challenge
  paragraphs, Begin button) from pre-computed content; Enter/Escape and
  button click call `onBegin` which removes the overlay and unbinds keys.
  No game imports — content arrives as plain data (keeps the shell thin
  and the dependency direction clean).
- `main.ts`: after `runPipeline`, compute name
  (`cityName(createRng(seed).fork('city-name'))`), chronicle, report,
  content; mount unless `?nointro=1`. Map input stays attached beneath;
  overlay is pointer-events-isolated until dismissed.
- `index.html`: overlay styles — dark panel on the existing `#14121f`
  ground, palette-consistent accent (meadow gold), monospace/pixel feel,
  max-width readable column.
**Tests:** headless-import safety of main.ts still green (existing smoke
test); overlay logic beyond content is manual (thin shell per established
renderer precedent).
**Validation:** `npx vitest run`; `npm run build`; manual `npm run dev`:
overlay shows with all sections; Begin/Enter/Escape dismiss; map
interactive after; `?nointro=1` skips; `?seed=` reproduces identical name
and numbers.

### Task 6: Visual verification + docs
**Files:** `README.md`
**Approach:** README: opening-challenge section (what the player sees,
`?nointro=1`). Browser verification (Playwright if available) on ≥2 seeds:
overlay renders, dismisses, map live behind; capture what was seen in the
final report.
**Tests:** none (docs).
**Validation:** `npx vitest run` still green.

## 4. Validation Gates

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run dev   # manual: overlay content, dismissal, ?nointro=1, ?seed= reproducibility
```

## 5. Rollback Plan

Additive: three new pure modules + one ui module; main.ts gains a guarded
block; index.html gains styles. Revert = don't merge; no schema/persistence
surface.

## 6. Uncertainty Log

- **Voice copy** will be judged at review; the structural tests (name +
  number presence, length bounds) can pass on flat copy — the human/review
  gate owns the register.
- **Era-3 rail line may appear twice** in the log (early-return path at
  moses.ts:699 vs :760) — parser/report take the LAST occurrence; verify
  during Task 2 RED against real output.
- **Cohort nulls**: water-heavy seeds may lack highways (no era 3 corridor
  on no-viable-site maps) — every report field must degrade to null/0
  rather than throw; the all-water test pins this.
- **Overlay scroll** on small viewports: accept internal scroll; no
  responsive pass in scope.
