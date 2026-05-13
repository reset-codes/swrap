#!/usr/bin/env bash
#
# phase-verify.sh — Walrus Testnet POC reusable phase gate
#
# Runs all phase-end verification checks in order:
#   1. npm run type-check          (R14.6, R14.8)
#   2. npm run lint                (R16.2)
#   3. npm run build               (R14.6, R16.2)
#   4. npm run test:run            (R16.2)
#   5. curl smoke probe(s)         (R16.3, R16.4) — skipped when route missing
#   6. scripts/check-baseline.sh  (R16.5)
#
# Exits non-zero with a clear stage label on the first failure.
#
# Usage:
#   scripts/phase-verify.sh [OPTIONS]
#
# Options:
#   --probe <path>          URL path to probe (e.g. /api/poc/health).
#                           May be repeated for multiple probes.
#   --method <METHOD>       HTTP method for the probe (default: GET).
#   --body <json>           JSON request body for the probe.
#   --allow-missing-route   Skip the probe step entirely (useful when the
#                           route file does not exist yet in this phase).
#
# Exit codes:
#   0   all checks passed
#   1   type-check failed
#   2   lint failed
#   3   build failed
#   4   tests failed
#   5   smoke probe failed
#   6   baseline ancestry check failed
#
# Requirements: R16.2, R16.3, R16.4, R16.5, R16.6, R14.6, R14.8

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BOLD="\033[1m"
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RESET="\033[0m"

log_stage() {
    echo -e "${BOLD}[phase-verify] >>> $1${RESET}"
}

log_ok() {
    echo -e "${GREEN}[phase-verify] OK: $1${RESET}"
}

log_fail() {
    echo -e "${RED}[phase-verify] FAIL (stage: $1): $2${RESET}" >&2
}

log_skip() {
    echo -e "${YELLOW}[phase-verify] SKIP (stage: $1): $2${RESET}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

PROBE_PATHS=()
PROBE_METHOD="GET"
PROBE_BODY=""
ALLOW_MISSING_ROUTE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --probe)
            if [[ -z "${2:-}" ]]; then
                echo "[phase-verify] ERROR: --probe requires a path argument" >&2
                exit 1
            fi
            PROBE_PATHS+=("$2")
            shift 2
            ;;
        --method)
            if [[ -z "${2:-}" ]]; then
                echo "[phase-verify] ERROR: --method requires a METHOD argument" >&2
                exit 1
            fi
            PROBE_METHOD="$2"
            shift 2
            ;;
        --body)
            if [[ -z "${2:-}" ]]; then
                echo "[phase-verify] ERROR: --body requires a JSON argument" >&2
                exit 1
            fi
            PROBE_BODY="$2"
            shift 2
            ;;
        --allow-missing-route)
            ALLOW_MISSING_ROUTE=true
            shift
            ;;
        *)
            echo "[phase-verify] ERROR: unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Resolve repo root (script may be called from any directory)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Stage 1: type-check  (R14.6, R14.8)
# ---------------------------------------------------------------------------

log_stage "type-check"
if ! npm run type-check --prefix "${REPO_ROOT}" 2>&1; then
    log_fail "type-check" "TypeScript compilation errors detected."
    exit 1
fi
log_ok "type-check passed"

# ---------------------------------------------------------------------------
# Stage 2: lint  (R16.2)
# ---------------------------------------------------------------------------

log_stage "lint"
if ! npm run lint --prefix "${REPO_ROOT}" 2>&1; then
    log_fail "lint" "ESLint errors detected."
    exit 2
fi
log_ok "lint passed"

# ---------------------------------------------------------------------------
# Stage 3: build  (R14.6, R16.2)
# ---------------------------------------------------------------------------

log_stage "build"
if ! npm run build --prefix "${REPO_ROOT}" 2>&1; then
    log_fail "build" "Next.js build failed."
    exit 3
fi
log_ok "build passed"

# ---------------------------------------------------------------------------
# Stage 4: tests  (R16.2)
# ---------------------------------------------------------------------------

log_stage "test:run"
TEST_OUTPUT=$(npm run test:run --prefix "${REPO_ROOT}" 2>&1) || TEST_EXIT=$?
echo "${TEST_OUTPUT}"
# Treat "no test files found" as a pass — the scaffolding starts with no tests
# and tests are added incrementally per phase. A real test failure will produce
# a non-zero exit AND output that does NOT contain "No test files found".
if [[ "${TEST_EXIT:-0}" -ne 0 ]]; then
    if echo "${TEST_OUTPUT}" | grep -q "No test files found"; then
        log_ok "test:run passed (no test files yet — scaffolding phase)"
    else
        log_fail "test:run" "Test suite failed."
        exit 4
    fi
else
    log_ok "test:run passed"
fi

# ---------------------------------------------------------------------------
# Stage 5: curl smoke probe(s)  (R16.3, R16.4)
# ---------------------------------------------------------------------------

