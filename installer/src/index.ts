#!/usr/bin/env node
/**
 * AZ-Assistant Chrome Extension Installer
 * Supports: Windows, macOS (Intel + Apple Silicon), Linux
 *
 * Usage:
 *   ./installer            → install
 *   ./installer uninstall  → uninstall
 *   ./installer --uninstall
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import * as readline from "readline";

// ─── ANSI Color Helpers ───────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const isWindows = os.platform() === "win32";
const isMac = os.platform() === "darwin";
const isLinux = os.platform() === "linux";

const AZ_HOME = path.join(os.homedir(), ".az-assistant");
const INSTALL_DIR = path.join(AZ_HOME, "extension");
const RECORD_PATH = path.join(AZ_HOME, "install.json");

// ─── Logging ──────────────────────────────────────────────────────────────────
function print(msg: string) { process.stdout.write(msg + "\n"); }
function success(msg: string) { print(`  ${c.green}✓${c.reset}  ${msg}`); }
function info(msg: string)    { print(`  ${c.blue}ℹ${c.reset}  ${msg}`); }
function warn(msg: string)    { print(`  ${c.yellow}⚠${c.reset}  ${msg}`); }
function error(msg: string)   { print(`  ${c.red}✗${c.reset}  ${msg}`); }
function step(n: number, msg: string) {
  print(`\n${c.bold}${c.cyan}[${n}]${c.reset}${c.bold} ${msg}${c.reset}`);
}
function divider() { print(`  ${c.dim}${"─".repeat(50)}${c.reset}`); }

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner(mode: "install" | "uninstall") {
  const label = mode === "uninstall" ? "Uninstaller v0.1.0" : "Installer  v0.1.0";
  print("");
  print(`  ${c.bold}${c.cyan}┌─────────────────────────────────────────────┐${c.reset}`);
  print(`  ${c.bold}${c.cyan}│                                             │${c.reset}`);
  print(`  ${c.bold}${c.cyan}│   🤖  AZ-Assistant Chrome Extension         │${c.reset}`);
  print(`  ${c.bold}${c.cyan}│          ${label}               │${c.reset}`);
  print(`  ${c.bold}${c.cyan}│                                             │${c.reset}`);
  print(`  ${c.bold}${c.cyan}└─────────────────────────────────────────────┘${c.reset}`);
  print("");
  info(`Platform: ${c.bold}${os.platform()}${c.reset} / Arch: ${c.bold}${os.arch()}${c.reset}`);
  print("");
}

// ─── File Utilities ───────────────────────────────────────────────────────────
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    }
  }
}

function countFiles(dir: string): number {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
    }
  } catch { /* ignore */ }
  return n;
}

function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;
  // Node 14.14+ built-in
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Chrome Detection ─────────────────────────────────────────────────────────
function findChromeMac(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findChromeWindows(): string | null {
  const bases = [
    process.env["PROGRAMFILES"],
    process.env["PROGRAMFILES(X86)"],
    process.env["LOCALAPPDATA"],
  ].filter(Boolean) as string[];
  const subs = [
    "Google\\Chrome\\Application\\chrome.exe",
    "Google\\Chrome Beta\\Application\\chrome.exe",
  ];
  for (const b of bases) for (const s of subs) {
    const p = path.join(b, s);
    if (fs.existsSync(p)) return p;
  }
  try {
    const reg = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve 2>nul',
      { encoding: "utf8" }
    );
    const m = reg.match(/REG_SZ\s+(.+\.exe)/i);
    if (m?.[1]) return m[1].trim();
  } catch { /* ignore */ }
  return null;
}

function findChromeLinux(): string | null {
  const cmds = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "chrome"];
  for (const cmd of cmds) {
    try {
      const r = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim();
      if (r && fs.existsSync(r)) return r;
    } catch { /* ignore */ }
  }
  return null;
}

function findChrome(): string | null {
  if (isMac) return findChromeMac();
  if (isWindows) return findChromeWindows();
  if (isLinux) return findChromeLinux();
  return null;
}

