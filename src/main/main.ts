import {
  app,
  BrowserWindow,
  clipboard,
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
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { toMarkdown } from "../shared/markdown.js";
import type {
  AppSettings,
  BackupEntry,
  BatchExportFormat,
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
const MAX_FOLDER_LENGTH = 40;
const EDIT_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const ALLOWED_EXPORT_FORMATS = new Set(["html", "json", "txt", "md", "pdf"]);
const ALLOWED_BATCH_EXPORT_FORMATS = new Set(["html", "json", "txt", "md"]);
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const DB_FLUSH_DELAY_MS = 900;
const DEBUG_LOG_PATH = process.env.SUIJI_DEBUG_LOG || "d:\\zhuomian\\essay\\runtime_cache\\suiji-debug.log";
const DEBUG_PORT = process.env.SUIJI_DEBUG_PORT || "";

type StoredSettings = Omit<AppSettings, "hasPrivacyPin"> & {
  privacyPinHash: string | null;
  privacyPinSalt: string | null;
};

const DEFAULT_SETTINGS: StoredSettings = {
  hotkey: DEFAULT_HOTKEY,
  startHidden: false,
  lockOnHide: true,
  launchAtLogin: false,
  theme: "light",
  fontFamily: "",
  fontSize: 16,
  lineWidth: 880,
  lineHeight: 1.72,
  privacyPinHash: null,
  privacyPinSalt: null
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isFlushingBeforeQuit = false;
let dataRootDir = "";
let notesDir = "";
let backupsDir = "";
let settingsPath = "";
let databasePath = "";
let databaseVirtualPath = "";
let sqliteRuntimePromise: Promise<any> | null = null;
let sqliteRuntime: any = null;
let notesDb: any = null;
let notesDbDirty = false;
let notesDbFlushTimer: NodeJS.Timeout | null = null;
let notesDbPersistQueue: Promise<void> = Promise.resolve();

type StorageConfig = {
  dataRoot?: string;
};

const gotTheLock = app.requestSingleInstanceLock();
writeDebugLog(`startup gotTheLock=${gotTheLock} argv=${process.argv.join(" ")}`);

if (!gotTheLock) {
  writeDebugLog("quit because another instance owns the lock");
  app.quit();
}

if (DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", DEBUG_PORT);
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

function writeDebugLog(message: string) {
  if (!DEBUG_LOG_PATH) return;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  void fs.appendFile(DEBUG_LOG_PATH, line, "utf8").catch(() => {});
}

function defaultDataRoot() {
  return app.getPath("userData");
}

function storageConfigPath() {
  return path.join(defaultDataRoot(), "storage.json");
}

async function readStorageConfig(): Promise<StorageConfig> {
  try {
    const raw = await fs.readFile(storageConfigPath(), "utf8");
    return JSON.parse(raw) as StorageConfig;
  } catch {
    return {};
  }
}

async function writeStorageConfig(config: StorageConfig) {
  await fs.mkdir(defaultDataRoot(), { recursive: true });
  await atomicWriteFile(storageConfigPath(), JSON.stringify(config, null, 2));
}

async function ensureStorage() {
  const config = await readStorageConfig();
  const configuredRoot = typeof config.dataRoot === "string" && config.dataRoot.trim() ? config.dataRoot.trim() : "";
  const dataRoot = configuredRoot ? path.resolve(configuredRoot) : defaultDataRoot();
  dataRootDir = dataRoot;
  notesDir = path.join(dataRoot, "notes");
  backupsDir = path.join(dataRoot, "backups");
  settingsPath = path.join(dataRoot, "settings.json");
  databasePath = path.join(dataRoot, "suiji.db");
  databaseVirtualPath = `/suiji-${createHash("sha1").update(dataRoot).digest("hex").slice(0, 16)}-${Date.now()}.db`;
  await fs.mkdir(notesDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
  await initializeNotesDatabase();
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
    launchAtLogin: settings.launchAtLogin,
    theme: settings.theme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    lineHeight: settings.lineHeight,
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

async function atomicWriteBytes(filePath: string, content: Uint8Array) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, content);
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function backupExistingNote(id: string, prefix = "note") {
  try {
    const note = await readNote(id);
    await atomicWriteFile(backupPath(prefix, id), JSON.stringify(note, null, 2));
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

async function uniqueExportPath(directory: string, fileName: string) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directory, fileName);
  let index = 2;
  while (true) {
    try {
      await fs.access(candidate, fsConstants.F_OK);
      candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

function isBatchExportFormat(value: unknown): value is BatchExportFormat {
  return typeof value === "string" && ALLOWED_BATCH_EXPORT_FORMATS.has(value);
}

function plainDoc(text: string): NoteRecord["content"] {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text ? [{ type: "text", text }] : undefined
      }
    ]
  };
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCellNode(type: "tableHeader" | "tableCell", text: string) {
  return {
    type,
    content: [
      {
        type: "paragraph",
        content: text ? [{ type: "text", text }] : undefined
      }
    ]
  };
}

function markdownTableToDocRows(lines: string[]) {
  const rows = [lines[0], ...lines.slice(2)].map(splitMarkdownTableRow);
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  return rows.map((row, rowIndex) => ({
    type: "tableRow",
    content: Array.from({ length: columnCount }, (_, index) =>
      tableCellNode(rowIndex === 0 ? "tableHeader" : "tableCell", row[index] ?? "")
    )
  }));
}

function markdownToDoc(markdown: string): NoteRecord["content"] {
  const blocks: NonNullable<NoteRecord["content"]["content"]> = [];
  let pendingParagraph: string[] = [];

  const flushParagraph = () => {
    const text = pendingParagraph.join(" ").trim();
    if (text) {
      blocks.push({ type: "paragraph", content: [{ type: "text", text }] });
    }
    pendingParagraph = [];
  };

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isMarkdownTableSeparator(lines[index + 1])) {
      flushParagraph();
      const tableLines = [line, lines[index + 1].trimEnd()];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index].trimEnd());
        index += 1;
      }
      index -= 1;
      blocks.push({
        type: "table",
        content: markdownTableToDocRows(tableLines)
      });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: [{ type: "text", text: heading[2].trim() }]
      });
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: bullet[1].trim() }] }]
          }
        ]
      });
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: ordered[1].trim() }] }]
          }
        ]
      });
      continue;
    }

    pendingParagraph.push(line.trim());
  }

  flushParagraph();
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
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

