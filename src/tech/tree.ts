// The tech tree: a data-driven, seven-branch unlock DAG. Pure module — no DOM,
// no transcendental Math, no rng (costs and structure are fully deterministic).
// It imports only from the engine layer (BuiltKind), never from worldgen or ui,
// so the architecture guard can scan src/tech fail-closed.
//
// A branch is a philosophy of the dharmapunk city. A TechNode unlocks for a
// communal-effort cost once its prereqs are met, granting either build kinds or
// capability flags. Prereqs may cross branches: RestorativeJustice is the
// structural thesis — you cannot heal the built environment without healing the
// community — so its non-root nodes are load-bearing across the tree.

import { BuiltKind } from '../engine/fabric';

export const Branch = {
  NewUrbanism: 'NewUrbanism',
  GreenDevelopment: 'GreenDevelopment',
  RestorativeJustice: 'RestorativeJustice',
  IntentionalCommunities: 'IntentionalCommunities',
  GiftEconomy: 'GiftEconomy',
  Solarpunk: 'Solarpunk',
  AnarchoCommunism: 'AnarchoCommunism',
} as const;
export type Branch = (typeof Branch)[keyof typeof Branch];

/** What a node grants on unlock: build kinds and/or capability flags. */
export interface TechGrants {
  kinds?: BuiltKind[];
  capabilities?: string[];
}

export interface TechNode {
  /** kebab-case unique id; also the prereq reference key. */
  id: string;
  branch: Branch;
  name: string;
  /** Flavor line, dharmapunk register, ≤90 chars. */
  flavor: string;
  /** Ids of nodes that must be unlocked first (may cross branches). */
  prereqs: string[];
  /** Communal-effort cost to unlock. */
  cost: number;
  grants: TechGrants;
}

const node = (
  id: string,
  branch: Branch,
  name: string,
  prereqs: string[],
  cost: number,
  grants: TechGrants,
  flavor: string,
): TechNode => ({ id, branch, name, prereqs, cost, grants, flavor });

const { NewUrbanism, GreenDevelopment, RestorativeJustice, IntentionalCommunities, GiftEconomy, Solarpunk, AnarchoCommunism } = Branch;
const cap = (...c: string[]): TechGrants => ({ capabilities: c });
const kind = (k: BuiltKind): TechGrants => ({ kinds: [k] });

