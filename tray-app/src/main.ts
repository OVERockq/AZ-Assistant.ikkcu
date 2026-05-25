/**
 * AZ-Assistant Tray Application
 *
 * Features:
 *  - System tray icon (Windows taskbar / macOS menu bar / Linux tray)
 *  - Status display (extension installed or not)
 *  - Live log viewer window
 *  - Login auto-start toggle (macOS/Windows native + Linux .desktop)
 *  - Quit menu item
 *  - Single-instance lock → OS notification on duplicate launch
 */

import {
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  BrowserWindow,
  shell,
} from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createTrayIconBuffer } from "./icon";

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_NAME = "AZ-Assistant";
const APP_VERSION = "0.1.0";
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

const AZ_HOME = path.join(os.homedir(), ".az-assistant");
const LOG_FILE = path.join(AZ_HOME, "az-assistant.log");
const RECORD_FILE = path.join(AZ_HOME, "install.json");
const EXT_DIR = path.join(AZ_HOME, "extension");
const AUTOSTART_DESKTOP = path.join(
  os.homedir(),
  ".config",
  "autostart",
  "az-assistant.desktop"
);

// ─── Single-Instance Lock ─────────────────────────────────────────────────────
// Must be called before app.whenReady()
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // A primary instance already exists — it will show a notification.
  app.quit();
  process.exit(0);
}

// ─── macOS: hide dock icon (tray-only app) ────────────────────────────────────
app.setName(APP_NAME);
if (IS_MAC && app.dock) app.dock.hide();

// ─── State ────────────────────────────────────────────────────────────────────
let tray: Tray | null = null;
let logWin: BrowserWindow | null = null;
const logLines: string[] = [];
const MAX_LINES = 500;

// ─── Logging ──────────────────────────────────────────────────────────────────
function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}
function fmtDate(d: Date) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function writeLog(msg: string) {
  const line = `[${fmtDate(new Date())}] ${msg}`;
  logLines.push(line);
  if (logLines.length > MAX_LINES) logLines.shift();

  // Append to file
  try {
    fs.mkdirSync(AZ_HOME, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    /* ignore */
  }

  // Push to open log window
  if (logWin && !logWin.isDestroyed()) {
    logWin.webContents
      .executeJavaScript(
        `typeof appendLog==='function'&&appendLog(${JSON.stringify(line)})`
      )
      .catch(() => {});
  }
}

// ─── Status Helpers ───────────────────────────────────────────────────────────
function isInstalled() {
  return fs.existsSync(path.join(EXT_DIR, "manifest.json"));
}

type Record_ = { version?: string; installedAt?: string };
function getRecord(): Record_ | null {
  try {
    return JSON.parse(fs.readFileSync(RECORD_FILE, "utf8")) as Record_;
  } catch {
    return null;
  }
}

// ─── Auto-start ───────────────────────────────────────────────────────────────
function isAutoStartEnabled(): boolean {
  if (IS_LINUX) return fs.existsSync(AUTOSTART_DESKTOP);
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled: boolean) {
  if (IS_LINUX) {
    if (enabled) {
      const dir = path.dirname(AUTOSTART_DESKTOP);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        AUTOSTART_DESKTOP,
        [
          "[Desktop Entry]",
          "Type=Application",
          `Name=${APP_NAME}`,
          `Exec=${process.execPath}`,
          "Hidden=false",
          "X-GNOME-Autostart-enabled=true",
        ].join("\n") + "\n"
      );
    } else {
      try {
        fs.unlinkSync(AUTOSTART_DESKTOP);
      } catch {
        /* ignore */
      }
    }
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      name: APP_NAME,
    });
  }
  writeLog(`자동 실행 ${enabled ? "활성화" : "비활성화"}`);
}

