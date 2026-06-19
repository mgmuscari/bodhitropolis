# Multi-tile plots get built-in parking — design (feature request, Maddy 2026-06-19)

"multitile plots >= 2x2 (school, industry, powerplant) should have one built-in parking lot tile,
which spawns facing an adjacent drivable tile. parking lots can be entered from freeways (this
reflects the kind of freeway you see in e.g. northern NJ)."

## Why (it's the STRUCTURAL fix for the walled-off-job churn)

The (75,106) spawn/despawn churn was a job (industry) hemmed in by other non-walkable buildings with
**no walkable foot approach** — citizens could drive near but never complete the last-mile, so they
gave up + respawned in a loop. The live-layer patch (a driven citizen ENTERS the building it drove to;
see the bug-queue entry + `ambientContent` give-up branch) is the safety net. **This feature is the
real fix:** every big plot owns an accessible parking tile, so the destination is always reachable by
car + a trivial walk — the churn can't form.

## The feature

- When worldgen (or a player build) places a footprint **≥ 2×2** — school, industry, power plant,
  apartments, civic megablocks, etc. — reserve **one tile of the footprint as a `ParkingLot`**,
  chosen on the EDGE nearest a drivable tile, and oriented (`curbDir`/facing) toward that adjacent
  drivable neighbour so cars can pull in.
- The lot tile is the plot's front door: trip-cars park there, the last-mile walk to the building is
  one tile, no give-up.
- **Parking lots enterable from freeways** (NJ-style): a `ParkingLot` tile flanking a `RoadHighway`
  is a valid on/off — `canDrive` lets a car leave the freeway INTO the adjacent lot (and back). This
  is the limited-access exception for lot access (like a ramp, but for parking), matching the
  freeway-frontage lots you actually see in northern NJ.

## Implementation sketch

- **Worldgen (hashed, N=120-gated):** in the footprint placer (`placeParcel`/`placeAdjacent` in
  `engine/fabric.ts` + the worldgen callers), for footprints ≥2×2, after placing the building tiles,
  convert one edge tile to `ParkingLot` (or reserve it before fill) — pick the edge tile with a
  drivable orthogonal neighbour (prefer a street/avenue; allow a freeway for the NJ case), set its
  facing toward that neighbour. Deterministic choice (tie-break by `tieHash`, not scan order).
- **`canDrive` (live):** add a freeway↔lot exception — a car may move between a `RoadHighway` lane and
  an adjacent `ParkingLot` tile (enter/exit the lot from the freeway), without the usual lane-direction
  gate. Keep it scoped to lot tiles so it doesn't reopen general limited-access.
- **Parking detection (`parkingContent.parkingLots`/`parkingStalls`):** already finds `ParkingLot`
  blocks; a 1-tile built-in lot is just a small lot (stalls = its stall grid). The existing
  `nearestParkSpot`/`findLotStall` machinery uses it for free.
- Player-built ≥2×2 kinds get the same treatment (so a player-placed power plant/school is accessible).

## Open questions (for Maddy)
- Capacity of a 1-tile built-in lot (stalls per tile is already a knob, `STALLS_PER_AXIS`).
- Which footprints get it (all ≥2×2, or only job/civic destinations, not e.g. a 2×2 house cluster?).
- Does the built-in lot count against the plot's footprint (it occupies a tile that'd be building) or
  extend it by one tile? (Recommend: occupy an edge tile — the plot reads as "building + its lot".)
- Freeway-entry only where a frontage road is absent, or always allowed for lot-flanking freeways?