export const TECH_TREE: readonly TechNode[] = [
  // --- New Urbanism ---------------------------------------------------------
  node('walkable-streets', NewUrbanism, 'Walkable Streets', [], 10, cap('walkability'),
    'Streets remember they were once for walking; reclaim them a crosswalk at a time.'),
  node('road-diets', NewUrbanism, 'Road Diets', ['walkable-streets'], 15, cap('road-diets'),
    'Lanes go on a diet so neighbors can breathe — narrower asphalt, wider lives.'),
  node('parklets', NewUrbanism, 'Parklets', ['road-diets'], 20, kind(BuiltKind.Parklet),
    'A parking space becomes a pocket of green; the curb learns to host, not store.'),
  node('quiet-streets', NewUrbanism, 'Quiet Streets', ['road-diets'], 25, kind(BuiltKind.QuietStreet),
    'Calm the through-traffic and the block exhales; kids chalk the road again.'),
  node('urban-promenades', NewUrbanism, 'Urban Promenades', ['quiet-streets'], 35, kind(BuiltKind.Promenade),
    'Car-free corridors stitch the district together, on foot and in conversation.'),
  node('streetcar-revival', NewUrbanism, 'Streetcar Revival', ['road-diets', 'renewable-energy'], 40, kind(BuiltKind.Streetcar),
    'The old rails hum back to life, electric and unhurried, threading the commons.'),
  node('pocket-parks', NewUrbanism, 'Pocket Parks', ['parklets'], 25, kind(BuiltKind.Park),
    'Rezone a tired lot into a pocket of shade and birdsong; the block grows a lung.'),

  // --- Green Development -----------------------------------------------------
  node('soil-and-soul', GreenDevelopment, 'Soil and Soul', [], 10, cap('soil-care'),
    "Tend the ground beneath the grid; living soil is the city's quiet infrastructure."),
  node('urban-composting', GreenDevelopment, 'Urban Composting', ['soil-and-soul'], 15, kind(BuiltKind.CompostHub),
    'Scraps return as black gold; the neighborhood closes its own nutrient loop.'),
  node('community-gardens', GreenDevelopment, 'Community Gardens', ['urban-composting', 'road-diets'], 25, kind(BuiltKind.CommunityGarden),
    'Vacant lots turn to rows of chard and marigold, tended by whoever shows up.'),
  node('vertical-farming', GreenDevelopment, 'Vertical Farming', ['community-gardens'], 40, kind(BuiltKind.VerticalFarm),
    'Greens climb the walls; a warehouse becomes an acre stacked toward the sun.'),
  node('wastewater-recycling', GreenDevelopment, 'Wastewater Recycling', ['soil-and-soul'], 30, kind(BuiltKind.WastewaterWorks),
    'Greywater is too precious to flush away; reclaim it and let the reeds work.'),
  node('rewilding', GreenDevelopment, 'Rewilding', ['community-gardens'], 30, kind(BuiltKind.RewildedLand),
    'Let the lot go feral — bramble, milkweed, fox; the city makes room for the wild.'),

  // --- Restorative Justice (the structural thesis) ---------------------------
  node('circles', RestorativeJustice, 'Circles', [], 10, cap('circles'),
    'Harm is met with a circle, not a cage; the community speaks and listens.'),
  node('community-land-trust', RestorativeJustice, 'Community Land Trust', ['circles'], 20, cap('land-trust'),
    'Land held in common cannot be flipped; the trust keeps the ground underfoot.'),
  node('healing-commons', RestorativeJustice, 'Healing Commons', ['community-land-trust'], 30, kind(BuiltKind.HealingCommons),
    'A shared house for grief and repair, open to anyone the city has wounded.'),
  node('participatory-budgeting', RestorativeJustice, 'Participatory Budgeting', ['circles'], 25, cap('participatory-budgeting'),
    'Neighbors decide where the money goes, line by line, out in the open.'),

  // --- Intentional Communities ----------------------------------------------
  node('shared-table', IntentionalCommunities, 'Shared Table', [], 10, cap('shared-table'),
    'Strangers become neighbors over a shared meal; the table is the first institution.'),
  node('adus', IntentionalCommunities, 'Accessory Dwellings', ['shared-table'], 15, kind(BuiltKind.ADU),
    'A backyard cottage, a converted garage — room for elders, kids, and newcomers.'),
  node('coop-housing', IntentionalCommunities, 'Co-op Housing', ['adus', 'collective-ownership'], 30, kind(BuiltKind.CoopHousing),
    'Residents own the building together; rent becomes stewardship, not extraction.'),
  node('maker-spaces', IntentionalCommunities, 'Maker Spaces', ['shared-table', 'gift-circles'], 25, kind(BuiltKind.MakerSpace),
    'Tools held in common: a lathe, a loom, a kiln, free to anyone with a project.'),

  // --- Gift Economy ----------------------------------------------------------
  node('gift-circles', GiftEconomy, 'Gift Circles', [], 10, cap('gift-circles'),
    'Things move by giving, not selling; abundance circulates instead of pooling.'),
  node('urban-bazaars', GiftEconomy, 'Urban Bazaars', ['gift-circles'], 20, kind(BuiltKind.Bazaar),
    'An open-air market where barter and gift mingle; nothing here is only a price.'),
  node('craft-fairs', GiftEconomy, 'Craft Fairs', ['gift-circles'], 15, cap('craft-fairs'),
    'Makers trade what their hands made; skill is the currency that compounds.'),
  node('bike-shares', GiftEconomy, 'Bike Shares', ['gift-circles', 'bike-paths'], 20, cap('bike-shares'),
    'A rack of bikes free to borrow; mobility becomes a commons, not a fare.'),

  // --- Solarpunk -------------------------------------------------------------
  node('sun-and-wire', Solarpunk, 'Sun and Wire', [], 10, cap('solar-basics'),
    'Panels on every roof and the wiring to match; the sun signs on as a co-op member.'),
  node('renewable-energy', Solarpunk, 'Renewable Energy', ['sun-and-wire'], 20, cap('renewables'),
    'Wind and solar carry the load; the grid stops burning the future to light today.'),
  node('local-grids', Solarpunk, 'Local Grids', ['renewable-energy'], 25, cap('local-grids'),
    'Power stays local: microgrids that keep the lights on when the big grid fails.'),
  node('community-energy-nodes', Solarpunk, 'Community Energy Nodes', ['local-grids'], 35, kind(BuiltKind.EnergyNode),
    'A solar-and-battery hub the block owns outright — resilience you can point to.'),
  node('bike-paths', Solarpunk, 'Bike Paths', ['sun-and-wire'], 15, kind(BuiltKind.BikePath),
    'Protected lanes brave enough for an eight-year-old; the city opens to two wheels.'),
  node('elevated-rail', Solarpunk, 'Elevated Rail', ['streetcar-revival', 'local-grids'], 50, kind(BuiltKind.ElevatedRail),
    'Light rail rides above the streets, solar-fed and silent, knitting the districts.'),
  node('drone-deliveries', Solarpunk, 'Drone Deliveries', ['community-ai-nodes'], 45, cap('drone-deliveries'),
    'Democratically dispatched couriers carry the last mile so no one has to drive it.'),
  node('wind-power', Solarpunk, 'Wind Power', ['renewable-energy'], 30, kind(BuiltKind.WindTurbine),
    'Turbines lean into the prevailing wind; clean megawatts spun from moving air.'),
  node('solar-arrays', Solarpunk, 'Solar Arrays', ['renewable-energy'], 35, kind(BuiltKind.SolarPlant),
    'A field of panels drinks the noon sun; the cheapest power humanity has ever made.'),
  node('fusion-power', Solarpunk, 'Fusion Power', ['local-grids', 'community-energy-nodes'], 80, kind(BuiltKind.FusionPlant),
    'A star in a bottle, owned in common; limitless clean power and nothing to mine.'),

  // --- Anarcho-Communism -----------------------------------------------------
  node('mutual-aid', AnarchoCommunism, 'Mutual Aid', [], 10, cap('mutual-aid'),
    "Neighbors cover each other's needs directly; solidarity, not charity, not markets."),
  node('collective-ownership', AnarchoCommunism, 'Collective Ownership', ['mutual-aid', 'community-land-trust'], 25, cap('collective-ownership'),
    'The means of making things belong to the people who use them, together.'),
  node('communes', AnarchoCommunism, 'Communes', ['collective-ownership', 'healing-commons'], 35, kind(BuiltKind.Commune),
    'Households pool their lives and labor; a commune is a commons you come home to.'),
  node('community-ai-nodes', AnarchoCommunism, 'Community AI Nodes', ['mutual-aid', 'local-grids', 'participatory-budgeting'], 40, kind(BuiltKind.AINode),
    'Compute held in common and governed in the open; the model answers to the assembly.'),
];

