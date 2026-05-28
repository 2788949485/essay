import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from "electron";
import type { MenuItemConstructorOptions, MessageBoxOptions } from "electron";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toMarkdown } from "../shared/markdown.js";
import type {
  AppSettings,
  ExportPayload,
  NoteRecord,
  NotesBackup,
  RestoreResult,
  SettingsUpdatePayload
} from "../shared/types.js";

const DEFAULT_HOTKEY = "CommandOrControl+Alt+J";
const NOTE_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const MAX_TEXT_FIELD_LENGTH = 500_000;
const MAX_PIN_LENGTH = 128;
const EDIT_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const ALLOWED_EXPORT_FORMATS = new Set(["html", "json", "txt", "md"]);
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

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
let dataRootDir = "";
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
  dataRootDir = dataRoot;
  notesDir = path.join(dataRoot, "notes");
  backupsDir = path.join(dataRoot, "backups");
  settingsPath = path.join(dataRoot, "settings.json");
  await fs.mkdir(notesDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
}

function assertNoteId(id: string) {
  if (!NOTE_ID_PATTERN.test(id)) {
    throw new Error("Invalid note id");
  }
}

function notePath(id: string) {
  assertNoteId(id);
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

function hashPinScrypt(pin: string, salt: string) {
  return scryptSync(pin, salt, 64).toString("hex");
}

function verifyPin(settings: StoredSettings, pin: string) {
  if (!settings.privacyPinHash || !settings.privacyPinSalt) return true;
  const expected = Buffer.from(settings.privacyPinHash, "hex");
  const candidateHash = expected.length === 32 ? hashPin(pin, settings.privacyPinSalt) : hashPinScrypt(pin, settings.privacyPinSalt);
  const actual = Buffer.from(candidateHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function atomicWriteFile(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function backupExistingNote(id: string, prefix = "note") {
  try {
    await fs.copyFile(notePath(id), backupPath(prefix, id));
  } catch {
    // No backup is needed when the note does not exist yet.
  }
}

async function backupExistingNoteIfStale(id: string, prefix = "note", minIntervalMs = EDIT_BACKUP_INTERVAL_MS) {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const hasRecentBackup = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith(`-${id}.json`))
        .map(async (entry) => {
          const stat = await fs.stat(path.join(backupsDir, entry.name));
          return Date.now() - stat.mtimeMs < minIntervalMs;
        })
    );
    if (hasRecentBackup.some(Boolean)) return;
  } catch {
    // Fall through to a best-effort backup when checking existing backups fails.
  }

  await backupExistingNote(id, prefix);
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

function defaultBackupName() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `suiji-backup-${stamp}.json`;
}

function coerceString(value: unknown, fallback = "", maxLength = MAX_TEXT_FIELD_LENGTH) {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 24))
    )
  ).slice(0, 12);
}

function validateExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isAllowedAppNavigation(targetUrl: string) {
  try {
    const url = new URL(targetUrl);
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.origin === new URL(devServer).origin) return true;
    if (url.protocol !== "file:") return false;

    const rendererRoot = path.resolve(__dirname, "../renderer");
    const targetPath = path.resolve(decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/, "$1")));
    return targetPath === rendererRoot || targetPath.startsWith(`${rendererRoot}${path.sep}`);
  } catch {
    return false;
  }
}

function isExportFormat(value: unknown): value is ExportPayload["format"] {
  return typeof value === "string" && ALLOWED_EXPORT_FORMATS.has(value);
}

function sanitizeSettingsPayload(raw: unknown): SettingsUpdatePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid settings payload");
  }
  const payload = raw as Partial<SettingsUpdatePayload>;
  return {
    hotkey: coerceString(payload.hotkey, DEFAULT_HOTKEY, 120).trim() || DEFAULT_HOTKEY,
    startHidden: Boolean(payload.startHidden),
    lockOnHide: Boolean(payload.lockOnHide),
    privacyPin: typeof payload.privacyPin === "string" ? payload.privacyPin.slice(0, MAX_PIN_LENGTH) : undefined,
    clearPrivacyPin: Boolean(payload.clearPrivacyPin)
  };
}

function sanitizeNotePayload(raw: unknown): NoteRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid note payload");
  }

  const note = raw as Partial<NoteRecord>;
  if (typeof note.id !== "string") {
    throw new Error("Invalid note id");
  }
  assertNoteId(note.id);

  return normalizeNote({
    id: note.id,
    title: coerceString(note.title, "未命名记录", 300),
    excerpt: coerceString(note.excerpt, "", 500),
    tags: normalizeTags(note.tags),
    pinnedAt: typeof note.pinnedAt === "string" ? note.pinnedAt : null,
    content: note.content && typeof note.content === "object" ? note.content : emptyDoc,
    html: coerceString(note.html),
    plainText: coerceString(note.plainText),
    createdAt: coerceString(note.createdAt, new Date().toISOString(), 80),
    updatedAt: coerceString(note.updatedAt, new Date().toISOString(), 80)
  });
}

