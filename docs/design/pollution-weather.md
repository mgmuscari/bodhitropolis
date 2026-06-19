# Pollution dynamics + weather — design (feature requests, Maddy 2026-06-19)

Two coupled live-layer features that make the pollution layers a connected CYCLE rather than three
separate fields. Live layer (non-hashed); seeded from the ambient rng only (never the sim streams);
rational math only (no transcendental — keep on the pure-ui allowlist where applicable).

Today: `pollution` (air/smog), `groundPollution`, `waterPollution` exist as separate live
`ScalarField`s. Air smog already **advects** downwind (`driftPollution`, `WIND_CADENCE`,
`prevailingWind`). Ground/water have their own runoff. These two features link them.

## 1. Smog DIFFUSES (in addition to blowing in the wind)

"smog diffuses in addition to blowing in the wind."

- Add an isotropic **diffusion** pass to the air-pollution field alongside the existing wind
  **advection**. Wind streaks plumes downwind; diffusion spreads them outward (a conservative blur:
  each tile sheds a fraction to its neighbours, total mass preserved minus off-map loss).
- Net plume = advection (directional) + diffusion (spreading) — physically a drift-diffusion field, so
  smog both travels downwind AND fattens/softens with distance instead of staying a hard streak.
- Implement as a second pass on the smog field (mirror `driftPollution`): `diffusePollution` with a
  diffusion coefficient (a small fraction per cadence), conservative transfer to the 4-neighbours,
  off-map leaves the system. Rational coefficient, no transcendental.

## 2. Rain couples smog → ground → water (with dilution)

"occasional rain converts smog into ground pollution, and ground pollution into runoff that seeks
bodies of water. each conversion carries a dilution factor to reduce the amount that's flushed."

- **Rain is an occasional weather event** — a seeded cadence from the ambient rng (not the sim
  streams). When it rains:
  1. **Smog → ground pollution.** Rain washes airborne smog down onto the land under it. Transfer a
     fraction of each tile's `pollution` into `groundPollution`, scaled by a **dilution factor < 1**
     (only part is flushed down; the rest stays/clears).
  2. **Ground pollution → runoff seeking water.** Rain mobilises ground contamination into runoff that
     **flows toward the nearest water body** (downhill / down the distance-to-water gradient), landing
     in `waterPollution`. Again scaled by a **dilution factor < 1** per step, so each hop dilutes.
- The **dilution factor** is the key knob: each conversion moves only a fraction, so pollution is not
  fully flushed in one storm — it MOVES and spreads, it doesn't vanish.
- This is thematically loaded (and intended): rain "clears the air" but loads the **ground and water**
  — and runoff seeks the low-lying water bodies, which on this map are the redlined/industrial
  banks (see the water-runoff + redline arc). The harm relocates; it isn't erased. Reparable
  (WastewaterWorks, ground remediation, source removal).

## Implementation sketch
- `diffusePollution(field, coeff)` — conservative 4-neighbour spread; run on the smog field each
  (existing wind) cadence or its own.
- A weather clock (`rainTick`, seeded interval) + `applyRain(state, map)`:
  smog→ground (× `RAIN_SMOG_DILUTION`), then ground→water-runoff along the existing distance-to-water
  field (× `RAIN_RUNOFF_DILUTION`).
- All on the `ScalarField` abstraction (`layField`/`decayField`/`sampleField`) + the existing
  water-flow/distance fields. Determinism gate intact (live, non-hashed; ambient-rng only).

## Open questions (for Maddy)
- Rain frequency/duration (occasional = how often? a brief storm vs a wet spell).
- Dilution magnitudes (how much survives each conversion) — a playtest-feel knob.
- Visual: a rain overlay/effect? Smog visibly thinning during rain + creeks darkening after?
- Does rain also refill/clean anything (e.g., soil/flora benefit), or purely relocate pollution?
