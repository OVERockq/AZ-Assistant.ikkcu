#!/usr/bin/env bash
# ============================================================
#  AZ-Assistant — Installer Build Script (통합 패키지)
#  실행: bash scripts/build-installer.sh [target]
#
#  target: all | win | mac-x64 | mac-arm64 | linux
# ============================================================
set -euo pipefail

BOLD="\033[1m"; GREEN="\033[32m"; CYAN="\033[36m"
YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
info() { echo -e "  ${CYAN}ℹ${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RELEASES_DIR="$ROOT_DIR/releases"
TARGET="${1:-all}"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║  AZ-Assistant Installer Build                ║${RESET}"
echo -e "${BOLD}${CYAN}║  Target: ${TARGET}$(printf '%*s' $((36 - ${#TARGET})) '')║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}"
echo ""

cd "$ROOT_DIR"

# ── 의존성 ───────────────────────────────────────────────────────────────────
step "의존성 확인"
command -v node >/dev/null || fail "Node.js가 필요합니다."
command -v npm  >/dev/null || fail "npm이 필요합니다."
ok "Node.js $(node --version) / npm $(npm --version)"

if [ ! -d node_modules ]; then
  info "npm install 실행 중..."
  npm install --silent
fi
ok "node_modules 확인"

# ── Chrome Extension 빌드 ────────────────────────────────────────────────────
step "Chrome Extension 빌드 (Vite)"
npm run build
if [ ! -f dist/manifest.json ]; then fail "빌드 실패: dist/manifest.json 없음"; fi
ok "Extension 빌드 완료 → dist/"

# ── Extension 파일 복사 ──────────────────────────────────────────────────────
step "Extension 파일을 installer/extension/ 으로 복사"
rm -rf installer/extension
cp -r dist/ installer/extension/
FILE_COUNT=$(find installer/extension -type f | wc -l | tr -d ' ')
ok "${FILE_COUNT}개 파일 복사 완료 → installer/extension/"

# ── Installer TypeScript 컴파일 ──────────────────────────────────────────────
step "Installer TypeScript 컴파일 (tsconfig.installer.json)"
npx tsc --project tsconfig.installer.json
ok "컴파일 완료 → installer/dist/"

# ── 실행파일 패키징 ──────────────────────────────────────────────────────────
step "실행파일 패키징 (@yao-pkg/pkg)"
mkdir -p "$RELEASES_DIR"

pkg_build() {
  local target_flag="$1"
  local output_path="$2"
  local label="$3"

  info "$label 빌드 중..."
  npx @yao-pkg/pkg installer/dist/index.js \
    --target "$target_flag" \
    --output "$output_path" \
    --compress GZip \
    2>&1 | grep -v "^>" | grep -v "^$" || true

  local file="${output_path}"
  [ -f "${output_path}.exe" ] && file="${output_path}.exe"
  if [ -f "$file" ]; then
    local size; size=$(du -sh "$file" | cut -f1)
    ok "$label → $(basename $file)  ($size)"
  else
    warn "$label 출력 파일을 확인하세요."
  fi
}

case "$TARGET" in
  win)       pkg_build "node20-win-x64"     "$RELEASES_DIR/az-assistant-installer-win.exe"  "Windows x64" ;;
  mac-x64)   pkg_build "node20-macos-x64"   "$RELEASES_DIR/az-assistant-installer-mac-x64"  "macOS Intel" ;;
  mac-arm64) pkg_build "node20-macos-arm64" "$RELEASES_DIR/az-assistant-installer-mac-arm64" "macOS Apple Silicon" ;;
  linux)     pkg_build "node20-linux-x64"   "$RELEASES_DIR/az-assistant-installer-linux"     "Linux x64" ;;
  all|*)
    # 순차 빌드 (동시 실행 시 pkg 캐시 충돌 방지)
    pkg_build "node20-macos-arm64" "$RELEASES_DIR/az-assistant-installer-mac-arm64" "macOS Apple Silicon"
    pkg_build "node20-macos-x64"   "$RELEASES_DIR/az-assistant-installer-mac-x64"  "macOS Intel"
    pkg_build "node20-win-x64"     "$RELEASES_DIR/az-assistant-installer-win.exe"  "Windows x64"
    pkg_build "node20-linux-x64"   "$RELEASES_DIR/az-assistant-installer-linux"    "Linux x64"
    ;;
esac

# ── 결과 ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}  ✅  빌드 완료!${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${RESET}"
echo ""
echo "  생성된 파일 (releases/):"
ls -lh "$RELEASES_DIR" 2>/dev/null \
  | grep -E "installer-(win|mac|linux)" \
  | awk '{printf "  %-45s %s\n", $NF, $5}'
echo ""
