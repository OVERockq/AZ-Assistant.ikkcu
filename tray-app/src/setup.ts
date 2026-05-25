import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";

export const AZ_HOME = path.join(os.homedir(), ".az-assistant");
export const INSTALL_DIR = path.join(AZ_HOME, "extension");
export const RECORD_PATH = path.join(AZ_HOME, "install.json");

const IS_WINDOWS = os.platform() === "win32";
const IS_MAC = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";

export type InstallRecord = {
  version?: string;
  installedAt?: string;
  extensionPath?: string;
};

export function isInstalled(): boolean {
  return fs.existsSync(path.join(INSTALL_DIR, "manifest.json"));
}

export function getRecord(): InstallRecord | null {
  try {
    return JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as InstallRecord;
  } catch {
    return null;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirRecursive(s, d) : fs.writeFileSync(d, fs.readFileSync(s));
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

export function installExtension(extensionSrc: string, onProgress: (msg: string) => void): void {
  if (!fs.existsSync(extensionSrc) || !fs.existsSync(path.join(extensionSrc, "manifest.json"))) {
    throw new Error(`Extension 파일을 찾을 수 없습니다: ${extensionSrc}`);
  }
  if (fs.existsSync(INSTALL_DIR)) onProgress("기존 설치 파일을 업데이트합니다...");
  copyDirRecursive(extensionSrc, INSTALL_DIR);
  fs.mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
  fs.writeFileSync(RECORD_PATH, JSON.stringify({
    version: "0.1.0",
    installedAt: new Date().toISOString(),
    extensionPath: INSTALL_DIR,
    platform: os.platform(),
    arch: os.arch(),
  }, null, 2), "utf8");
  onProgress(`Extension 파일 ${countFiles(INSTALL_DIR)}개 설치 완료`);
}

export function findChrome(): string | null {
  if (IS_MAC) {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].find((p) => fs.existsSync(p)) ?? null;
  }
  if (IS_WINDOWS) {
    const bases = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter(Boolean) as string[];
    for (const b of bases)
      for (const s of ["Google\\Chrome\\Application\\chrome.exe", "Google\\Chrome Beta\\Application\\chrome.exe"]) {
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
  if (IS_LINUX) {
    for (const cmd of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
      try {
        const r = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim();
        if (r && fs.existsSync(r)) return r;
      } catch { /* ignore */ }
    }
  }
  return null;
}

export function launchChromeWithExtension(chromePath: string, extensionPath: string): void {
  const flags = [
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  let child;
  if (IS_MAC) {
    child = spawn("open", ["-a", chromePath, "--args", ...flags], { detached: true, stdio: "ignore" });
  } else if (IS_WINDOWS) {
    child = spawn(chromePath, flags, { detached: true, stdio: "ignore", shell: true });
  } else {
    child = spawn(chromePath, flags, { detached: true, stdio: "ignore" });
  }
  child.unref();
}
