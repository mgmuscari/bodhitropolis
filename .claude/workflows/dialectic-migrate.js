export const meta = {
  name: 'dialectic-migrate',
  description: 'Codebase-scale migration: discover call sites, transform each in worktree isolation, verify, and report patches for landing',
  whenToUse: 'Mechanical-but-wide changes across many files — API deprecations, framework swaps, signature changes, language idiom ports. Each site is transformed and verified independently.',
  phases: [
    { title: 'Discover', detail: 'find every site that needs the change' },
    { title: 'Transform', detail: 'one agent per site, edits + verifies in an isolated worktree' },
    { title: 'Review', detail: 'check each patch is correct and minimal' },
  ],
}

// ---------------------------------------------------------------------------
// STARTER + PATTERN. This is the dialectic applied to migration: a proposer
// transforms each site (in an isolated git worktree so parallel edits + verify
// runs can't collide), and a reviewer cross-examines each patch before it is
// reported. It returns patches rather than landing them on main — the calling
// command is responsible for the landing strategy (see the dynamic-workflows
// guide). TDD still holds: the per-site verifyCmd must pass for a patch to be
// accepted.
//
// args = {
//   goal:       string   what the migration does, e.g. "replace deprecated foo() with bar()"  (required)
//   paths:      string[] dirs/globs to search for sites                 (default: ["."])
//   discover:   string   how to recognize a site (grep pattern or prose) (required)
//   verifyCmd:  string   command run inside each worktree to verify the edit, e.g. "pytest path -q"
//   guidance:   string   transformation rules / gotchas to honor         (optional)
// }
// ---------------------------------------------------------------------------

const A = args || {}
if (!A.goal) throw new Error('dialectic-migrate: args.goal is required')
if (!A.discover) throw new Error('dialectic-migrate: args.discover is required')

const GOAL = A.goal
const PATHS = (A.paths && A.paths.length) ? A.paths : ['.']
const PATHS_STR = PATHS.join(', ')
const DISCOVER = A.discover
const VERIFY_CMD = A.verifyCmd || ''
const GUIDANCE = A.guidance || ''

const SITES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sites'],
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'reason'],
        properties: {
          file: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'changed', 'verifyPassed', 'diff', 'notes'],
  properties: {
    file: { type: 'string' },
    changed: { type: 'boolean' },
    verifyPassed: { type: 'boolean' },
    diff: { type: 'string' },
    notes: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'accept', 'reason'],
  properties: {
    file: { type: 'string' },
    accept: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

// --- Discover
phase('Discover')
const discovered = await agent(
  `Find every site that needs this migration: ${GOAL}.

Search these paths: ${PATHS_STR}. Recognize a site by: ${DISCOVER}.
Use Grep/Glob/Read. List each distinct file that needs editing, with a one-line reason. Do not include files that already comply.`,
  { label: 'discover', phase: 'Discover', schema: SITES_SCHEMA },
)
const sites = (discovered && discovered.sites) || []
log(`Discovered ${sites.length} site(s) to migrate.`)

// --- Transform → Review (pipelined; each site is independent)
const results = await pipeline(
  sites,
  // Stage 1 — transform in an isolated worktree, verify, return a patch (do NOT commit to main)
  (site) => agent(
    `Migrate one file: ${site.file}. Goal: ${GOAL}. (Reason this site qualifies: ${site.reason}.)
${GUIDANCE ? `Transformation rules: ${GUIDANCE}\n` : ''}
Make the minimal edit that accomplishes the goal in ${site.file} only. Do not touch other files.
${VERIFY_CMD ? `Then run \`${VERIFY_CMD}\` and report whether it passed.` : 'No verify command was provided; report verifyPassed=true and note that verification was skipped.'}
Return: file, changed (did you edit it), verifyPassed, diff (the unified \`git diff\` of your change), and notes. Do NOT commit or push.`,
    { label: `transform:${site.file}`, phase: 'Transform', schema: PATCH_SCHEMA, isolation: 'worktree' },
  ),
  // Stage 2 — review the patch adversarially before it is reported as landable
  (patch, site) => {
    if (!patch || !patch.changed) return { ...(patch || { file: site.file }), review: { accept: false, reason: 'no change produced' } }
    return agent(
      `Review this migration patch for ${patch.file}. Goal: ${GOAL}.

Diff:
${patch.diff}

Verify it: is the change correct, minimal, and complete for this file? Does it preserve behavior outside the migration's intent? Did the verify step pass (${patch.verifyPassed})? Reject if the patch is wrong, overreaching, or unverified. Return file, accept (boolean), and a one-line reason.`,
      { label: `review:${patch.file}`, phase: 'Review', schema: REVIEW_SCHEMA },
    ).then(review => ({ ...patch, review: review || { accept: false, reason: 'review failed' } }))
  },
)

// --- Synthesize
const all = results.filter(Boolean)
const accepted = all.filter(r => r.review && r.review.accept && r.verifyPassed)
const rejected = all.filter(r => !(r.review && r.review.accept && r.verifyPassed))
log(`${sites.length} sites → ${accepted.length} patches accepted, ${rejected.length} need human attention.`)

return {
  goal: GOAL,
  paths: PATHS,
  counts: { sites: sites.length, accepted: accepted.length, rejected: rejected.length },
  accepted, // each has .diff ready to land
  rejected, // each has .review.reason / .notes explaining why
}