// ─── Chrome Launch ────────────────────────────────────────────────────────────
function launchChromeWithExtension(chromePath: string, extensionPath: string): boolean {
  const flags = [
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  try {
    let child;
    if (isMac) {
      child = spawn("open", ["-a", chromePath, "--args", ...flags], { detached: true, stdio: "ignore" });
    } else if (isWindows) {
      child = spawn(chromePath, flags, { detached: true, stdio: "ignore", shell: true });
    } else {
      child = spawn(chromePath, flags, { detached: true, stdio: "ignore" });
    }
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

// ─── Install Record ───────────────────────────────────────────────────────────
function writeInstallRecord(installDir: string) {
  fs.mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
  fs.writeFileSync(RECORD_PATH, JSON.stringify({
    version: "0.1.0",
    installedAt: new Date().toISOString(),
    extensionPath: installDir,
    platform: os.platform(),
    arch: os.arch(),
  }, null, 2), "utf8");
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function readInstallRecord(): { extensionPath?: string; version?: string; installedAt?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(RECORD_PATH, "utf8"));
  } catch {
    return null;
  }
}

// ─── Manual Instructions ──────────────────────────────────────────────────────
function showInstallInstructions(extensionPath: string) {
  print("");
  print(`  ${c.bold}${c.yellow}📋  수동 설치 방법 (Manual Installation)${c.reset}`);
  divider();
  print(`  ${c.bold}1.${c.reset} Chrome 주소창에 입력:  ${c.cyan}${c.bold}chrome://extensions/${c.reset}`);
  print(`  ${c.bold}2.${c.reset} 우측 상단 ${c.bold}"개발자 모드"${c.reset} (Developer mode) 활성화`);
  print(`  ${c.bold}3.${c.reset} ${c.bold}"압축해제된 확장 프로그램을 로드합니다"${c.reset} (Load unpacked) 클릭`);
  print(`  ${c.bold}4.${c.reset} 아래 폴더 선택:`);
  print(`     ${c.cyan}${c.bold}${extensionPath}${c.reset}`);
  print(`  ${c.bold}5.${c.reset} 툴바에 ${c.bold}AZ-Assistant${c.reset} 아이콘이 나타납니다! 🎉`);
  divider();
}

function showUninstallChromeInstructions() {
  print("");
  print(`  ${c.bold}${c.yellow}📋  Chrome에서 Extension 제거 방법${c.reset}`);
  divider();
  print(`  ${c.bold}1.${c.reset} Chrome 주소창에 입력:  ${c.cyan}${c.bold}chrome://extensions/${c.reset}`);
  print(`  ${c.bold}2.${c.reset} ${c.bold}AZ-Assistant.ikkcu${c.reset} 카드를 찾아`);
  print(`     ${c.bold}"제거"${c.reset} (Remove) 버튼 클릭`);
  divider();
}

// ─── INSTALL ──────────────────────────────────────────────────────────────────
async function runInstall() {
  banner("install");

  const isPkg = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;
  const extensionSrc = isPkg
    ? path.join(__dirname, "..", "extension")
    : path.join(__dirname, "..", "..", "extension");

  // Step 1: 파일 복사
  step(1, "Extension 파일 설치 중...");

  if (!fs.existsSync(extensionSrc) || !fs.existsSync(path.join(extensionSrc, "manifest.json"))) {
    error("번들된 Extension 파일을 찾을 수 없습니다.");
    error(`경로: ${extensionSrc}`);
    process.exit(1);
  }

  info(`설치 경로: ${c.cyan}${INSTALL_DIR}${c.reset}`);
  try {
    if (fs.existsSync(INSTALL_DIR)) info("기존 설치 파일을 업데이트합니다...");
    copyDirRecursive(extensionSrc, INSTALL_DIR);
    success(`Extension 파일 ${countFiles(INSTALL_DIR)}개 설치 완료`);
    writeInstallRecord(INSTALL_DIR);
  } catch (e) {
    error(`파일 설치 실패: ${e}`);
    if (isWindows) warn("관리자 권한으로 실행해 보세요. (우클릭 → 관리자 권한으로 실행)");
    process.exit(1);
  }

  // Step 2: Chrome 탐지
  step(2, "Chrome 브라우저 감지 중...");
  const chromePath = findChrome();
  if (!chromePath) {
    warn("Google Chrome을 찾을 수 없습니다.");
    info("Chrome을 먼저 설치해 주세요: https://www.google.com/chrome/");
  } else {
    success(`Chrome 발견: ${chromePath}`);
  }

  // Step 3: Extension 로드
  step(3, "Chrome Extension 로드");
  if (chromePath) {
    print("");
    warn("Chrome이 실행 중인 경우, --load-extension 플래그는 새 창에서만 적용됩니다.");
    print("");
    const ans = await askQuestion(`  ${c.bold}Chrome을 자동으로 실행할까요? (y/N): ${c.reset}`);
    if (ans.toLowerCase() === "y" || ans.toLowerCase() === "yes") {
      if (launchChromeWithExtension(chromePath, INSTALL_DIR)) {
        success("Chrome을 Extension과 함께 실행했습니다!");
        info("새로운 Chrome 창에 AZ-Assistant Extension이 로드됩니다.");
      } else {
        warn("Chrome 자동 실행에 실패했습니다. 수동으로 설치해 주세요.");
      }
    }
  }

  showInstallInstructions(INSTALL_DIR);

  print(`  ${c.bold}${c.green}✅  설치 완료! AZ-Assistant를 즐겨보세요.${c.reset}`);
  print("");
  info("업데이트 시 동일한 설치 프로그램을 다시 실행하면 됩니다.");
  info(`설치 정보: ${RECORD_PATH}`);
  print("");

  if (isWindows) await askQuestion("  계속하려면 Enter를 누르세요...");
}

// ─── UNINSTALL ────────────────────────────────────────────────────────────────
async function runUninstall() {
  banner("uninstall");

  // 설치 기록 확인
  const record = readInstallRecord();
  const installed = fs.existsSync(INSTALL_DIR);

  if (!installed && !record) {
    warn("설치된 AZ-Assistant를 찾을 수 없습니다.");
    info(`확인 경로: ${AZ_HOME}`);
    print("");
    if (isWindows) await askQuestion("  계속하려면 Enter를 누르세요...");
    return;
  }

  // 설치 정보 출력
  step(1, "설치 정보 확인");
  if (record) {
    info(`버전:      ${record.version ?? "알 수 없음"}`);
    info(`설치일:    ${record.installedAt ? formatDate(new Date(record.installedAt)) : "알 수 없음"}`);
    info(`설치 경로: ${c.cyan}${AZ_HOME}${c.reset}`);
  } else {
    info(`설치 경로: ${c.cyan}${AZ_HOME}${c.reset}`);
  }

  // 확인 프롬프트
  print("");
  const ans = await askQuestion(
    `  ${c.bold}${c.red}정말로 AZ-Assistant를 삭제하시겠습니까? (y/N): ${c.reset}`
  );
  if (ans.toLowerCase() !== "y" && ans.toLowerCase() !== "yes") {
    print("");
    info("삭제가 취소되었습니다.");
    print("");
    if (isWindows) await askQuestion("  계속하려면 Enter를 누르세요...");
    return;
  }

  // Step 2: 파일 삭제
  step(2, "설치 파일 삭제 중...");
  try {
    removeDirRecursive(AZ_HOME);
    success(`삭제 완료: ${AZ_HOME}`);
  } catch (e) {
    error(`파일 삭제 실패: ${e}`);
    if (isWindows) warn("관리자 권한으로 실행해 보세요. (우클릭 → 관리자 권한으로 실행)");
    process.exit(1);
  }

  // Step 3: Chrome에서 Extension 제거 안내
  step(3, "Chrome에서 Extension 제거");
  showUninstallChromeInstructions();

  print(`  ${c.bold}${c.green}✅  삭제 완료!${c.reset}`);
  print("");

  if (isWindows) await askQuestion("  계속하려면 Enter를 누르세요...");
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isUninstall =
    args.includes("uninstall") ||
    args.includes("--uninstall") ||
    args.includes("-u");

  if (isUninstall) {
    await runUninstall();
  } else {
    await runInstall();
  }
}

main().catch((e) => {
  error(`예기치 않은 오류: ${e}`);
  process.exit(1);
});