function sanitizeExportPayload(raw: unknown): ExportPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid export payload");
  }
  const payload = raw as Partial<ExportPayload>;
  if (!isExportFormat(payload.format)) {
    throw new Error("Invalid export format");
  }
  return {
    format: payload.format,
    note: sanitizeNotePayload(payload.note)
  };
}

function parseBackupNotes(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as Partial<NotesBackup>).notes)) {
    return (raw as Partial<NotesBackup>).notes ?? [];
  }
  throw new Error("Invalid backup file");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

type JsonNode = NoteRecord["content"];

function safeHtmlUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  return validateExternalUrl(raw) ?? "";
}

function renderInlineHtml(node: JsonNode): string {
  if (node.type === "text") {
    const text = escapeHtml(node.text ?? "");
    return (node.marks ?? []).reduce((current, mark) => {
      if (mark.type === "bold") return `<strong>${current}</strong>`;
      if (mark.type === "italic") return `<em>${current}</em>`;
      if (mark.type === "strike") return `<s>${current}</s>`;
      if (mark.type === "underline") return `<u>${current}</u>`;
      if (mark.type === "code") return `<code>${current}</code>`;
      if (mark.type === "highlight") return `<mark>${current}</mark>`;
      if (mark.type === "link") {
        const href = safeHtmlUrl(mark.attrs?.href);
        return href ? `<a href="${escapeHtmlAttribute(href)}" rel="noreferrer">${current}</a>` : current;
      }
      return current;
    }, text);
  }

  if (node.type === "hardBreak") return "<br>";
  if (node.type === "image") return renderBlockHtml(node);
  return (node.content ?? []).map(renderInlineHtml).join("");
}

function renderListItemHtml(node: JsonNode): string {
  const children = node.content ?? [];
  const body = children.map(renderBlockHtml).join("");
  return `<li>${body || "<p></p>"}</li>`;
}

function renderTaskItemHtml(node: JsonNode): string {
  const checked = node.attrs?.checked ? " checked" : "";
  const children = node.content ?? [];
  return `<li><label><input type="checkbox"${checked} disabled></label><div>${children.map(renderBlockHtml).join("") || "<p></p>"}</div></li>`;
}

