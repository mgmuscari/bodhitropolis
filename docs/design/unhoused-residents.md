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

1. **Visible sheltering agents.** The brief wants the unhoused *surfaced as agents*, not just a count.
   Natural fit: spawn ~`unhoused`-scaled ped agents tagged `unhoused` (no `homeTile`) that shelter on
   park/rewilded/quiet-street substrate (encampments), distinct from ambient wanderers. This reuses the
   ped substrate + the homed-vs-homeless branch already in `ambientContent` (a homeless ped wanders;
   the commute-home fix keyed exactly on `homeTile`). Caps + spawn cadence are a feel knob.
   - Q: where do they cluster — parks, under freeways/overpasses, vacant lots, near commons? Render?

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