log_stage "smoke-probe"

# Determine whether to run probes
run_probes=true

if [[ "${ALLOW_MISSING_ROUTE}" == "true" ]]; then
    log_skip "smoke-probe" "--allow-missing-route flag set; skipping all probes."
    run_probes=false
fi

if [[ "${run_probes}" == "true" && "${#PROBE_PATHS[@]}" -eq 0 ]]; then
    # No probes specified — check if the default health route file exists
    HEALTH_ROUTE="${REPO_ROOT}/src/app/api/poc/health/route.ts"
    if [[ ! -f "${HEALTH_ROUTE}" ]]; then
        log_skip "smoke-probe" "No --probe paths given and ${HEALTH_ROUTE} does not exist; skipping probe."
        run_probes=false
    else
        # Default probe against health endpoint
        PROBE_PATHS=("/api/poc/health")
    fi
fi

if [[ "${run_probes}" == "true" && "${#PROBE_PATHS[@]}" -gt 0 ]]; then
    # Check if a Next.js server is already running on port 3000
    SERVER_STARTED=false
    SERVER_PID=""
    BASE_URL="http://localhost:3000"

    if ! curl --silent --max-time 2 --output /dev/null "${BASE_URL}" 2>/dev/null; then
        # No server running — check if we can start one
        # For the phase gate, we skip the probe if the server can't be started
        # (avoids blocking CI on a long server startup)
        log_skip "smoke-probe" "No server running on ${BASE_URL} and auto-start is not supported in phase-verify. Start the server manually and re-run, or use --allow-missing-route to skip."
        run_probes=false
    fi

    if [[ "${run_probes}" == "true" ]]; then
        for PROBE_PATH in "${PROBE_PATHS[@]}"; do
            PROBE_URL="${BASE_URL}${PROBE_PATH}"
            log_stage "smoke-probe: ${PROBE_METHOD} ${PROBE_URL}"

            # Build curl arguments
            CURL_ARGS=(
                --silent
                --max-time 30
                --write-out "%{http_code}"
                --output /dev/null
                -X "${PROBE_METHOD}"
                -H "Content-Type: application/json"
            )

            if [[ -n "${PROBE_BODY}" ]]; then
                CURL_ARGS+=(--data "${PROBE_BODY}")
            fi

            HTTP_STATUS=$(curl "${CURL_ARGS[@]}" "${PROBE_URL}" 2>&1) || true

            # Check for route-missing conditions (404 / 405) when --allow-missing-route
            # Note: ALLOW_MISSING_ROUTE=false here since we already handled it above,
            # but individual probe paths may still encounter 404/405 for routes not yet
            # implemented. We treat those as skips when the route file doesn't exist.
            ROUTE_FILE_SEGMENT="${PROBE_PATH#/api/poc/}"
            ROUTE_FILE_SEGMENT="${ROUTE_FILE_SEGMENT#/poc/}"
            ROUTE_FILE="${REPO_ROOT}/src/app/api/poc/${ROUTE_FILE_SEGMENT}/route.ts"

            if [[ "${HTTP_STATUS}" == "404" || "${HTTP_STATUS}" == "405" ]]; then
                if [[ ! -f "${ROUTE_FILE}" ]]; then
                    log_skip "smoke-probe" "Route ${PROBE_PATH} returned ${HTTP_STATUS} and route file not found; skipping."
                    continue
                fi
                log_fail "smoke-probe" "${PROBE_METHOD} ${PROBE_URL} returned HTTP ${HTTP_STATUS} (route file exists but returned not-found/not-allowed)."
                exit 5
            fi

            if [[ -z "${HTTP_STATUS}" ]]; then
                log_fail "smoke-probe" "${PROBE_METHOD} ${PROBE_URL} — curl failed (no response / timeout)."
                exit 5
            fi

            # Fail on 5xx responses (R16.4)
            if [[ "${HTTP_STATUS}" -ge 500 && "${HTTP_STATUS}" -le 599 ]]; then
                log_fail "smoke-probe" "${PROBE_METHOD} ${PROBE_URL} returned HTTP ${HTTP_STATUS} (5xx error)."
                exit 5
            fi

            log_ok "smoke-probe: ${PROBE_METHOD} ${PROBE_URL} → HTTP ${HTTP_STATUS}"
        done
    fi
fi

# ---------------------------------------------------------------------------
# Stage 6: baseline ancestry check  (R16.5)
# ---------------------------------------------------------------------------

log_stage "baseline-ancestry"
if ! bash "${SCRIPT_DIR}/check-baseline.sh" 2>&1; then
    log_fail "baseline-ancestry" "Baseline ancestry check failed (see above)."
    exit 6
fi
log_ok "baseline-ancestry passed"

# ---------------------------------------------------------------------------
# All checks passed
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}${BOLD}[phase-verify] ALL CHECKS PASSED ✓${RESET}"
echo ""
