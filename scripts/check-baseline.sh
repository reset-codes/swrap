#!/usr/bin/env bash
#
# check-baseline.sh — Walrus Testnet POC baseline gate
#
# Verifies the two git invariants that all POC phases depend on:
#   (R1.3) the annotated tag `v0-baseline` exists and resolves to a commit.
#   (R1.4) the current HEAD descends from `v0-baseline` (i.e. the branch was
#          forked from the baseline and has not drifted away from it).
#   (R16.5) `git merge-base --is-ancestor v0-baseline HEAD` exits 0.
#
# Fails fast with a descriptive, stage-labeled error on the first failure.
# Intended to be composed into `scripts/phase-verify.sh` in a later task.
#
# Usage:
#   scripts/check-baseline.sh
#
# Exit codes:
#   0  both checks passed
#   1  baseline tag missing or unreachable
#   2  HEAD is not a descendant of v0-baseline
#   3  not inside a git work tree

set -euo pipefail

BASELINE_TAG="v0-baseline"

# --- stage: repo ---
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[check-baseline] FAIL (stage: repo): not inside a git work tree" >&2
    exit 3
fi

# --- stage: tag ---
if ! BASELINE_SHA=$(git rev-parse --verify --quiet "${BASELINE_TAG}^{commit}"); then
    cat >&2 <<EOF
[check-baseline] FAIL (stage: tag): git tag "${BASELINE_TAG}" does not resolve.

  Expected: an annotated tag "${BASELINE_TAG}" pointing at the baseline commit
            "chore: v0 baseline before walrus integration".

  Fix:      recreate the tag at the baseline commit, e.g.
              git tag -a ${BASELINE_TAG} <sha> -m "v0 baseline before walrus integration"
EOF
    exit 1
fi

# --- stage: ancestry ---
if ! git merge-base --is-ancestor "${BASELINE_TAG}" HEAD; then
    HEAD_SHA=$(git rev-parse HEAD)
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    cat >&2 <<EOF
[check-baseline] FAIL (stage: ancestry): HEAD does not descend from ${BASELINE_TAG}.

  ${BASELINE_TAG} -> ${BASELINE_SHA}
  HEAD           -> ${HEAD_SHA} (${CURRENT_BRANCH})

  Expected: "git merge-base --is-ancestor ${BASELINE_TAG} HEAD" to exit 0
            (the walrus-poc branch must be a descendant of the baseline tag).

  Fix:      rebase the current branch onto ${BASELINE_TAG}, or recreate the
            walrus-poc branch from ${BASELINE_TAG} and reapply the POC work.
EOF
    exit 2
fi

echo "[check-baseline] OK: ${BASELINE_TAG} -> ${BASELINE_SHA} is an ancestor of HEAD"
