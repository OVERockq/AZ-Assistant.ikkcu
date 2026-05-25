#!/usr/bin/env bash
# ============================================================
#  AZ-Assistant — Tray App Build Script (통합 패키지)
#  실행: bash scripts/build-tray.sh [target]
#
#  target: current | mac | win | linux
# ============================================================
set -euo pipefail

BOLD="\033[1m"; GREEN="\033[32m"; CYAN="\033[36m"
YELLOW="\033[33m"; RED="\033[31m"; DIM="\033[2m"; RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
info() { echo -e "  ${CYAN}ℹ${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RELEASES_DIR="$ROOT_DIR/releases/tray"
TARGET="${1:-current}"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║  AZ-Assistant Tray App Build                 ║${RESET}"
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

# ── Tray TypeScript 컴파일 ────────────────────────────────────────────────────
step "Tray TypeScript 컴파일 (tsconfig.tray.json)"
npx tsc --project tsconfig.tray.json
ok "컴파일 완료 → tray-app/dist/"

# ── electron-builder 패키징 ──────────────────────────────────────────────────
step "실행파일 패키징 (electron-builder)"
mkdir -p "$RELEASES_DIR"

case "$TARGET" in
  mac)
    warn "macOS: 코드 서명 없이 빌드합니다."
    npx electron-builder --mac 2>&1 | grep -E "^\s*(•|✓|✗|packaging|building|downloaded|Error)" || true
    ;;
  win)
    warn "Windows 크로스 빌드는 Windows 환경 권장"
    npx electron-builder --win 2>&1 | grep -E "^\s*(•|✓|✗|packaging|building|downloaded|Error)" || true
    ;;
  linux)
    npx electron-builder --linux 2>&1 | grep -E "^\s*(•|✓|✗|packaging|building|downloaded|Error)" || true
    ;;
  current|*)
    info "현재 플랫폼 ($(uname -s)/$(uname -m)) 빌드"
    npx electron-builder 2>&1 | grep -E "^\s*(•|✓|✗|packaging|building|downloaded|Error)" || true
    ;;
esac

# ── 결과 ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}  ✅  빌드 완료!${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${RESET}"
echo ""
echo "  생성된 파일 (releases/tray/):"
ls -lh "$RELEASES_DIR" 2>/dev/null \
  | grep -v "^total" \
  | grep -Ev "blockmap|mac$|mac-arm64$|linux-unpacked|win-unpacked|builder-debug" \
  | awk '{printf "  %-50s %s\n", $NF, $5}'
echo ""
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo -e "  ${DIM}macOS: ZIP 압축 해제 후 AZ-Assistant.app을 Applications 폴더로 이동${RESET}"
  echo -e "  ${DIM}처음 실행 시 우클릭 → 열기 (보안 정책 우회)${RESET}"
fi
echo ""
