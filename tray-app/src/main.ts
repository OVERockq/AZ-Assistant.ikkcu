/**
 * AZ-Assistant Tray Application
 *
 * First run: shows install wizard window, copies extension files.
 * Subsequent runs: sits in system tray with status/log menu.
 */

import {
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  BrowserWindow,
  shell,
  dialog,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { createTrayIconBuffer } from "./icon";
import {
  isInstalled,
  getRecord,
  installExtension,
  findChrome,
  launchChromeWithExtension,
  AZ_HOME,
  INSTALL_DIR,
} from "./setup";

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_NAME = "AZ-Assistant";
const APP_VERSION = "0.1.0";
const IS_MAC = process.platform === "darwin";
const LOG_FILE = path.join(AZ_HOME, "az-assistant.log");
const AUTOSTART_DESKTOP = path.join(
  require("os").homedir(),
  ".config", "autostart", "az-assistant.desktop"
);

// ─── Single-Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.setName(APP_NAME);
if (IS_MAC && app.dock) app.dock.hide();

// ─── State ────────────────────────────────────────────────────────────────────
let tray: Tray | null = null;
let logWin: BrowserWindow | null = null;
let setupWin: BrowserWindow | null = null;
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
  try {
    fs.mkdirSync(AZ_HOME, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch { /* ignore */ }
  if (logWin && !logWin.isDestroyed()) {
    logWin.webContents
      .executeJavaScript(`typeof appendLog==='function'&&appendLog(${JSON.stringify(line)})`)
      .catch(() => {});
  }
}

// ─── Auto-start ───────────────────────────────────────────────────────────────
function isAutoStartEnabled(): boolean {
  if (process.platform === "linux") return fs.existsSync(AUTOSTART_DESKTOP);
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled: boolean) {
  if (process.platform === "linux") {
    if (enabled) {
      fs.mkdirSync(path.dirname(AUTOSTART_DESKTOP), { recursive: true });
      fs.writeFileSync(AUTOSTART_DESKTOP, [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${APP_NAME}`,
        `Exec=${process.execPath}`,
        "Hidden=false",
        "X-GNOME-Autostart-enabled=true",
      ].join("\n") + "\n");
    } else {
      try { fs.unlinkSync(AUTOSTART_DESKTOP); } catch { /* ignore */ }
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, name: APP_NAME });
  }
  writeLog(`자동 실행 ${enabled ? "활성화" : "비활성화"}`);
}

// ─── Setup / Install Wizard Window ───────────────────────────────────────────
function openSetupWindow(onComplete: () => void): void {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }

  setupWin = new BrowserWindow({
    width: 580,
    height: 500,
    resizable: false,
    center: true,
    title: `${APP_NAME} 설치`,
    backgroundColor: "#1e1e1e",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  if (IS_MAC && app.dock) app.dock.show();
  setupWin.setMenuBarVisibility(false);

  setupWin.on("closed", () => {
    setupWin = null;
    if (IS_MAC && app.dock) app.dock.hide();
    onComplete();
  });

  setupWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildSetupHtml())}`);
  setupWin.webContents.on("did-finish-load", () => { runInstall().catch(console.error); });

  async function runInstall() {
    const push = (type: "info" | "ok" | "warn" | "error", msg: string) => {
      if (!setupWin || setupWin.isDestroyed()) return;
      setupWin.webContents
        .executeJavaScript(`typeof pushLine==='function'&&pushLine(${JSON.stringify({ type, msg })})`)
        .catch(() => {});
    };

    const extensionSrc = app.isPackaged
      ? path.join(process.resourcesPath, "extension")
      : path.join(__dirname, "..", "..", "dist");

    push("info", "Extension 파일 설치 중...");
    push("info", `설치 경로: ${INSTALL_DIR}`);

    try {
      installExtension(extensionSrc, (msg) => push("info", msg));
      push("ok", "Extension 설치 완료!");
    } catch (e) {
      push("error", `설치 실패: ${e}`);
      if (process.platform === "win32")
        push("warn", "관리자 권한으로 실행해 보세요. (우클릭 → 관리자 권한으로 실행)");
      showDoneButton("닫기");
      return;
    }

    push("info", "Chrome 브라우저 탐지 중...");
    const chromePath = findChrome();
    if (!chromePath) {
      push("warn", "Google Chrome을 찾을 수 없습니다.");
    } else {
      push("ok", `Chrome 발견: ${chromePath}`);
    }

    if (chromePath && setupWin && !setupWin.isDestroyed()) {
      const { response } = await dialog.showMessageBox(setupWin, {
        type: "question",
        buttons: ["예", "아니오"],
        defaultId: 0,
        title: "Chrome 실행",
        message: "Chrome을 Extension과 함께 실행할까요?",
        detail: "실행 중인 Chrome이 있으면 새 창으로 열립니다.",
      });
      if (response === 0) {
        try {
          launchChromeWithExtension(chromePath, INSTALL_DIR);
          push("ok", "Chrome을 Extension과 함께 실행했습니다!");
        } catch {
          push("warn", "Chrome 자동 실행에 실패했습니다.");
        }
      }
    }

    push("info", "");
    push("info", "──── 수동 설치 방법 ────");
    push("info", "1. Chrome 주소창: chrome://extensions/");
    push("info", "2. 우측 상단 '개발자 모드' 활성화");
    push("info", "3. '압축해제된 확장 프로그램을 로드합니다' 클릭");
    push("info", `4. 폴더 선택: ${INSTALL_DIR}`);
    push("ok", "설치 완료! AZ-Assistant를 즐겨보세요. 🎉");

    showDoneButton("트레이로 이동");
  }

  function showDoneButton(label: string) {
    if (!setupWin || setupWin.isDestroyed()) return;
    setupWin.webContents
      .executeJavaScript(`typeof showDone==='function'&&showDone(${JSON.stringify(label)})`)
      .catch(() => {});
  }
}

function buildSetupHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">
<title>${APP_NAME} 설치</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI','Apple SD Gothic Neo',sans-serif;background:#1e1e1e;color:#d4d4d4;display:flex;flex-direction:column;height:100vh;overflow:hidden}
#hdr{padding:20px 24px 16px;background:#252526;border-bottom:1px solid #333;flex-shrink:0}
#hdr h1{font-size:18px;font-weight:700;color:#4a90e2}
#hdr p{font-size:12px;color:#888;margin-top:4px}
#log{flex:1;overflow-y:auto;padding:12px 24px;font-family:'Consolas','D2Coding',monospace;font-size:12px}
.line{display:flex;align-items:flex-start;gap:8px;padding:2px 0;line-height:1.6}
.icon{flex-shrink:0;width:14px;text-align:center}
.info .icon::before{content:'ℹ';color:#6a9955}
.ok   .icon::before{content:'✓';color:#4caf50}
.warn .icon::before{content:'⚠';color:#ffc107}
.error .icon::before{content:'✗';color:#f44336}
.msg{white-space:pre-wrap;word-break:break-all}
.empty{height:8px}
#footer{padding:14px 24px;background:#252526;border-top:1px solid #333;flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
#status{font-size:12px;color:#666}
#done-btn{display:none;padding:8px 24px;background:#4a90e2;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer;font-weight:600}
#done-btn:hover{background:#357abd}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:#1e1e1e}
::-webkit-scrollbar-thumb{background:#555;border-radius:3px}
</style>
</head>
<body>
<div id="hdr">
  <h1>🤖 AZ-Assistant 설치</h1>
  <p>Chrome Extension을 설치하고 있습니다...</p>
</div>
<div id="log"></div>
<div id="footer">
  <span id="status">설치 진행 중...</span>
  <button id="done-btn" onclick="window.close()">완료</button>
</div>
<script>
const log=document.getElementById('log');
const status=document.getElementById('status');
const doneBtn=document.getElementById('done-btn');
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function pushLine({type,msg}){
  if(!msg){const e=document.createElement('div');e.className='empty';log.appendChild(e);return}
  const row=document.createElement('div');
  row.className='line '+type;
  row.innerHTML='<span class="icon"></span><span class="msg">'+escHtml(msg)+'</span>';
  log.appendChild(row);
  log.scrollTop=log.scrollHeight;
}
function showDone(label){
  status.textContent='';
  doneBtn.textContent=label;
  doneBtn.style.display='block';
}
</script>
</body>
</html>`;
}

// ─── Log Viewer Window ────────────────────────────────────────────────────────
function openLogWindow() {
  if (logWin && !logWin.isDestroyed()) { logWin.focus(); return; }

  logWin = new BrowserWindow({
    width: 740,
    height: 540,
    minWidth: 480,
    minHeight: 300,
    title: `${APP_NAME} — 실행 로그`,
    backgroundColor: "#1e1e1e",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  logWin.setMenuBarVisibility(false);
  logWin.on("closed", () => { logWin = null; });

  const safeLogFile = LOG_FILE.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const initLogs = JSON.stringify(logLines);

  const html = `<!DOCTYPE html>
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
const wrap=document.getElementById('log-wrap');
const autoScrollBtn=document.getElementById('autoscroll-btn');
let autoScroll=true;
function setAutoScrollUI(v){autoScroll=v;autoScrollBtn.textContent=v?'📌 고정':'▶ 따라가기';autoScrollBtn.style.color=v?'#6a9955':'#d4d4d4'}
function toggleAutoScroll(){setAutoScrollUI(!autoScroll)}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function appendLog(line){const m=line.match(/^(\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\])(.*)/s);const row=document.createElement('div');row.className='row';if(m){row.innerHTML='<span class="ts">'+escHtml(m[1])+'</span><span class="msg">'+escHtml(m[2])+'</span>'}else{row.innerHTML='<span class="msg">'+escHtml(line)+'</span>'}wrap.appendChild(row);if(autoScroll)wrap.scrollTop=wrap.scrollHeight}
function scrollBottom(){wrap.scrollTop=wrap.scrollHeight;setAutoScrollUI(true)}
function clearView(){wrap.innerHTML=''}
async function copyAll(){const text=[...wrap.querySelectorAll('.row')].map(r=>r.textContent??'').join('\\n');await navigator.clipboard.writeText(text)}
wrap.addEventListener('scroll',()=>{const atBottom=wrap.scrollTop+wrap.clientHeight>=wrap.scrollHeight-30;if(autoScroll!==atBottom)setAutoScrollUI(atBottom)});
const init=${initLogs};init.forEach(appendLog);scrollBottom();
</script>
</body>
</html>`;

  logWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  writeLog("로그 창 열림");
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function buildMenu(): Menu {
  const installed = isInstalled();
  const rec = getRecord();
  const autoStart = isAutoStartEnabled();
  const statusLabel = installed ? `🟢  설치됨  v${rec?.version ?? "?"}` : "🔴  미설치";
  const dateLabel = rec?.installedAt
    ? `📅  설치일: ${fmtDate(new Date(rec.installedAt)).slice(0, 10)}`
    : "";

  return Menu.buildFromTemplate([
    { label: `  ${APP_NAME}  v${APP_VERSION}`, enabled: false },
    { type: "separator" },
    { label: `  ${statusLabel}`, enabled: false },
    ...(dateLabel ? [{ label: `  ${dateLabel}`, enabled: false }] : []),
    { type: "separator" },
    { label: "  📋  로그 보기", click: () => openLogWindow() },
    {
      label: "  📁  설치 폴더 열기",
      enabled: installed,
      click: () => { void shell.openPath(INSTALL_DIR); writeLog("설치 폴더 열기"); },
    },
    { type: "separator" },
    {
      label: "  🔄  로그인 시 자동 실행",
      type: "checkbox",
      checked: autoStart,
      click: (item) => { setAutoStart(item.checked); rebuildMenu(); },
    },
    { type: "separator" },
    { label: "  ❌  종료", click: () => { writeLog("사용자 종료 요청"); app.quit(); } },
  ]);
}

function rebuildMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildMenu());
    tray.setToolTip(`${APP_NAME}\n${isInstalled() ? "✅ 설치됨" : "❌ 미설치"}`);
  }
}

function createTray() {
  const iconBuf = createTrayIconBuffer();
  const icon = nativeImage.createFromBuffer(iconBuf);
  if (IS_MAC) icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME}\n${isInstalled() ? "✅ 설치됨" : "❌ 미설치"}`);
  tray.setContextMenu(buildMenu());
  tray.on("click", () => tray?.popUpContextMenu());
  setInterval(rebuildMenu, 60_000);
  writeLog("트레이 아이콘 생성 완료");
}

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  try { fs.mkdirSync(AZ_HOME, { recursive: true }); } catch { /* ignore */ }
  writeLog(`${APP_NAME} 시작 (${process.platform}/${process.arch}, Electron ${process.versions.electron})`);

  const startTray = () => {
    createTray();
    if (Notification.isSupported()) {
      new Notification({ title: APP_NAME, body: "트레이에서 실행 중입니다." }).show();
    }
  };

  if (!isInstalled()) {
    openSetupWindow(startTray);
  } else {
    startTray();
  }
});

app.on("second-instance", (_event, argv) => {
  writeLog(`중복 실행 감지 (args: ${argv.slice(1).join(" ")})`);
  if (Notification.isSupported()) {
    new Notification({ title: APP_NAME, body: "이미 실행 중입니다.\n트레이 아이콘을 확인해 주세요." }).show();
  }
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  if (logWin && !logWin.isDestroyed()) {
    if (logWin.isMinimized()) logWin.restore();
    logWin.focus();
  }
});

app.on("window-all-closed", () => { /* stay in tray */ });
app.on("will-quit", () => { writeLog(`${APP_NAME} 종료`); });