function renderBlockHtml(node: JsonNode): string {
  const children = node.content ?? [];

  switch (node.type) {
    case "doc":
      return children.map(renderBlockHtml).join("");
    case "paragraph":
      return `<p>${renderInlineHtml(node)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `<h${level}>${renderInlineHtml(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${children.map(renderBlockHtml).join("")}</blockquote>`;
    case "bulletList":
      return `<ul>${children.map(renderListItemHtml).join("")}</ul>`;
    case "orderedList":
      return `<ol>${children.map(renderListItemHtml).join("")}</ol>`;
    case "taskList":
      return `<ul data-type="taskList">${children.map(renderTaskItemHtml).join("")}</ul>`;
    case "listItem":
      return renderListItemHtml(node);
    case "taskItem":
      return renderTaskItemHtml(node);
    case "codeBlock":
      return `<pre><code>${escapeHtml(children.map((child) => child.text ?? "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const src = safeHtmlUrl(node.attrs?.src);
      if (!src) return "";
      const alt = escapeHtmlAttribute(typeof node.attrs?.alt === "string" ? node.attrs.alt : "");
      return `<img src="${escapeHtmlAttribute(src)}" alt="${alt}">`;
    }
    default:
      return children.map(renderBlockHtml).join("");
  }
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

    ul[data-type="taskList"] div > *:first-child {
      margin-top: 0;
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
      ${renderBlockHtml(note.content) || "<p></p>"}
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
    tags: normalizeTags(raw.tags),
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
  } else if (typeof payload.privacyPin === "string" && payload.privacyPin.trim()) {
    const pin = payload.privacyPin.trim().slice(0, MAX_PIN_LENGTH);
    const salt = randomBytes(16).toString("hex");
    next.privacyPinSalt = salt;
    next.privacyPinHash = hashPinScrypt(pin, salt);
  }

  await writeStoredSettings(next);
  return publicSettings(next);
}

async function listNotes(): Promise<NoteRecord[]> {
  const files = await fs.readdir(notesDir);
  const notes: NoteRecord[] = [];
  const corruptDir = path.join(notesDir, "corrupt");

  await Promise.all(
    files
      .filter((file) => file.endsWith(".json") && NOTE_ID_PATTERN.test(path.basename(file, ".json")))
      .map(async (file) => {
        const filePath = path.join(notesDir, file);
        try {
          const raw = await fs.readFile(filePath, "utf8");
          notes.push(normalizeNote(JSON.parse(raw)));
        } catch {
          await fs.mkdir(corruptDir, { recursive: true });
          await fs.rename(filePath, path.join(corruptDir, `${Date.now()}-${file}`)).catch(() => undefined);
        }
      })
  );

  return sortNotes(notes);
}

async function exportAllNotesBackup() {
  const notes = await listNotes();
  const backup: NotesBackup = {
    app: "suiji",
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    notes
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: "备份全部记录",
        defaultPath: defaultBackupName(),
        filters: [
          { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showSaveDialog({
        title: "备份全部记录",
        defaultPath: defaultBackupName(),
        filters: [
          { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

  if (result.canceled || !result.filePath) return null;
  await atomicWriteFile(result.filePath, JSON.stringify(backup, null, 2));
  return result.filePath;
}

async function restoreNotesBackup(): Promise<RestoreResult | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "恢复记录备份",
        properties: ["openFile"],
        filters: [
          { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showOpenDialog({
        title: "恢复记录备份",
        properties: ["openFile"],
        filters: [
          { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

  if (result.canceled || result.filePaths.length === 0) return null;

  const warningOptions: MessageBoxOptions = {
    type: "warning",
    buttons: ["继续恢复", "取消"],
    cancelId: 1,
    defaultId: 1,
    title: "恢复记录备份",
    message: "恢复会导入备份中的记录",
    detail: "如果备份中存在和本地相同 ID 的记录，本地记录会先保存到 backups/ 后再被覆盖。"
  };
  const warning = mainWindow
    ? await dialog.showMessageBox(mainWindow, warningOptions)
    : await dialog.showMessageBox(warningOptions);
  if (warning.response !== 0) return null;

  const raw = await fs.readFile(result.filePaths[0], "utf8");
  const backupNotes = parseBackupNotes(JSON.parse(raw));
  let imported = 0;
  let skipped = 0;

  for (const rawNote of backupNotes) {
    try {
      const note = sanitizeNotePayload(rawNote);
      await backupExistingNote(note.id, "restore");
      await atomicWriteFile(notePath(note.id), JSON.stringify(note, null, 2));
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  void pruneBackups();
  return {
    total: backupNotes.length,
    imported,
    skipped
  };
}

function sortNotes(notes: NoteRecord[]) {
  return [...notes].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

async function saveNote(rawNote: NoteRecord): Promise<NoteRecord> {
  const note = sanitizeNotePayload(rawNote);
  const plainText = note.plainText.trim();
  const normalized = normalizeNote({
    ...note,
    title: note.title.trim() || plainText.split(/\r?\n/)[0] || "未命名记录",
    excerpt: plainText.replace(/\s+/g, " ").slice(0, 120),
    updatedAt: new Date().toISOString()
  });

  await backupExistingNoteIfStale(normalized.id);
  await atomicWriteFile(notePath(normalized.id), JSON.stringify(normalized, null, 2));
  void pruneBackups();
  return normalized;
}

async function readNote(id: string): Promise<NoteRecord> {
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
  await backupExistingNote(id, "deleted");
  await fs.rm(notePath(id), { force: true });
  void pruneBackups();
}

function setupWebContentsGuards(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = validateExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url)) return;

    event.preventDefault();
    const externalUrl = validateExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
  });

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
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
      sandbox: true
    }
  });

  setupWebContentsGuards(mainWindow);

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
                `版本：${app.getVersion()}\n版权：Copyright (c) 2026 Suiji. All rights reserved.\n\n随记是快捷呼出的本地自动保存富文本记录工具。笔记默认保存在本机用户数据目录，导出文件为明文，请自行确认保存位置安全。`
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
  ipcMain.handle("notes:backup-all", exportAllNotesBackup);
  ipcMain.handle("notes:restore-backup", restoreNotesBackup);
  ipcMain.handle("notes:export", async (_event, rawPayload: ExportPayload) => {
    const payload = sanitizeExportPayload(rawPayload);
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
  ipcMain.handle("settings:update", async (_event, rawSettings: SettingsUpdatePayload) => {
    const settings = sanitizeSettingsPayload(rawSettings);
    const next = await updateStoredSettings(settings);
    registerHotkey(next.hotkey);
    tray?.setToolTip(`随记 - ${next.hotkey} 呼出`);
    return next;
  });
  ipcMain.handle("privacy:verify-pin", async (_event, pin: string) =>
    verifyPin(await readStoredSettings(), coerceString(pin, "", MAX_PIN_LENGTH))
  );
  ipcMain.handle("shell:open-external", async (_event, value: string) => {
    const url = validateExternalUrl(coerceString(value, "", 2048));
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("app:open-data-folder", async () => {
    await fs.mkdir(dataRootDir, { recursive: true });
    const error = await shell.openPath(dataRootDir);
    return error || null;
  });
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