/** Valid BuiltKind codes, for grant validation. */
const VALID_KINDS = new Set<number>(Object.values(BuiltKind));

/** kebab-case, lowercase ASCII alphanumerics + single hyphens. */
const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Transitive prereq closure of `id` (exclusive of `id` itself). Cycle-safe via a
 * visited set, so a malformed cyclic tree returns a finite set rather than
 * looping. Dangling prereq ids are simply not expanded (validateTree reports
 * them separately).
 */
export function prereqClosure(nodes: readonly TechNode[], id: string): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  const stack = [...(byId.get(id)?.prereqs ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    const p = byId.get(cur);
    if (p) for (const q of p.prereqs) stack.push(q);
  }
  return out;
}

/** True iff the prereq closure of `n` bottoms out at a no-prereq root. */
function reachesRoot(n: TechNode, byId: Map<string, TechNode>): boolean {
  if (n.prereqs.length === 0) return true; // n is itself a root
  const seen = new Set<string>();
  const stack = [...n.prereqs];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (!p) continue; // dangling — reported elsewhere
    if (p.prereqs.length === 0) return true;
    for (const q of p.prereqs) stack.push(q);
  }
  return false;
}

/**
 * Structural validation of a tech tree. Returns human-readable violations (empty
 * array = sound). Checks: unique ids, resolvable prereqs (no dangling), acyclic
 * (DFS back-edge), every node's prereq closure terminates at a no-prereq root
 * (cross-branch allowed), each build kind granted at most once across the tree,
 * and every granted kind is a valid BuiltKind code. Exported so it both validates
 * TECH_TREE and self-checks on synthetic bad trees.
 */
export function validateTree(nodes: readonly TechNode[]): string[] {
  const violations: string[] = [];

  // 1. duplicate ids + kebab/ASCII id charset (snapshotBytes encodes ids with
  //    charCodeAt & 0xff, which is byte-identical to UTF-8 only for ASCII ids —
  //    so the charset that makes the snapshot correct is enforced here at runtime,
  //    not just by the test regex).
  const byId = new Map<string, TechNode>();
  for (const n of nodes) {
    if (!KEBAB_ID.test(n.id)) violations.push(`node id '${n.id}' is not kebab-case ASCII`);
    if (byId.has(n.id)) violations.push(`duplicate node id '${n.id}'`);
    else byId.set(n.id, n);
  }

  // 2. dangling prereqs
  for (const n of nodes) {
    for (const p of n.prereqs) {
      if (!byId.has(p)) violations.push(`node '${n.id}' has dangling prereq '${p}'`);
    }
  }

  // 3. cycles (DFS three-colour; a back-edge to a GRAY node is a cycle)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string): void => {
    color.set(id, GRAY);
    const n = byId.get(id);
    if (n) {
      for (const p of n.prereqs) {
        const c = color.get(p) ?? WHITE;
        if (c === GRAY) violations.push(`cycle detected through '${p}'`);
        else if (c === WHITE && byId.has(p)) visit(p);
      }
    }
    color.set(id, BLACK);
  };
  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id);
  }

  // 4. root-termination reachability (cross-branch allowed)
  for (const n of nodes) {
    if (!reachesRoot(n, byId)) {
      violations.push(`node '${n.id}' prereq closure never reaches a root`);
    }
  }

  // 5. kind grants: at most once, and valid BuiltKind codes
  const grantedBy = new Map<number, string>();
  for (const n of nodes) {
    for (const k of n.grants.kinds ?? []) {
      if (!VALID_KINDS.has(k)) {
        violations.push(`node '${n.id}' grants invalid BuiltKind code ${k}`);
      }
      const prior = grantedBy.get(k);
      if (prior !== undefined) {
        violations.push(`BuiltKind ${k} granted by both '${prior}' and '${n.id}'`);
      } else {
        grantedBy.set(k, n.id);
      }
    }
  }

  return violations;
}