// ─── Log Viewer Window ────────────────────────────────────────────────────────
function openLogWindow() {
  if (logWin && !logWin.isDestroyed()) {
    logWin.focus();
    return;
  }

  logWin = new BrowserWindow({
    width: 740,
    height: 540,
    minWidth: 480,
    minHeight: 300,
    title: `${APP_NAME} — 실행 로그`,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  logWin.setMenuBarVisibility(false);
  logWin.on("closed", () => {
    logWin = null;
  });

  const safeLogFile = LOG_FILE.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const initLogs = JSON.stringify(logLines);

  const html = /* html */ `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval'">
<title>${APP_NAME} 로그</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#1e1e1e;--bg2:#252526;--border:#333;--text:#d4d4d4;--ts:#6a9955;--blue:#4a90e2;--hover:#2a2a2a}
  body{font-family:'Consolas','D2Coding',monospace;font-size:12.5px;background:var(--bg);color:var(--text);display:flex;flex-direction:column;height:100vh;user-select:text}
  #hdr{display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0}
  #hdr h1{flex:1;font-size:13px;color:var(--blue);font-weight:600;white-space:nowrap}
  .btn{padding:3px 9px;border:1px solid #555;background:#2d2d2d;color:#ccc;border-radius:3px;cursor:pointer;font-size:11px;white-space:nowrap}
  .btn:hover{background:#383838;color:#fff}
  #log-wrap{flex:1;overflow-y:auto;padding:4px 0}
  .row{display:flex;padding:1px 14px;line-height:1.65}
  .row:hover{background:var(--hover)}
  .ts{color:var(--ts);white-space:nowrap;margin-right:6px;flex-shrink:0}
  .msg{white-space:pre-wrap;word-break:break-all}
  #footer{padding:5px 14px;background:var(--bg2);border-top:1px solid var(--border);font-size:11px;color:#666;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  ::-webkit-scrollbar{width:7px}
  ::-webkit-scrollbar-track{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:#555;border-radius:4px}
  ::-webkit-scrollbar-thumb:hover{background:#777}
</style>
</head>
<body>
<div id="hdr">
  <h1>🤖 ${APP_NAME} — 실행 로그</h1>
  <button class="btn" id="autoscroll-btn" onclick="toggleAutoScroll()">📌 고정</button>
  <button class="btn" onclick="scrollBottom()">↓ 최신</button>
  <button class="btn" onclick="copyAll()">📋 복사</button>
  <button class="btn" onclick="clearView()">🗑 초기화</button>
</div>
<div id="log-wrap"></div>
<div id="footer">📄 ${safeLogFile}</div>

<script>
const wrap = document.getElementById('log-wrap');
const autoScrollBtn = document.getElementById('autoscroll-btn');
let autoScroll = true;

function setAutoScrollUI(v) {
  autoScroll = v;
  autoScrollBtn.textContent = v ? '📌 고정' : '▶ 따라가기';
  autoScrollBtn.style.color = v ? '#6a9955' : '#d4d4d4';
}

function toggleAutoScroll() { setAutoScrollUI(!autoScroll); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendLog(line) {
  const m = line.match(/^(\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\])(.*)/s);
  const row = document.createElement('div');
  row.className = 'row';
  if (m) {
    row.innerHTML = '<span class="ts">' + escHtml(m[1]) + '</span><span class="msg">' + escHtml(m[2]) + '</span>';
  } else {
    row.innerHTML = '<span class="msg">' + escHtml(line) + '</span>';
  }
  wrap.appendChild(row);
  if (autoScroll) wrap.scrollTop = wrap.scrollHeight;
}

function scrollBottom() { wrap.scrollTop = wrap.scrollHeight; setAutoScrollUI(true); }
function clearView() { wrap.innerHTML = ''; }

async function copyAll() {
  const text = [...wrap.querySelectorAll('.row')].map(r => r.textContent ?? '').join('\\n');
  await navigator.clipboard.writeText(text);
}

wrap.addEventListener('scroll', () => {
  const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 30;
  if (autoScroll !== atBottom) setAutoScrollUI(atBottom);
});

// Load initial buffer
const init = ${initLogs};
init.forEach(appendLog);
scrollBottom();
</script>
</body>
</html>`;

  logWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
  writeLog("로그 창 열림");
}

// ─── Tray Menu ────────────────────────────────────────────────────────────────
function buildMenu(): Menu {
  const installed = isInstalled();
  const rec = getRecord();
  const autoStart = isAutoStartEnabled();

  const statusLabel = installed
    ? `🟢  설치됨  v${rec?.version ?? "?"}`
    : "🔴  미설치";

  let dateLabel = "";
  if (rec?.installedAt) {
    const d = new Date(rec.installedAt);
    dateLabel = `📅  설치일: ${fmtDate(d).slice(0, 10)}`;
  }

  return Menu.buildFromTemplate([
    // ── Title ──────────────────────────────────────────────
    { label: `  ${APP_NAME}  v${APP_VERSION}`, enabled: false },
    { type: "separator" },
    // ── Status ─────────────────────────────────────────────
    { label: `  ${statusLabel}`, enabled: false },
    ...(dateLabel ? [{ label: `  ${dateLabel}`, enabled: false }] : []),
    { type: "separator" },
    // ── Actions ────────────────────────────────────────────
    {
      label: "  📋  로그 보기",
      click: () => openLogWindow(),
    },
    {
      label: "  📁  설치 폴더 열기",
      enabled: installed,
      click: () => {
        void shell.openPath(EXT_DIR);
        writeLog("설치 폴더 열기");
      },
    },
    { type: "separator" },
    // ── Auto-start ─────────────────────────────────────────
    {
      label: "  🔄  로그인 시 자동 실행",
      type: "checkbox",
      checked: autoStart,
      click: (item) => {
        setAutoStart(item.checked);
        rebuildMenu();
      },
    },
    { type: "separator" },
    // ── Quit ───────────────────────────────────────────────
    {
      label: "  ❌  종료",
      click: () => {
        writeLog("사용자 종료 요청");
        app.quit();
      },
    },
  ]);
}

function rebuildMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildMenu());
    tray.setToolTip(
      `${APP_NAME}\n${isInstalled() ? "✅ 설치됨" : "❌ 미설치"}`
    );
  }
}

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    fs.mkdirSync(AZ_HOME, { recursive: true });
  } catch {
    /* ignore */
  }

  writeLog(
    `${APP_NAME} 트레이 시작 (${process.platform}/${process.arch}, Electron ${process.versions.electron})`
  );

  // Create tray icon from pure Node.js PNG generator
  const iconBuf = createTrayIconBuffer();
  const icon = nativeImage.createFromBuffer(iconBuf);
  if (IS_MAC) icon.setTemplateImage(true); // auto dark/light mode

  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME}\n${isInstalled() ? "✅ 설치됨" : "❌ 미설치"}`);
  tray.setContextMenu(buildMenu());

  // Left-click → open menu (macOS default is right-click only)
  tray.on("click", () => tray?.popUpContextMenu());

  // Refresh status every 60 s (in case extension is installed externally)
  setInterval(rebuildMenu, 60_000);

  writeLog("트레이 아이콘 생성 완료");

  // Welcome notification
  if (Notification.isSupported()) {
    new Notification({
      title: APP_NAME,
      body: "트레이에서 실행 중입니다.",
    }).show();
  }
});

// ─── Second Instance → Notification ─────────────────────────────────────────
app.on("second-instance", (_event, argv) => {
  writeLog(`중복 실행 감지 (args: ${argv.slice(1).join(" ")})`);

  if (Notification.isSupported()) {
    new Notification({
      title: APP_NAME,
      body: "이미 실행 중입니다.\n트레이 아이콘을 확인해 주세요.",
    }).show();
  }

  // Bring log window to front if it's open
  if (logWin && !logWin.isDestroyed()) {
    if (logWin.isMinimized()) logWin.restore();
    logWin.focus();
  }
});

// ─── Keep alive when all windows closed ──────────────────────────────────────
// On Windows/Linux the default is to quit when all windows close.
// Handling this event (even empty) prevents that, keeping the tray alive.
app.on("window-all-closed", () => {
  // intentionally empty — stay in tray
});

app.on("will-quit", () => {
  writeLog(`${APP_NAME} 종료`);
});
