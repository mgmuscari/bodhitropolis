# Syncing from Upstream

This guide explains how to pull methodology improvements from the upstream
parent repository into your copy of the Dialectic distribution without losing
the framing and terminology changes that make the distribution distinct.

## What this guide covers

The Dialectic distribution is a rebrand of an upstream methodology repo. The
upstream parent and the distribution share structure — tiers, hooks, team-mode
architecture, TDD mandate, artifact flow — but differ in framing language and
a small set of identifiers. When the upstream parent improves the methodology,
those improvements should flow down into the distribution. This guide
describes the manual process for that propagation.

The guide is deliberately manual in v1. Automation (`sync-distribution.sh`)
is planned for v2 — see the final section.

## When to sync

Sync when the upstream parent has new commits touching any methodology-bearing
file: hooks, agent stance definitions, slash commands, scripts, workflow
prompts, CLAUDE.md, AGENTS.md, or the main methodology doc.

You do **not** need to sync for parent-only artifacts — the parent's own
PRDs, PRPs, reviews, and audits live outside the distribution's scope.

Set `<PARENT_REPO>` once in your notes so you can refer to it when fetching
changes. Typical cadence is monthly, or whenever the parent ships a change
you specifically want.

## Terminology mapping

Apply this mapping mechanically when propagating upstream content. Order
matters only where one entry is a prefix of another (e.g., the
`push-hands-guard` entry must fire before the bare `push-hands` entry).

| Parent | Distribution |
|---|---|
| `Push Hands` / `Ontologi Push Hands` | `Dialectic` |
| `push-hands` (hyphenated, lowercase) | `dialectic` |
| `push_hands` | `dialectic` |
| `PUSH_HANDS_` (env var prefix) | `DIALECTIC_` |
| `<push-hands-reminder>` | `<dialectic-reminder>` |
| `.push-hands-tier` | `.dialectic-tier` |
| `push-hands.md` | `dialectic.md` |
| `push-hands-guard.sh` | `dialectic-guard.sh` |
| `push-hands-review.yml` | `dialectic-review.yml` |
| `tui shou` / `推手` / t'ai chi | Socratic / Hegelian dialectic |
| "structural integrity through continuous contact" | "dialectical contact between thesis and antithesis" |
| "Senior Training Partner" (role) | "Interlocutor" |
| `training-partner.md` (filenames) | `interlocutor.md` |
| "training partner" (generic metaphor) | "interlocutor" or "dialectical partner" |
| "listens through pressure" / "sense where it yields" | "stress-tests the proposal" / "surfaces where the argument fails" |
| "the practice" / "martial arts sense" | "the method" / "the discipline" |
| `Ontologi LLC` / `Ontologi` references | distribution maintainer attribution |
| Repo URL `ontologi/ontologi-push-hands` | `<org>/<repo>` |

Stances that **do not** change: Proposer, Code Reviewer, Security Auditor,
Skeptical Client, Defender.

## Sync approaches

Two approaches depending on your setup:

- **Approach A — Four-gate sync from a built distribution tree.** Canonical
  v1 flow. Use this when you have access to a fresh `distributions/dialectic/`
  output from a parent-repo build (e.g., you cloned the parent and ran
  `scripts/build-dialectic-distribution.sh`, or a collaborator shared the
  resulting tree). The terminology translation is already baked in; you are
  only propagating files. **Do not use `rsync --delete`** — the four-gate
  sequence below is explicitly designed without it.
- **Approach B — Selective cherry-pick from the upstream parent.** Use when
  you want to propagate a single specific commit and are willing to replay
  the terminology mapping by hand. Described after Approach A.

## Approach A: Four-gate sync (canonical v1 flow)

Four sequential gates. Each must pass before proceeding. No `rsync --delete`
anywhere in the sequence — the flow is non-destructive by construction and
surfaces all changes (including planned deletions) before any write.

Set `$SRC` to the built distribution tree (e.g., `$SRC=/path/to/parent/distributions/dialectic`)
and `$DST` to your fork's root (e.g., `$DST=~/dialectic-development`).

### Gate A — clean working tree check

Refuse to sync over local in-flight work. Gate A fails loudly rather than
silently overwriting uncommitted changes:

```bash
cd "$DST"
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: fork has uncommitted changes — commit, stash, or discard before sync." >&2
  git status --short
  exit 1
fi
```

Why this matters: without Gate A, `rsync` can silently overwrite in-progress
work in tracked files. Commit or stash before you sync.

### Gate B — dry-run inspection

Show exactly what will be added, modified, or would-be-removed before writing
anything. Two sub-commands because `rsync -n` does not surface would-be
deletions when `--delete` is omitted:

```bash
# Part 1: planned additions and modifications.
rsync -avn --exclude='.git' --exclude='.claude/settings.local.json' \
  "$SRC/" "$DST/"

# Part 2: files present in the fork but absent from the upstream distribution
# (these are the would-be deletions if you were using --delete; you are not,
# so they will be preserved — but you should eyeball the list).
diff -r --brief --exclude='.git' --exclude='.claude/settings.local.json' \
  "$SRC/" "$DST/" | grep '^Only in ' || true
```

Review both lists before proceeding. `Only in $DST/...` lines are fork-local
files (per-machine config, in-flight artifacts, local customizations) that
the sync will preserve.

