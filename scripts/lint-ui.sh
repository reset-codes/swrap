#!/usr/bin/env bash
# lint-ui.sh — composite UI lint gate
# Validates: R19.3, R19.6, R19.9, R19.16
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=1
exit_code=$PASS

# ── 1. ESLint ────────────────────────────────────────────────────────────────
echo "▶ Running npm run lint..."
if ! npm run lint; then
  echo "✗ lint failed"
  exit_code=$FAIL
fi

# ── 2. WCAG contrast check ───────────────────────────────────────────────────
echo "▶ Running npm run check:contrast..."
if ! npm run check:contrast; then
  echo "✗ check:contrast failed"
  exit_code=$FAIL
fi

# ── 3. next/font/google must only appear in apps/web/fonts.ts ────────────────
# Only check apps/web/**; only flag real import statements (not vi.mock or comments).
echo "▶ Checking for next/font/google imports outside apps/web/fonts.ts..."
FONT_GOOGLE_HITS=$(
  grep -rn "^import .*from ['\"]next/font/google['\"]" \
    --include="*.ts" --include="*.tsx" \
    apps/web/ \
  | grep -v "^apps/web/fonts\.ts:" \
  || true
)
if [ -n "$FONT_GOOGLE_HITS" ]; then
  echo "✗ next/font/google imported outside apps/web/fonts.ts:"
  echo "$FONT_GOOGLE_HITS"
  exit_code=$FAIL
else
  echo "✓ next/font/google only in apps/web/fonts.ts"
fi

# ── 4. @font-face must only appear in apps/web/fonts.ts ─────────────────────
# Only check apps/web/**; match the CSS at-rule (not comments).
echo "▶ Checking for @font-face rules outside apps/web/fonts.ts..."
FONT_FACE_HITS=$(
  grep -rn "@font-face" \
    --include="*.ts" --include="*.tsx" --include="*.css" \
    apps/web/ \
  | grep -v "^apps/web/fonts\.ts:" \
  || true
)
if [ -n "$FONT_FACE_HITS" ]; then
  echo "✗ @font-face declared outside apps/web/fonts.ts:"
  echo "$FONT_FACE_HITS"
  exit_code=$FAIL
else
  echo "✓ @font-face only in apps/web/fonts.ts"
fi

# ── 5. No @dnd-kit or react-beautiful-dnd in forms components ────────────────
# Only flag real import statements (not comments or JSDoc).
echo "▶ Checking for drag-library imports in apps/web/components/forms/**..."
DND_HITS=$(
  grep -rn "^import .*from ['\"]@dnd-kit\|^import .*from ['\"]react-beautiful-dnd" \
    --include="*.ts" --include="*.tsx" \
    apps/web/components/forms/ \
  || true
)
if [ -n "$DND_HITS" ]; then
  echo "✗ Drag-library imports found in apps/web/components/forms/:"
  echo "$DND_HITS"
  exit_code=$FAIL
else
  echo "✓ No drag-library imports in apps/web/components/forms/"
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
if [ "$exit_code" -eq "$PASS" ]; then
  echo "✅ lint:ui passed"
else
  echo "❌ lint:ui failed — see errors above"
fi

exit "$exit_code"