function normalizeFolder(value: unknown) {
  return coerceString(value, "", MAX_FOLDER_LENGTH).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
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
    launchAtLogin: Boolean(payload.launchAtLogin),
    theme: payload.theme === "dark" ? "dark" : "light",
    fontFamily: coerceString(payload.fontFamily, "", 120),
    fontSize: Math.min(Math.max(Number(payload.fontSize) || 16, 13), 24),
    lineWidth: Math.min(Math.max(Number(payload.lineWidth) || 880, 640), 1200),
    lineHeight: Math.min(Math.max(Number(payload.lineHeight) || 1.72, 1.35), 2.2),
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
    folder: normalizeFolder(note.folder),
    favoriteAt: typeof note.favoriteAt === "string" ? note.favoriteAt : null,
    archivedAt: typeof note.archivedAt === "string" ? note.archivedAt : null,
    trashedAt: typeof note.trashedAt === "string" ? note.trashedAt : null,
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

function parseBackupEntryName(fileName: string, id: string, size: number, fallbackDate: Date): BackupEntry | null {
  if (!fileName.endsWith(`-${id}.json`)) return null;
  const match = fileName.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9-]{36}\.json$/i);
  return {
    fileName,
    prefix: match?.[1] ?? "backup",
    createdAt: match?.[2]?.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") ?? fallbackDate.toISOString(),
    size
  };
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

function renderTableCellHtml(node: JsonNode) {
  const tag = node.type === "tableHeader" ? "th" : "td";
  const colspan = Number(node.attrs?.colspan ?? 1);
  const rowspan = Number(node.attrs?.rowspan ?? 1);
  const attrs = [
    colspan > 1 ? ` colspan="${colspan}"` : "",
    rowspan > 1 ? ` rowspan="${rowspan}"` : ""
  ].join("");
  return `<${tag}${attrs}>${(node.content ?? []).map(renderBlockHtml).join("") || "<p></p>"}</${tag}>`;
}

