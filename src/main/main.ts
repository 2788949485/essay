import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray
} from "electron";
import type { MenuItemConstructorOptions, MessageBoxOptions } from "electron";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toMarkdown } from "../shared/markdown.js";
import type { AppSettings, ExportPayload, NoteRecord, SettingsUpdatePayload } from "../shared/types.js";

const DEFAULT_HOTKEY = "CommandOrControl+Alt+J";
type StoredSettings = Omit<AppSettings, "hasPrivacyPin"> & {
  privacyPinHash: string | null;
  privacyPinSalt: string | null;
};

const DEFAULT_SETTINGS: StoredSettings = {
  hotkey: DEFAULT_HOTKEY,
  startHidden: false,
  lockOnHide: true,
  privacyPinHash: null,
  privacyPinSalt: null
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let notesDir = "";
let backupsDir = "";
let settingsPath = "";

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

const emptyDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph"
    }
  ]
};

function assetPath(fileName: string) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "build", fileName);
  }
  return path.join(app.getAppPath(), "build", fileName);
}

async function ensureStorage() {
  const dataRoot = app.getPath("userData");
  notesDir = path.join(dataRoot, "notes");
  backupsDir = path.join(dataRoot, "backups");
  settingsPath = path.join(dataRoot, "settings.json");
  await fs.mkdir(notesDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
}

function notePath(id: string) {
  return path.join(notesDir, `${id}.json`);
}

function backupPath(prefix: string, id: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(backupsDir, `${prefix}-${stamp}-${id}.json`);
}

function publicSettings(settings: StoredSettings): AppSettings {
  return {
    hotkey: settings.hotkey,
    startHidden: settings.startHidden,
    lockOnHide: settings.lockOnHide,
    hasPrivacyPin: Boolean(settings.privacyPinHash && settings.privacyPinSalt)
  };
}

function hashPin(pin: string, salt: string) {
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

function verifyPin(settings: StoredSettings, pin: string) {
  if (!settings.privacyPinHash || !settings.privacyPinSalt) return true;
  const expected = Buffer.from(settings.privacyPinHash, "hex");
  const actual = Buffer.from(hashPin(pin, settings.privacyPinSalt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function atomicWriteFile(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function backupExistingNote(id: string, prefix = "note") {
  try {
    await fs.copyFile(notePath(id), backupPath(prefix, id));
  } catch {
    // No backup is needed when the note does not exist yet.
  }
}

async function pruneBackups(limit = 80) {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(backupsDir, entry.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtime: stat.mtimeMs };
        })
    );
    const stale = files.sort((a, b) => b.mtime - a.mtime).slice(limit);
    await Promise.all(stale.map((file) => fs.rm(file.filePath, { force: true })));
  } catch {
    // Backup pruning should never block note saving.
  }
}

function safeExportName(name: string, ext: string) {
  const base = (name || "未命名记录")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "未命名记录"}.${ext}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function buildHtmlExport(note: NoteRecord) {
  const title = escapeHtml(note.title || "未命名记录");
  const createdAt = formatExportDate(note.createdAt);
  const updatedAt = formatExportDate(note.updatedAt);
  const plainText = note.plainText.trim();
  const wordCount = plainText ? Array.from(plainText.replace(/\s+/g, "")).length : 0;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --paper: #fffdf8;
      --ink: #28251f;
      --muted: #777064;
      --line: #ded2bd;
      --accent: #2f6b57;
      --accent-soft: #e5f0ea;
      --code-bg: #26302c;
      --code-ink: #f8f1e6;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      line-height: 1.75;
    }

    .page {
      width: min(920px, calc(100% - 32px));
      margin: 32px auto;
      padding: 42px 48px 56px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 16px 42px rgba(74, 61, 39, 0.12);
    }

    header {
      padding-bottom: 24px;
      margin-bottom: 28px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0 0 14px;
      font-size: clamp(30px, 5vw, 44px);
      line-height: 1.2;
      letter-spacing: 0;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      color: var(--muted);
      font-size: 13px;
    }

    .meta span {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 1px 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #faf6ed;
    }

    main {
      font-size: 16px;
    }

    main > *:first-child {
      margin-top: 0;
    }

    main > *:last-child {
      margin-bottom: 0;
    }

    h2, h3, h4 {
      margin: 1.6em 0 0.65em;
      line-height: 1.3;
    }

    h2 {
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      font-size: 26px;
    }

    h3 {
      font-size: 21px;
    }

    p {
      margin: 0.85em 0;
    }

    a {
      color: #1b6fba;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 18px auto;
      border-radius: 8px;
      border: 1px solid var(--line);
    }

    blockquote {
      margin: 20px 0;
      padding: 12px 18px;
      border-left: 4px solid #d39d51;
      background: #fbf3e4;
      color: #4d4a42;
    }

    ul, ol {
      padding-left: 26px;
    }

    li + li {
      margin-top: 4px;
    }

    ul[data-type="taskList"] {
      padding-left: 0;
      list-style: none;
    }

    ul[data-type="taskList"] li {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }

    ul[data-type="taskList"] label {
      padding-top: 2px;
    }

    code {
      padding: 2px 5px;
      border-radius: 4px;
      background: #eee5d5;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.92em;
    }

    pre {
      overflow-x: auto;
      margin: 18px 0;
      padding: 16px 18px;
      border-radius: 8px;
      background: var(--code-bg);
      color: var(--code-ink);
    }

    pre code {
      padding: 0;
      background: transparent;
      color: inherit;
    }

    mark {
      border-radius: 4px;
      background: #ffe08a;
      padding: 0 3px;
    }

    hr {
      height: 1px;
      margin: 28px 0;
      border: 0;
      background: var(--line);
    }

    footer {
      margin-top: 40px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    @media print {
      body {
        background: #fff;
      }

      .page {
        width: auto;
        margin: 0;
        padding: 0;
        border: 0;
        box-shadow: none;
      }
    }

    @media (max-width: 640px) {
      .page {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 28px 20px 40px;
        border: 0;
        border-radius: 0;
      }
    }
  </style>
</head>
<body>
  <article class="page">
    <header>
      <h1>${title}</h1>
      <div class="meta">
        ${createdAt ? `<span>创建：${escapeHtml(createdAt)}</span>` : ""}
        ${updatedAt ? `<span>更新：${escapeHtml(updatedAt)}</span>` : ""}
        <span>字数：${wordCount}</span>
        <span>由随记导出</span>
      </div>
    </header>
    <main>
      ${note.html || "<p></p>"}
    </main>
    <footer>
      Copyright (c) 2026 Suiji. Exported from 随记.
    </footer>
  </article>
</body>
</html>`;
}

function normalizeNote(raw: Partial<NoteRecord>): NoteRecord {
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "未命名记录",
    excerpt: typeof raw.excerpt === "string" ? raw.excerpt : "",
    pinnedAt: typeof raw.pinnedAt === "string" ? raw.pinnedAt : null,
    content: raw.content ?? emptyDoc,
    html: typeof raw.html === "string" ? raw.html : "",
    plainText: typeof raw.plainText === "string" ? raw.plainText : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now
  };
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    await writeStoredSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}

async function readSettings(): Promise<AppSettings> {
  return publicSettings(await readStoredSettings());
}

async function writeStoredSettings(settings: StoredSettings) {
  await atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
}

async function updateStoredSettings(payload: SettingsUpdatePayload): Promise<AppSettings> {
  const current = await readStoredSettings();
  const next: StoredSettings = {
    ...current,
    hotkey: payload.hotkey || DEFAULT_HOTKEY,
    startHidden: Boolean(payload.startHidden),
    lockOnHide: Boolean(payload.lockOnHide)
  };

  if (payload.clearPrivacyPin) {
    next.privacyPinHash = null;
    next.privacyPinSalt = null;
  } else if (payload.privacyPin?.trim()) {
    const salt = randomBytes(16).toString("hex");
    next.privacyPinSalt = salt;
    next.privacyPinHash = hashPin(payload.privacyPin.trim(), salt);
  }

  await writeStoredSettings(next);
  return publicSettings(next);
}

async function listNotes(): Promise<NoteRecord[]> {
  const files = await fs.readdir(notesDir);
  const notes = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const raw = await fs.readFile(path.join(notesDir, file), "utf8");
        return normalizeNote(JSON.parse(raw));
      })
  );

  return sortNotes(notes);
}

function sortNotes(notes: NoteRecord[]) {
  return [...notes].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

async function saveNote(note: NoteRecord): Promise<NoteRecord> {
  const plainText = note.plainText.trim();
  const normalized = normalizeNote({
    ...note,
    title: note.title.trim() || plainText.split(/\r?\n/)[0] || "未命名记录",
    excerpt: plainText.replace(/\s+/g, " ").slice(0, 120),
    updatedAt: new Date().toISOString()
  });

  await backupExistingNote(normalized.id);
  await atomicWriteFile(notePath(normalized.id), JSON.stringify(normalized, null, 2));
  void pruneBackups();
  return normalized;
}

async function readNote(id: string): Promise<NoteRecord> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("Invalid note id");
  }
  const raw = await fs.readFile(notePath(id), "utf8");
  return normalizeNote(JSON.parse(raw));
}

async function togglePinNote(id: string): Promise<NoteRecord> {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    pinnedAt: note.pinnedAt ? null : new Date().toISOString()
  });
  await backupExistingNote(next.id);
  await atomicWriteFile(notePath(next.id), JSON.stringify(next, null, 2));
  void pruneBackups();
  return next;
}

async function createNote(): Promise<NoteRecord> {
  const now = new Date().toISOString();
  const note = normalizeNote({
    id: randomUUID(),
    title: "未命名记录",
    content: emptyDoc,
    createdAt: now,
    updatedAt: now
  });
  await atomicWriteFile(notePath(note.id), JSON.stringify(note, null, 2));
  return note;
}

async function deleteNote(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("Invalid note id");
  }
  await backupExistingNote(id, "deleted");
  await fs.rm(notePath(id), { force: true });
  void pruneBackups();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: "随记",
    icon: assetPath("icon.ico"),
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      void lockContentForPrivacy();
      mainWindow?.hide();
    }
  });

  mainWindow.on("minimize", () => {
    void lockContentForPrivacy();
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function lockContentForPrivacy() {
  const settings = await readStoredSettings();
  if (settings.lockOnHide) {
    mainWindow?.webContents.send("privacy:lock");
  }
}

function createApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建记录",
          accelerator: "CommandOrControl+N",
          click: () => mainWindow?.webContents.send("menu:new-note")
        },
        { type: "separator" },
        {
          label: "隐藏窗口",
          accelerator: "Escape",
          click: () => {
            void lockContentForPrivacy();
            mainWindow?.hide();
          }
        },
        {
          label: "退出",
          accelerator: "CommandOrControl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        {
          label: "查找",
          accelerator: "CommandOrControl+F",
          click: () => mainWindow?.webContents.send("menu:find")
        },
        {
          label: "替换",
          accelerator: "CommandOrControl+H",
          click: () => mainWindow?.webContents.send("menu:replace")
        },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于随记",
          click: () => {
            const options = {
              type: "info",
              title: "关于随记",
              message: "随记",
              detail:
                "版本：0.1.0\n版权：Copyright (c) 2026 Suiji. All rights reserved.\n\n随记是快捷呼出的本地自动保存富文本记录工具。笔记默认保存在本机用户数据目录，导出文件为明文，请自行确认保存位置安全。"
            } as const;
            if (mainWindow) {
              void dialog.showMessageBox(mainWindow, options);
            } else {
              void dialog.showMessageBox(options);
            }
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    void lockContentForPrivacy();
    mainWindow.hide();
    return;
  }
  showWindow();
}

function registerHotkey(hotkey: string) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(hotkey || DEFAULT_HOTKEY, toggleWindow);
  if (!ok) {
    globalShortcut.register(DEFAULT_HOTKEY, toggleWindow);
  }
}

function createTray(settings: AppSettings) {
  const trayIcon = nativeImage.createFromPath(assetPath("icon.ico"));
  tray = new Tray(trayIcon.isEmpty() ? assetPath("icon.png") : trayIcon);
  tray.setToolTip(`随记 - ${settings.hotkey} 呼出`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示随记", click: showWindow },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("double-click", showWindow);
}

function registerIpc() {
  ipcMain.handle("notes:list", listNotes);
  ipcMain.handle("notes:create", createNote);
  ipcMain.handle("notes:save", (_event, note: NoteRecord) => saveNote(note));
  ipcMain.handle("notes:toggle-pin", (_event, id: string) => togglePinNote(id));
  ipcMain.handle("notes:delete", (_event, id: string) => deleteNote(id));
  ipcMain.handle("notes:export", async (_event, payload: ExportPayload) => {
    const ext = payload.format;
    const warningOptions: MessageBoxOptions = {
      type: "warning",
      buttons: ["继续导出", "取消"],
      cancelId: 1,
      defaultId: 1,
      title: "导出明文文件",
      message: "导出的文件会以明文保存",
      detail: "请确认保存位置安全，避免把包含隐私的记录导出到公共目录、同步盘或共享设备。"
    };
    const warning = mainWindow
      ? await dialog.showMessageBox(mainWindow, warningOptions)
      : await dialog.showMessageBox(warningOptions);
    if (warning.response !== 0) return null;

    const dialogOptions = {
      title: "导出记录",
      defaultPath: safeExportName(payload.note.title, ext),
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) return null;

    const content =
      payload.format === "html"
        ? buildHtmlExport(payload.note)
        : payload.format === "json"
          ? JSON.stringify(payload.note, null, 2)
          : payload.format === "md"
            ? toMarkdown(payload.note.content)
            : payload.note.plainText;

    await atomicWriteFile(result.filePath, content);
    return result.filePath;
  });
  ipcMain.handle("settings:get", readSettings);
  ipcMain.handle("settings:update", async (_event, settings: SettingsUpdatePayload) => {
    const next = await updateStoredSettings(settings);
    registerHotkey(next.hotkey);
    tray?.setToolTip(`随记 - ${next.hotkey} 呼出`);
    return next;
  });
  ipcMain.handle("privacy:verify-pin", async (_event, pin: string) => verifyPin(await readStoredSettings(), pin));
  ipcMain.handle("window:hide", () => {
    void lockContentForPrivacy();
    mainWindow?.hide();
  });
}

if (gotTheLock) {
  app.on("second-instance", () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.suiji.desktop");
    await ensureStorage();
    const settings = await readSettings();
    registerIpc();
    createApplicationMenu();
    createWindow();
    createTray(settings);
    registerHotkey(settings.hotkey);

    if (!settings.startHidden) {
      showWindow();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    showWindow();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
