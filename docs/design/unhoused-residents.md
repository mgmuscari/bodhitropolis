# Unhoused residents — design (FIRST CUT, awaiting Maddy's direction)

**Status:** a conservative first cut shipped (a derived count + indicator). The deeper mechanics below
are deliberately **not** built yet — they carry real design choices Maddy flagged as open. This doc
records the decisions made, and the questions left for her.

## What shipped (this PR)

A **derived, loop-coupled count** of displaced residents, surfaced as an always-on indicator.

- `src/ui/unhousedContent.ts` (pure, unit-tested, on the architecture pure-ui allowlist):
  - `sampleUnhoused(state, mapWidth)` — per home, `housed = min(occupancy, capacity)`,
    `displaced = max(0, capacity − occupancy)`; summed over the published census. A home **over**
    capacity (in-migration) does **not** offset another home's loss — displacement is local, not netted.
    A home with no live occupancy entry yet is assumed housed at capacity (no phantom deficit on load).
  - `unhousedSuffix(count, prev)` — `Unhoused N` with a **down-is-good** arrow (↓ fewer displaced =
    your housing is working; ↑ worse).
- `main.ts` appends the suffix to the always-on pulse line and trends it on the civic cadence.

**Why this model:** the seeded census (`households`) is the city's housing *capacity*; live `occupancy`
is who lives there now. The existing decline spiral (decay → smog → land-value drop → occupancy drift
toward empty), arrests (occupancy drain), and abandonment/demolition already push occupancy below
capacity. That shortfall **is** the displaced population, with no new sim machinery. It moves the right
way for free: decline raises it, revival (healing homes + building housing, which raises capacity and
occupancy) lowers it — so "build/heal housing" is the legible counter-move, exactly per the brief.

**Why not more (yet):** the count is honest and useful on its own, and it composes with — rather than
perturbs — the delicate occupancy/wellbeing loop (it's a pure read, zero feedback). The richer pieces
below change game feel and need playtest judgement, so they're Maddy's call.

## Open questions / next steps (for Maddy)

1. **Visible sheltering agents — SPEC'D (Maddy 2026-06-19).** "unhoused people either live in empty
   tiles or out of cars, affects their schedule, but otherwise also go about having days."
   - **Shelter, not a home.** An unhoused agent has a **shelter anchor** in place of `homeTile`: either
     an **empty tile** (an encampment spot — open land / vacant lot / under an overpass) OR **their own
     CAR** (living out of the vehicle — the car parked somewhere is the shelter). Tagged `unhoused`,
     distinct from ambient wanderers (which have neither home nor shelter).
   - **They still have DAYS.** They run a daily round (itinerary) like a housed citizen — Work / Shop /
     Lifestyle stops, then return to the **shelter** instead of a home plot. The
     spawn/itinerary/commute-home machinery generalises: treat the shelter anchor the way `homeTile` is
     treated today (spawn from it, deposit/return to it). The homed-vs-homeless branch (the commute-home
     fix keyed on `homeTile`) becomes homed-vs-**sheltered**-vs-truly-wandering.
   - **Shelter AFFECTS the schedule.** Differences from a housed round: e.g. fewer/harder stops, no
     overnight refuge → wellbeing erodes faster, a car-dweller's "shelter" moves with the car (so its
     round re-anchors as the car parks), an empty-tile dweller is tied to its spot. The exact schedule
     deltas are a feel knob (start small: same round, return to shelter, reduced refuel/wellbeing).
   - **Tie to the count (shipped first cut).** The derived displacement count becomes ACTUAL agents: as
     occupancy falls below capacity, displaced residents enter the `unhoused` agent pool with a shelter
     anchor; re-housing (new/healed housing) pulls them back to a home. Keep the count as the aggregate
     readout; the agents are the visible embodiment.
   - Q: how a displaced resident PICKS its shelter (nearest empty tile to its old home? its car if it
     had one?); render (a tent/encampment glyph, a car-as-dwelling); the cap on visible unhoused agents.

2. **Displacement transitions (explicit, not just the derived shortfall).** Should a specific event —
   an arrest, a demolition, a home decaying to a derelict — *emit* a displaced agent at that tile (a
   person put on the street), rather than only moving the aggregate count? More visceral, more code.
   - Q: which events displace, and does re-housing (occupancy recovering / new housing) reclaim them?

3. **Ties into the existing systems.** Civic voice/trust (a displaced population erodes belonging?),
   redline/police harm (displacement concentrates in redlined zones; sweeps target encampments — careful,
   this is heavy and must stay critical, never gamified cruelty), wellbeing. Each is a real mechanic.

4. **Player levers.** Build housing (CoopHousing/Commune/ADU raise capacity → absorb displaced), Healing
   Commons / defund (reduce the harms that displace). Should a shelter/commons kind directly house them?

5. **Surface integration.** The count currently rides the pulse line. It likely belongs in the
   **restoration readout panel** (the G-key HUD from the companion PR) as another "down-is-good" metric —
   fold it in once both land.

**Vocabulary guard (per CLAUDE.md):** the player **houses / shelters / makes reparation**; never
"clears", "removes", or "sweeps" an encampment as a player good. Sweeps belong only to the oppressive
police layer, named critically.