function renderTableHtml(node: JsonNode) {
  const rows = (node.content ?? [])
    .map((row) => `<tr>${(row.content ?? []).map(renderTableCellHtml).join("")}</tr>`)
    .join("");
  return rows ? `<table><tbody>${rows}</tbody></table>` : "";
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
    case "table":
      return renderTableHtml(node);
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
    @page {
      size: A4;
      margin: 18mm 16mm 20mm;
    }

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
      border-left: 4px solid #2f6b5b;
      background: #eef5f3;
      color: #47515a;
    }

    table {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th, td {
      border: 1px solid var(--line);
      padding: 9px 11px;
      vertical-align: top;
    }

    th {
      background: #edf3f6;
      font-weight: 700;
    }

    td {
      background: #ffffff;
    }

    th > *, td > * {
      margin-bottom: 0;
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
      background: #edf2f5;
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
        border-radius: 0;
        box-shadow: none;
        background: #fff;
      }

      header {
        margin-bottom: 10mm;
        padding-bottom: 6mm;
      }

      footer {
        margin-top: 14mm;
        padding-top: 5mm;
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

async function buildPdfExport(note: NoteRecord): Promise<Uint8Array> {
  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 1280,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  try {
    const html = buildHtmlExport(note);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await window.webContents.executeJavaScript(
      "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : Promise.resolve(true)",
      true
    );
    return await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: "A4",
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    });
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

function normalizeNote(raw: Partial<NoteRecord>): NoteRecord {
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "未命名记录",
    excerpt: typeof raw.excerpt === "string" ? raw.excerpt : "",
    tags: normalizeTags(raw.tags),
    folder: normalizeFolder(raw.folder),
    favoriteAt: typeof raw.favoriteAt === "string" ? raw.favoriteAt : null,
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
    trashedAt: typeof raw.trashedAt === "string" ? raw.trashedAt : null,
    pinnedAt: typeof raw.pinnedAt === "string" ? raw.pinnedAt : null,
    content: raw.content ?? emptyDoc,
    html: typeof raw.html === "string" ? raw.html : "",
    plainText: typeof raw.plainText === "string" ? raw.plainText : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now
  };
}

type NoteDbRow = {
  id: string;
  title: string;
  excerpt: string;
  tags_json: string;
  folder: string;
  favorite_at: string | null;
  archived_at: string | null;
  trashed_at: string | null;
  pinned_at: string | null;
  content_json: string;
  html: string;
  plain_text: string;
  created_at: string;
  updated_at: string;
};

function noteToDbParams(note: NoteRecord) {
  return [
    note.id,
    note.title,
    note.excerpt,
    JSON.stringify(note.tags),
    note.folder,
    note.favoriteAt,
    note.archivedAt,
    note.trashedAt,
    note.pinnedAt,
    JSON.stringify(note.content),
    note.html,
    note.plainText,
    note.createdAt,
    note.updatedAt
  ];
}

function noteFromDbRow(row: NoteDbRow): NoteRecord {
  return normalizeNote({
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    tags: JSON.parse(row.tags_json || "[]"),
    folder: row.folder,
    favoriteAt: row.favorite_at,
    archivedAt: row.archived_at,
    trashedAt: row.trashed_at,
    pinnedAt: row.pinned_at,
    content: JSON.parse(row.content_json || JSON.stringify(emptyDoc)),
    html: row.html,
    plainText: row.plain_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

async function loadSqliteRuntime() {
  if (!sqliteRuntimePromise) {
    sqliteRuntimePromise = (async () => {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (
        specifier: string
      ) => Promise<any>;
      const module = await dynamicImport("@sqlite.org/sqlite-wasm");
      const initSqlite = module.default ?? module;
      return initSqlite({
        print: () => undefined,
        printErr: () => undefined
      });
    })();
  }
  sqliteRuntime = await sqliteRuntimePromise;
  return sqliteRuntime;
}

function dbExec(sql: string, bind: unknown[] = []) {
  notesDb.exec({ sql, bind });
}

function dbRows<T>(sql: string, bind: unknown[] = []) {
  const rows: T[] = [];
  notesDb.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row: T) => {
      rows.push(row);
    }
  });
  return rows;
}

function dbValue<T>(sql: string, bind: unknown[] = []) {
  let value: T | undefined;
  notesDb.exec({
    sql,
    bind,
    rowMode: "array",
    callback: (row: T[]) => {
      value = row[0];
    }
  });
  return value;
}

async function persistNotesDatabase() {
  if (!sqliteRuntime || !notesDb) return;
  if (notesDbFlushTimer) {
    clearTimeout(notesDbFlushTimer);
    notesDbFlushTimer = null;
  }
  if (!notesDbDirty) return notesDbPersistQueue;
  const task = notesDbPersistQueue.then(async () => {
    if (!notesDbDirty || !sqliteRuntime || !notesDb) return;
    notesDbDirty = false;
    const bytes = sqliteRuntime.capi.sqlite3_js_db_export(notesDb);
    await atomicWriteBytes(databasePath, bytes);
  });
  notesDbPersistQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

function scheduleNotesDatabasePersist() {
  notesDbDirty = true;
  if (notesDbFlushTimer) clearTimeout(notesDbFlushTimer);
  notesDbFlushTimer = setTimeout(() => {
    notesDbFlushTimer = null;
    void persistNotesDatabase();
  }, DB_FLUSH_DELAY_MS);
}

function ensureNotesSchema() {
  dbExec(`
    PRAGMA journal_mode=MEMORY;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      folder TEXT NOT NULL,
      favorite_at TEXT,
      archived_at TEXT,
      trashed_at TEXT,
      pinned_at TEXT,
      content_json TEXT NOT NULL,
      html TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_notes_pinned_at ON notes(pinned_at);
    CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      id UNINDEXED,
      title,
      excerpt,
      tags,
      folder,
      plain_text
    );
  `);
}

function upsertNoteInDatabase(note: NoteRecord) {
  dbExec(
    `
      INSERT INTO notes (
        id, title, excerpt, tags_json, folder, favorite_at, archived_at, trashed_at,
        pinned_at, content_json, html, plain_text, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        excerpt = excluded.excerpt,
        tags_json = excluded.tags_json,
        folder = excluded.folder,
        favorite_at = excluded.favorite_at,
        archived_at = excluded.archived_at,
        trashed_at = excluded.trashed_at,
        pinned_at = excluded.pinned_at,
        content_json = excluded.content_json,
        html = excluded.html,
        plain_text = excluded.plain_text,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    noteToDbParams(note)
  );
  dbExec("DELETE FROM notes_fts WHERE id = ?", [note.id]);
  dbExec("INSERT INTO notes_fts(id, title, excerpt, tags, folder, plain_text) VALUES (?, ?, ?, ?, ?, ?)", [
    note.id,
    note.title,
    note.excerpt,
    note.tags.join(" "),
    note.folder,
    note.plainText
  ]);
}

async function migrateJsonNotesToDatabaseIfNeeded() {
  const count = dbValue<number>("SELECT COUNT(*) FROM notes") ?? 0;
  if (count > 0) return;

  const files = await fs.readdir(notesDir).catch(() => []);
  const noteFiles = files.filter((file) => file.endsWith(".json") && NOTE_ID_PATTERN.test(path.basename(file, ".json")));
  if (noteFiles.length === 0) return;

  const corruptDir = path.join(notesDir, "corrupt");
  dbExec("BEGIN");
  try {
    for (const file of noteFiles) {
      const filePath = path.join(notesDir, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const note = normalizeNote(JSON.parse(raw));
        upsertNoteInDatabase(note);
      } catch {
        await fs.mkdir(corruptDir, { recursive: true });
        await fs.rename(filePath, path.join(corruptDir, `${Date.now()}-${file}`)).catch(() => undefined);
      }
    }
    dbExec("COMMIT");
  } catch (error) {
    dbExec("ROLLBACK");
    throw error;
  }
  notesDbDirty = true;
  await persistNotesDatabase();
}

async function initializeNotesDatabase() {
  if (notesDb) {
    notesDb.close();
    notesDb = null;
  }

  const sqlite3 = await loadSqliteRuntime();
  try {
    const bytes = await fs.readFile(databasePath);
    sqlite3.capi.sqlite3_js_posix_create_file(databaseVirtualPath, bytes);
  } catch {
    // A missing database file means this is the first launch for the data directory.
  }

  notesDb = new sqlite3.oo1.DB(databaseVirtualPath, "c");
  sqlite3.capi.sqlite3_trace_v2(notesDb.pointer, 0, 0, 0);
  ensureNotesSchema();
  await migrateJsonNotesToDatabaseIfNeeded();
  notesDbDirty = true;
  await persistNotesDatabase();
}

async function writeNoteToDatabase(note: NoteRecord, persist = true) {
  upsertNoteInDatabase(note);
  if (persist) scheduleNotesDatabasePersist();
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
    lockOnHide: Boolean(payload.lockOnHide),
    launchAtLogin: Boolean(payload.launchAtLogin),
    theme: payload.theme === "dark" ? "dark" : "light",
    fontFamily: payload.fontFamily,
    fontSize: payload.fontSize,
    lineWidth: payload.lineWidth,
    lineHeight: payload.lineHeight
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
  app.setLoginItemSettings({
    openAtLogin: next.launchAtLogin,
    openAsHidden: next.startHidden
  });
  return publicSettings(next);
}

async function listNotes(): Promise<NoteRecord[]> {
  const notes = dbRows<NoteDbRow>(
    `SELECT
      id, title, excerpt, tags_json, folder, favorite_at, archived_at, trashed_at,
      pinned_at, content_json, html, plain_text, created_at, updated_at
    FROM notes`
  ).map(noteFromDbRow);
  return sortNotes(notes);
}

function buildFtsQuery(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" AND ");
}

async function searchNoteIds(query: string): Promise<string[]> {
  const ftsQuery = buildFtsQuery(coerceString(query, "", 500));
  if (!ftsQuery) return [];
  try {
    return dbRows<{ id: string }>(
      "SELECT id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT 1000",
      [ftsQuery]
    ).map((row) => row.id);
  } catch {
    return [];
  }
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
      await writeNoteToDatabase(note, false);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  notesDbDirty = true;
  await persistNotesDatabase();
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
  await writeNoteToDatabase(normalized);
  void pruneBackups();
  return normalized;
}

async function readNote(id: string): Promise<NoteRecord> {
  assertNoteId(id);
  const row = dbRows<NoteDbRow>(
    `SELECT
      id, title, excerpt, tags_json, folder, favorite_at, archived_at, trashed_at,
      pinned_at, content_json, html, plain_text, created_at, updated_at
    FROM notes
    WHERE id = ?`,
    [id]
  )[0];
  if (!row) throw new Error("Note not found");
  return noteFromDbRow(row);
}

async function togglePinNote(id: string): Promise<NoteRecord> {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    pinnedAt: note.pinnedAt ? null : new Date().toISOString()
  });
  await backupExistingNote(next.id);
  await writeNoteToDatabase(next);
  void pruneBackups();
  return next;
}

async function toggleFavoriteNote(id: string): Promise<NoteRecord> {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    favoriteAt: note.favoriteAt ? null : new Date().toISOString()
  });
  await backupExistingNote(next.id);
  await writeNoteToDatabase(next);
  void pruneBackups();
  return next;
}

async function toggleArchiveNote(id: string): Promise<NoteRecord> {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    archivedAt: note.archivedAt ? null : new Date().toISOString()
  });
  await backupExistingNote(next.id);
  await writeNoteToDatabase(next);
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
  await writeNoteToDatabase(note);
  return note;
}

async function createNoteFromContent(title: string, plainText: string, content: NoteRecord["content"], html = "") {
  const now = new Date().toISOString();
  const note = normalizeNote({
    id: randomUUID(),
    title: title.trim() || plainText.trim().split(/\r?\n/)[0] || "Imported note",
    excerpt: plainText.trim().replace(/\s+/g, " ").slice(0, 120),
    content,
    html,
    plainText,
    createdAt: now,
    updatedAt: now
  });
  await writeNoteToDatabase(note);
  return note;
}

async function importMarkdownNotes(): Promise<NoteRecord[]> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "瀵煎叆 Markdown",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "txt"] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showOpenDialog({
        title: "瀵煎叆 Markdown",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "txt"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

  if (result.canceled || result.filePaths.length === 0) return [];
  const imported: NoteRecord[] = [];
  for (const filePath of result.filePaths) {
    const raw = await fs.readFile(filePath, "utf8");
    const heading = raw.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
    const fallbackTitle = path.basename(filePath, path.extname(filePath));
    imported.push(await createNoteFromContent(heading || fallbackTitle, raw, markdownToDoc(raw)));
  }
  return sortNotes(imported);
}

async function batchExportNotes(format: BatchExportFormat): Promise<{ directory: string; count: number } | null> {
  if (!isBatchExportFormat(format)) throw new Error("Invalid export format");
  const warningOptions: MessageBoxOptions = {
    type: "warning",
    buttons: ["Continue export", "Cancel"],
    cancelId: 1,
    defaultId: 1,
    title: "Batch export plaintext files",
    message: "Batch export creates plaintext files.",
    detail: "Choose a private output directory if notes contain sensitive content."
  };
  const warning = mainWindow
    ? await dialog.showMessageBox(mainWindow, warningOptions)
    : await dialog.showMessageBox(warningOptions);
  if (warning.response !== 0) return null;

  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "Choose batch export directory",
        properties: ["openDirectory", "createDirectory"]
      })
    : await dialog.showOpenDialog({
        title: "Choose batch export directory",
        properties: ["openDirectory", "createDirectory"]
      });
  if (result.canceled || result.filePaths.length === 0) return null;

  const directory = result.filePaths[0];
  const notes = (await listNotes()).filter((note) => !note.trashedAt);
  for (const note of notes) {
    const filePath = await uniqueExportPath(directory, safeExportName(note.title, format));
    const content =
      format === "html"
        ? buildHtmlExport(note)
        : format === "json"
          ? JSON.stringify(note, null, 2)
          : format === "md"
            ? toMarkdown(note.content)
            : note.plainText;
    await atomicWriteFile(filePath, content);
  }

  return { directory, count: notes.length };
}
async function createClipboardNote() {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const dataUrl = image.toDataURL();
    const content: NoteRecord["content"] = {
      type: "doc",
      content: [{ type: "image", attrs: { src: dataUrl, alt: "", title: null } }]
    };
    return createNoteFromContent("Clipboard image", "[image]", content, `<p><img src="${dataUrl}" alt=""></p>`);
  }

  const text = clipboard.readText().trim();
  if (!text) return createNote();
  return createNoteFromContent(text.split(/\r?\n/)[0].slice(0, 80), text, plainDoc(text));
}

async function deleteNote(id: string) {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    trashedAt: new Date().toISOString()
  });
  await backupExistingNote(id, "deleted");
  await writeNoteToDatabase(next);
  void pruneBackups();
}

async function restoreNote(id: string): Promise<NoteRecord> {
  const note = await readNote(id);
  const next = normalizeNote({
    ...note,
    trashedAt: null
  });
  await backupExistingNote(id, "restore-trash");
  await writeNoteToDatabase(next);
  void pruneBackups();
  return next;
}

async function purgeNote(id: string) {
  await backupExistingNote(id, "purged");
  dbExec("DELETE FROM notes_fts WHERE id = ?", [id]);
  dbExec("DELETE FROM notes WHERE id = ?", [id]);
  notesDbDirty = true;
  await persistNotesDatabase();
  void pruneBackups();
}

async function listNoteBackups(id: string): Promise<BackupEntry[]> {
  assertNoteId(id);
  const entries = await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => []);
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(`-${id}.json`))
      .map(async (entry) => {
        const stat = await fs.stat(path.join(backupsDir, entry.name));
        return parseBackupEntryName(entry.name, id, stat.size, stat.mtime);
      })
  );
  return backups
    .filter((entry): entry is BackupEntry => Boolean(entry))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function restoreNoteBackup(id: string, fileName: string): Promise<NoteRecord> {
  assertNoteId(id);
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !safeName.endsWith(`-${id}.json`)) {
    throw new Error("Invalid backup file");
  }

  const raw = await fs.readFile(path.join(backupsDir, safeName), "utf8");
  const note = sanitizeNotePayload(JSON.parse(raw));
  if (note.id !== id) {
    throw new Error("Backup note id mismatch");
  }

  await backupExistingNote(id, "version-restore");
  const restored = normalizeNote({
    ...note,
    updatedAt: new Date().toISOString()
  });
  await writeNoteToDatabase(restored);
  void pruneBackups();
  return restored;
}

async function copyPathIfExists(source: string, target: string) {
  try {
    const stat = await fs.stat(source);
    if (stat.isDirectory()) {
      await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false });
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function migrateDataRoot(targetRoot: string) {
  const sourceRoot = dataRootDir;
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedSource = path.resolve(sourceRoot);
  if (resolvedTarget === resolvedSource || resolvedTarget.startsWith(`${resolvedSource}${path.sep}`)) {
    throw new Error("新数据目录不能位于当前数据目录内部");
  }

  await fs.mkdir(resolvedTarget, { recursive: true });
  await persistNotesDatabase();
  await copyPathIfExists(path.join(sourceRoot, "suiji.db"), path.join(resolvedTarget, "suiji.db"));
  await copyPathIfExists(path.join(sourceRoot, "notes"), path.join(resolvedTarget, "notes"));
  await copyPathIfExists(path.join(sourceRoot, "backups"), path.join(resolvedTarget, "backups"));
  await copyPathIfExists(path.join(sourceRoot, "settings.json"), path.join(resolvedTarget, "settings.json"));
}

async function changeDataFolder() {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "选择数据目录",
        defaultPath: dataRootDir,
        properties: ["openDirectory", "createDirectory"]
      })
    : await dialog.showOpenDialog({
        title: "选择数据目录",
        defaultPath: dataRootDir,
        properties: ["openDirectory", "createDirectory"]
      });

  if (result.canceled || result.filePaths.length === 0) return null;

  const selectedRoot = path.resolve(result.filePaths[0]);
  if (selectedRoot === path.resolve(dataRootDir)) return dataRootDir;

  const options: MessageBoxOptions = {
    type: "question",
    buttons: ["复制现有数据并切换", "只切换目录", "取消"],
    defaultId: 0,
    cancelId: 2,
    title: "修改数据目录",
    message: "是否把当前记录和设置复制到新数据目录？",
    detail: "选择“只切换目录”会使用新目录中的现有数据；如果新目录为空，应用会重新创建空记录。"
  };
  const answer = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  if (answer.response === 2) return null;

  if (answer.response === 0) {
    await migrateDataRoot(selectedRoot);
  }

  await writeStorageConfig({ dataRoot: selectedRoot });
  await ensureStorage();
  return dataRootDir;
}

function setupWebContentsGuards(window: BrowserWindow) {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    writeDebugLog(`console level=${level} ${sourceId}:${line} ${message}`);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeDebugLog(`did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    writeDebugLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  window.webContents.on("did-finish-load", () => {
    writeDebugLog("did-finish-load");
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

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

  window.webContents.session.setPermissionCheckHandler(() => false);
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
      backgroundThrottling: true
    }
  });

  setupWebContentsGuards(mainWindow);

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on("minimize", () => {
    void lockContentForPrivacy();
    void persistNotesDatabase();
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
  const exportNoteMenu: MenuItemConstructorOptions[] = [
    { label: "导出 PDF", click: () => mainWindow?.webContents.send("menu:export-note", "pdf") },
    { label: "导出 HTML", click: () => mainWindow?.webContents.send("menu:export-note", "html") },
    { label: "导出 Markdown", click: () => mainWindow?.webContents.send("menu:export-note", "md") },
    { label: "导出 TXT", click: () => mainWindow?.webContents.send("menu:export-note", "txt") },
    { label: "导出 JSON", click: () => mainWindow?.webContents.send("menu:export-note", "json") }
  ];
  const batchExportMenu: MenuItemConstructorOptions[] = [
    { label: "批量导出 Markdown", click: () => mainWindow?.webContents.send("menu:batch-export", "md") },
    { label: "批量导出 HTML", click: () => mainWindow?.webContents.send("menu:batch-export", "html") },
    { label: "批量导出 TXT", click: () => mainWindow?.webContents.send("menu:batch-export", "txt") },
    { label: "批量导出 JSON", click: () => mainWindow?.webContents.send("menu:batch-export", "json") }
  ];
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建记录",
          accelerator: "CommandOrControl+N",
          click: () => mainWindow?.webContents.send("menu:new-note")
        },
        {
          label: "保存",
          accelerator: "CommandOrControl+S",
          click: () => mainWindow?.webContents.send("menu:save")
        },
        {
          label: "版本历史",
          click: () => mainWindow?.webContents.send("menu:history")
        },
        {
          label: "导出当前记录",
          submenu: exportNoteMenu
        },
        {
          label: "批量导出记录",
          submenu: batchExportMenu
        },
        {
          label: "设置",
          click: () => mainWindow?.webContents.send("menu:settings")
        },
        { type: "separator" },
        {
          label: "隐藏窗口",
          accelerator: "Escape",
          click: hideWindow
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

function hideWindow() {
  void lockContentForPrivacy();
  void persistNotesDatabase();
  mainWindow?.hide();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideWindow();
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
      {
        label: "快速新建",
        click: () => {
          showWindow();
          mainWindow?.webContents.send("menu:new-note");
        }
      },
      {
        label: "保存剪贴板为记录",
        click: async () => {
          const note = await createClipboardNote();
          showWindow();
          mainWindow?.webContents.send("notes:reload", note.id);
        }
      },
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
  ipcMain.handle("notes:search", (_event, query: string) => searchNoteIds(query));
  ipcMain.handle("notes:create", createNote);
  ipcMain.handle("notes:save", (_event, note: NoteRecord) => saveNote(note));
  ipcMain.handle("notes:toggle-pin", (_event, id: string) => togglePinNote(id));
  ipcMain.handle("notes:toggle-favorite", (_event, id: string) => toggleFavoriteNote(id));
  ipcMain.handle("notes:toggle-archive", (_event, id: string) => toggleArchiveNote(id));
  ipcMain.handle("notes:delete", (_event, id: string) => deleteNote(id));
  ipcMain.handle("notes:restore", (_event, id: string) => restoreNote(id));
  ipcMain.handle("notes:purge", (_event, id: string) => purgeNote(id));
  ipcMain.handle("notes:list-backups", (_event, id: string) => listNoteBackups(id));
  ipcMain.handle("notes:restore-backup-version", (_event, id: string, fileName: string) =>
    restoreNoteBackup(id, fileName)
  );
  ipcMain.handle("notes:backup-all", exportAllNotesBackup);
  ipcMain.handle("notes:restore-backup", restoreNotesBackup);
  ipcMain.handle("notes:import-markdown", importMarkdownNotes);
  ipcMain.handle("notes:batch-export", (_event, format: BatchExportFormat) => batchExportNotes(format));
  ipcMain.handle("notes:export", async (_event, rawPayload: ExportPayload) => {
    const payload = sanitizeExportPayload(rawPayload);
    const ext = payload.format;
    const warningOptions: MessageBoxOptions = {
      type: "warning",
      buttons: ["继续导出", "取消"],
      cancelId: 1,
      defaultId: 1,
      title: payload.format === "pdf" ? "导出 PDF 文件" : "导出明文文件",
      message: payload.format === "pdf" ? "导出的文件会保存为 PDF" : "导出的文件会以明文保存",
      detail:
        payload.format === "pdf"
          ? "请确认保存位置安全，避免把包含隐私的记录导出到公共目录、同步盘或共享设备。"
          : "请确认保存位置安全，避免把包含隐私的记录导出到公共目录、同步盘或共享设备。"
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

    if (payload.format === "pdf") {
      const pdf = await buildPdfExport(payload.note);
      await atomicWriteBytes(result.filePath, pdf);
      return result.filePath;
    }

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
  ipcMain.handle("settings:test-hotkey", async (_event, hotkey: string) => {
    const settings = await readSettings();
    const candidate = coerceString(hotkey, "", 120).trim();
    if (!candidate) return false;
    globalShortcut.unregisterAll();
    let ok = false;
    try {
      ok = globalShortcut.register(candidate, () => undefined);
      if (ok) globalShortcut.unregister(candidate);
    } catch {
      ok = false;
    }
    registerHotkey(settings.hotkey);
    return ok;
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
  ipcMain.handle("app:change-data-folder", changeDataFolder);
  ipcMain.handle("window:hide", () => {
    hideWindow();
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
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      openAsHidden: settings.startHidden
    });
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

  app.on("before-quit", (event) => {
    if (!notesDbDirty || isFlushingBeforeQuit) return;
    event.preventDefault();
    isFlushingBeforeQuit = true;
    void persistNotesDatabase().finally(() => {
      isQuitting = true;
      app.quit();
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (notesDb) {
      try {
        notesDb.close();
      } catch {
        // Shutdown cleanup is best effort; pending writes are flushed in before-quit.
      }
    }
  });
}

