#!/bin/bash
# Fails if any defender-authored commit in the current feature branch touched
# forbidden paths or added files outside the PR diff scope. Called by
# /review-code-team before the review artifact is written; also runnable
# standalone for auditing.
#
# Usage: scripts/check-defender-scope.sh <slug>
#
# Defender commits are discriminated by the `fix(defender):` subject
# convention documented in the defender stance. A defender commit that
# touches any of the forbidden paths (the PRP, CLAUDE.md, methodology
# directories) or introduces a file that is not in `git diff main...HEAD`
# is a violation.
set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "usage: check-defender-scope.sh <slug>" >&2
  exit 2
fi

FORBIDDEN_PATHS=(
  "docs/PRPs/${SLUG}.md"
  "CLAUDE.md"
  "prompts/"
  ".claude/commands/"
  ".claude/hooks/"
  ".claude/agents/"
)

COMMITS=$(git log main..HEAD --grep='^fix(defender):' --format='%H' 2>/dev/null || echo "")
if [ -z "$COMMITS" ]; then
  echo "OK: no defender commits on this branch"
  exit 0
fi

violations=0
diff_scope=$(git diff --name-only main...HEAD 2>/dev/null || echo "")

for sha in $COMMITS; do
  touched=$(git show --name-only --format='' "$sha")

  for path in "${FORBIDDEN_PATHS[@]}"; do
    hits=$(echo "$touched" | grep -E "^${path}" || true)
    if [ -n "$hits" ]; then
      echo "VIOLATION: defender commit $sha touched forbidden path: $hits" >&2
      violations=$((violations + 1))
    fi
  done

  for file in $touched; do
    [ -z "$file" ] && continue
    if ! echo "$diff_scope" | grep -qFx "$file"; then
      echo "VIOLATION: defender commit $sha added out-of-scope file: $file" >&2
      violations=$((violations + 1))
    fi
  done
done

if [ "$violations" -gt 0 ]; then
  echo "FAIL: $violations defender-scope violation(s) detected" >&2
  exit 1
fi
echo "OK: all defender commits touched only allowed-scope files"
