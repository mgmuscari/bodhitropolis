export const meta = {
  name: 'dialectic-sweep',
  description: 'Codebase-scale dialectic audit: fan out dimension finders, adversarially verify each finding with independent skeptics, synthesize a ranked report',
  whenToUse: 'Whole-codebase or multi-module bug hunts, security sweeps, and quality audits — scope larger than a single PR diff (which /review-code-team and /security-audit-team already cover).',
  phases: [
    { title: 'Find', detail: 'one finder per dimension across the target scope' },
    { title: 'Verify', detail: 'independent skeptics try to refute each finding' },
    { title: 'Synthesize', detail: 'dedup and rank the findings that survive' },
  ],
}

// ---------------------------------------------------------------------------
// This workflow IS the dialectic at codebase scale: thesis (a finder asserts a
// problem) → antithesis (independent skeptics try to refute it) → synthesis
// (only findings that survive the cross-examination are reported). It mirrors
// the proposer/interlocutor tension of the team commands, but fanned out across
// the whole codebase and made resumable.
//
// args = {
//   scope:       string    human label, e.g. "auth subsystem"        (default: "the codebase")
//   paths:       string[]  dirs/globs to focus finders on            (default: ["."])
//   dimensions:  string[]  subset of: correctness security performance convention (default: all)
//   skeptics:    number    refuters per finding                      (default: budget-scaled, 3..5)
//   conventions: string    project conventions excerpt to cite       (default: points at CLAUDE.md)
// }
// ---------------------------------------------------------------------------

const A = args || {}
const SCOPE = A.scope || 'the codebase'
const PATHS = (A.paths && A.paths.length) ? A.paths : ['.']
const PATHS_STR = PATHS.join(', ')
const CONVENTIONS = A.conventions || 'Read CLAUDE.md for the project conventions and stated invariants.'

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }

const ALL_DIMENSIONS = [
  { key: 'correctness', focus: 'logic errors, broken invariants, unhandled edge cases, race conditions, incorrect or swallowed error handling' },
  { key: 'security', focus: 'injection (SQL/command/template/path), auth/authz gaps and IDOR, data exposure, unsafe deserialization, hardcoded secrets, SSRF' },
  { key: 'performance', focus: 'N+1 queries, unbounded loops/allocations, blocking I/O on hot paths, missing indexes, accidental O(n^2) work' },
  { key: 'convention', focus: 'violations of the stated project conventions and invariants, dead code, and inconsistent patterns that will rot' },
]
const wanted = (A.dimensions && A.dimensions.length) ? A.dimensions : ALL_DIMENSIONS.map(d => d.key)
const DIMENSIONS = ALL_DIMENSIONS.filter(d => wanted.includes(d.key))

// Refuters per finding: explicit arg, else scale with the turn's token budget, else 3.
const hasBudget = typeof budget !== 'undefined' && budget.total
const SKEPTICS = A.skeptics || (hasBudget ? Math.max(3, Math.min(5, Math.floor(budget.total / 200_000))) : 3)

// Distinct verification lenses — diversity catches failure modes redundancy can't.
const LENSES = ['reachability', 'severity-calibration', 'already-mitigated', 'precondition-realism', 'false-positive']

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'line', 'description', 'evidence', 'remediation'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
          file: { type: 'string' },
          line: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          remediation: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason', 'adjustedSeverity'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    adjustedSeverity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'NONE'] },
  },
}

function findPrompt(d) {
  return `You are a ${d.key} reviewer auditing ${SCOPE}. Focus on these paths: ${PATHS_STR}.

This is a WHOLE-CODEBASE audit, not a diff review — use Grep/Glob/Read to navigate the source. Do NOT rely on \`git diff\`. Hunt specifically for: ${d.focus}.

${CONVENTIONS}

Report only real, specific findings backed by concrete file:line evidence. A precise short list beats a speculative long one — do not pad. For each finding provide: a one-line title, severity (CRITICAL/HIGH/MEDIUM/LOW/INFO), file, line, a description of the actual problem, the evidence (the code/pattern that proves it), and a concrete remediation.`
}

function refutePrompt(f, lens, i) {
  return `Adversarially verify this ${f.severity} finding from a ${SCOPE} audit. Apply the "${lens}" lens (verifier #${i + 1}). Your job is to REFUTE it.

Title: ${f.title}
Location: ${f.file}:${f.line}
Claim: ${f.description}
Evidence cited: ${f.evidence}

Open ${f.file} and read the surrounding code. Decide whether the finding is real and whether its severity is justified. Probe: is the code path actually reachable? Is the precondition real? Is it already handled elsewhere? Is the severity inflated relative to real-world impact?

Default to refuted=true if you cannot concretely confirm the finding by reading the code. Return: refuted (true = not a real issue or severity unjustified), a one-line reason, and the severity you'd assign (or NONE if refuted).`
}

// --- Find → Verify, pipelined so each dimension's findings verify the moment
// --- that finder returns (no barrier between finding and verifying).
phase('Find')

const perDimension = await pipeline(
  DIMENSIONS,
  // Stage 1 — find
  d => agent(findPrompt(d), { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA })
        .then(r => ({ key: d.key, findings: (r && r.findings) || [] })),
  // Stage 2 — verify every finding from this dimension, each by SKEPTICS independent refuters
  (found, d) => parallel(found.findings.map(f => () =>
    parallel(Array.from({ length: SKEPTICS }, (_, i) => () =>
      agent(refutePrompt(f, LENSES[i % LENSES.length], i), { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    )).then(votes => {
      const valid = votes.filter(Boolean)
      const refutes = valid.filter(v => v.refuted).length
      const survives = valid.length > 0 && refutes < Math.ceil(valid.length / 2) // majority must NOT refute
      const keptSevs = valid.filter(v => !v.refuted)
        .map(v => v.adjustedSeverity)
        .filter(s => s && s !== 'NONE')
        .sort((a, b) => SEV_ORDER[a] - SEV_ORDER[b]) // most severe first — never under-report
      return {
        ...f,
        dimension: d.key,
        survives,
        refutes,
        votes: valid.length,
        finalSeverity: keptSevs[0] || f.severity,
      }
    })
  )).then(arr => arr.filter(Boolean))
)

// --- Synthesize
phase('Synthesize')

const all = perDimension.flat().filter(Boolean)
const survivors = all.filter(f => f.survives)

const seen = new Set()
const deduped = []
for (const f of survivors) {
  const k = `${f.file}::${f.title}`.toLowerCase()
  if (seen.has(k)) continue
  seen.add(k)
  deduped.push(f)
}
deduped.sort((a, b) => (SEV_ORDER[a.finalSeverity] ?? 9) - (SEV_ORDER[b.finalSeverity] ?? 9))

const droppedByVerify = all.length - survivors.length
log(`${all.length} raw findings → ${survivors.length} survived adversarial verify (${SKEPTICS} skeptics each) → ${deduped.length} after dedup. ${droppedByVerify} dropped by skeptics.`)

return {
  scope: SCOPE,
  paths: PATHS,
  dimensions: DIMENSIONS.map(d => d.key),
  skepticsPerFinding: SKEPTICS,
  counts: { raw: all.length, survived: survivors.length, deduped: deduped.length, droppedByVerify },
  findings: deduped,
}