### Gate C — explicit-removal manifest, then non-destructive sync

If upstream has deliberately removed files that you want to purge from the
fork, remove them by hand from a curated manifest. Then run `rsync` without
`--delete` — it adds new files, updates changed files, and leaves all
fork-local files alone:

```bash
# Apply explicit removals (empty for most syncs; one line per file that
# upstream removed and that you want gone from the fork):
# rm -f "$DST/<path>"

# Non-destructive sync: no --delete, so fork-local files survive.
rsync -av --exclude='.git' --exclude='.claude/settings.local.json' \
  "$SRC/" "$DST/"

cd "$DST"
git add -A
git diff --cached | head -100   # final review before commit
git commit -m "sync: <feature-slug> from upstream (<upstream-branch-or-sha>)"
```

### Gate D — post-sync verification

Confirm the fork still boots cleanly after the sync:

```bash
cd "$DST"
./scripts/setup.sh
bash tests/run_all.sh
```

If Gate D fails, investigate before pushing. Common causes: upstream added a
test that depends on a file not yet synced (re-run rsync), or an upstream
change collides with a fork-local customization (resolve by hand).

### Excludes — why these and not others

- `.git` — version control metadata; never sync.
- `.claude/settings.local.json` — Claude Code per-machine settings; written
  locally, never published in the distribution tree.
- `.github/` is **NOT** excluded. rsync's `--exclude='.git'` matches only
  path components named exactly `.git` — it does not also match `.github`.
  Workflow files DO get synced. Fork-local runner customization in
  `.github/workflows/` will be surfaced in Gate B's dry-run; if you want to
  keep the local variant, either add a targeted `--exclude` for that file or
  resolve the conflict by hand after Gate C.

### Why retire `rsync --delete`?

Earlier drafts of this guide used `rsync --delete` to force the fork to
exactly match the distribution tree. That flag is dangerous here because:

- **Silent overwrite of fork-local work.** A `.dialectic-tier` file from an
  in-progress feature branch, or a local PRD drafted but not yet pushed,
  would be deleted without warning.
- **No preview of what dies.** `rsync -n --delete` shows planned deletions
  but humans routinely skip the dry-run and reach for the destructive run
  directly.
- **False sense of determinism.** The fork being "in sync" with the
  distribution is less important than the fork being usable. A non-destructive
  sync plus an explicit-removal manifest achieves the same methodology state
  with a safer default.

The four-gate flow trades a one-time curation step (the removal manifest)
for much higher safety on every future sync.

## Approach B: Selective cherry-pick from upstream parent

Use this when you want a single specific upstream change without a full tree
sync, and you have direct access to the parent repo.

1. **Identify the upstream change.** Note the commit SHA or PR number in
   the parent repo. Read the diff — understand the intent, not just the text.
2. **Find the corresponding file(s) in the distribution.** Most upstream
   files map one-to-one; a handful (`push-hands.md` → `dialectic.md`,
   `training-partner.md` → `interlocutor.md`, `push-hands-guard.sh` →
   `dialectic-guard.sh`, `push-hands-review.yml` → `dialectic-review.yml`)
   are renamed.
3. **Apply the content change.** Replay the upstream diff against the
   distribution file, translating identifiers using the terminology
   mapping table above. For prose changes, rewrite with the dialectical
   framing in mind — avoid martial or practice-lineage vocabulary.
4. **Run the setup script.** From inside your fork root:
   ```bash
   ./scripts/setup.sh
   ```
5. **Run the distribution's tests.**
   ```bash
   bash tests/run_all.sh
   ```
6. **Commit.** Use a Conventional Commit message that references the
   upstream SHA or PR, e.g.:
   ```
   chore: sync dialectic-guard logic from upstream abc1234
   ```

## Known-preserved overrides

A small set of files are **hand-rewritten** for the distribution. The parent
build script already protects them via a `DO_NOT_OVERWRITE` allowlist, so
they do not change when the distribution is rebuilt upstream. When you sync
with Approach A, these files flow through rsync unchanged (they match what
upstream published last time) — but their upstream-published content is
itself the hand-rewritten variant, not a mechanical translation. If you
want to diverge further from the hand-rewritten defaults in your fork, do
it in a commit that post-dates the sync.

- `README.md` — framing and lineage paragraphs
- `dialectic.md` — executive summary, background, prior-art bullet
- `CLAUDE.md` — project-overview paragraphs
- `AGENTS.md` — intro and Interlocutor stance text
- `scripts/setup.sh` — cwd/toplevel guard added to prevent silent
  overwrite of parent `.git/hooks/`
- `docs/guides/sync-from-upstream.md` — this file
- `docs/guides/getting-started.md` — mentee onboarding guide

For Approach B (selective cherry-pick), do not copy the upstream diff
blindly into any of these files. Read the upstream change, decide which
parts of the intent apply to the distribution, and edit by hand.

## Future: automated sync

A `sync-distribution.sh` script is planned for v2. It will:

- Accept an upstream distribution-tree path (or commit range, for Approach B).
- Wrap Gates A → D above into a single invocation, with prompts for review
  between gates.
- Skip the hand-written overrides listed above, printing them for manual
  review.
- Produce a patch ready for human review before applying.

Until that lands, the four-gate process (Approach A) is the canonical
supported path.
