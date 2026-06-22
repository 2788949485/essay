import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  Tray
} from "electron";
import type { MessageBoxOptions } from "electron";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { buildApplicationMenuTemplate, buildTrayMenuTemplate } from "./app-shell.js";
import { buildHtmlExport } from "./html-export.js";
import {
  DEFAULT_HOTKEY,
  DEFAULT_SETTINGS,
  DEFAULT_BACKUP_HISTORY_LIMIT,
  MAX_BACKUP_HISTORY_LIMIT,
  MAX_PIN_LENGTH,
  StoredSettings,
  decodeStoredBytes,
  encodeStoredBytes,
  hashPinScrypt,
  isStorageEncryptionEnabled,
  publicSettings,
  resolveVerifiedPin,
  sanitizeStoredSettings,
  verifyPin
} from "./security.js";
import {
  buildExportText,
  defaultBackupName,
  defaultEncryptedBatchExportName,
  markdownToDoc,
  parseBackupEntryName,
  parseBackupNotes,
  plainDoc,
  safeExportBaseName,
  safeExportName
} from "./note-transfer.js";
import { parseEncryptedExportBundle } from "../shared/encrypted-export.js";
import type {
  AppSettings,
  BackupEntry,
  BackupExportOptions,
  BackupImportOptions,
  BatchExportRequest,
  BatchExportFormat,
  EncryptedExportImportOptions,
  EncryptedExportImportResult,
  ExportPayload,
  NoteRecord,
  NotesBackup,
  RestoreResult,
  SettingsUpdatePayload
} from "../shared/types.js";

const NOTE_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const MAX_TEXT_FIELD_LENGTH = 500_000;
const MAX_FOLDER_LENGTH = 40;
const EDIT_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const ENCRYPTED_NOTE_EXPORT_EXTENSION = "suiji-note";
const ENCRYPTED_BATCH_EXPORT_EXTENSION = "suiji-export";
const ALLOWED_EXPORT_FORMATS = new Set(["html", "json", "txt", "md", "pdf"]);
const ALLOWED_BATCH_EXPORT_FORMATS = new Set(["html", "json", "txt", "md"]);
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const DB_FLUSH_DELAY_MS = 900;
const IDLE_LOCK_CHECK_INTERVAL_MS = 15_000;
const DEBUG_LOG_PATH = process.env.SUIJI_DEBUG_LOG || (app.isPackaged ? "" : "d:\\zhuomian\\essay\\runtime_cache\\suiji-debug.log");
const DEBUG_PORT = process.env.SUIJI_DEBUG_PORT || "";

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
let settingsCache: StoredSettings | null = null;
let activePrivacyPin: string | null = null;
let idleLockTimer: NodeJS.Timeout | null = null;
let idleLockTriggered = false;

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
  settingsCache = null;
  const settings = await readStoredSettings();
  if (isStorageEncryptionEnabled(settings) && !activePrivacyPin) {
    if (notesDb) {
      notesDb.close();
      notesDb = null;
    }
    return;
  }
  try {
    await initializeNotesDatabase(settings);
  } catch (error) {
    if (isStorageEncryptionEnabled(settings)) {
      activePrivacyPin = null;
      if (notesDb) {
        notesDb.close();
        notesDb = null;
      }
      return;
    }
    throw error;
  }
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

async function readStoredBytesFile(filePath: string) {
  const raw = await fs.readFile(filePath);
  return decodeStoredBytes(raw, activePrivacyPin);
}

async function readStoredTextFile(filePath: string) {
  return (await readStoredBytesFile(filePath)).toString("utf8");
}

async function writeStoredBytesFile(filePath: string, content: Uint8Array, settings: StoredSettings) {
  const payload = encodeStoredBytes(content, activePrivacyPin, settings.privacyPinSalt, isStorageEncryptionEnabled(settings));
  await atomicWriteBytes(filePath, payload);
}

async function writeStoredJsonFile(filePath: string, value: unknown, settings: StoredSettings) {
  await writeStoredBytesFile(filePath, Buffer.from(JSON.stringify(value, null, 2), "utf8"), settings);
}

async function writeEncryptedBackupExport(filePath: string, value: unknown, pin: string) {
  const payload = encodeStoredBytes(
    Buffer.from(JSON.stringify(value, null, 2), "utf8"),
    pin,
    randomBytes(16).toString("hex"),
    true
  );
  await atomicWriteBytes(filePath, payload);
}

async function readImportedBackupText(filePath: string, providedPin?: string) {
  const raw = await fs.readFile(filePath);
  const pin = coerceString(providedPin, "", MAX_PIN_LENGTH).trim() || activePrivacyPin || null;
  if (!pin) {
    try {
      return decodeStoredBytes(raw, null).toString("utf8");
    } catch {
      throw new Error("加密文件需要先输入当前隐私密码");
    }
  }
  try {
    return decodeStoredBytes(raw, pin).toString("utf8");
  } catch {
    throw new Error("当前隐私密码无法解密这个文件");
  }
}

async function ensureNotesDatabaseReady() {
  const settings = await readStoredSettings();
  if (isStorageEncryptionEnabled(settings) && !activePrivacyPin) {
    throw new Error("Storage locked");
  }
  if (!notesDb) {
    await initializeNotesDatabase(settings);
  }
  return settings;
}

async function backupExistingNote(id: string, prefix = "note") {
  const settings = await readStoredSettings();
  if (!settings.backupHistoryEnabled) return;
  try {
    const note = await readNote(id);
    await writeStoredJsonFile(backupPath(prefix, id), note, settings);
  } catch {
    // No backup is needed when the note does not exist yet.
  }
}

async function backupExistingNoteIfStale(id: string, prefix = "note", minIntervalMs = EDIT_BACKUP_INTERVAL_MS) {
  const settings = await readStoredSettings();
  if (!settings.backupHistoryEnabled) return;
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

async function pruneBackups() {
  const settings = await readStoredSettings();
  const limit = settings.backupHistoryEnabled ? settings.backupHistoryLimit : 0;
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
    idleLockMinutes: Math.min(Math.max(Number(payload.idleLockMinutes) || 0, 0), 240),
    backupHistoryEnabled: payload.backupHistoryEnabled !== false,
    backupHistoryLimit: Math.min(
      Math.max(Number(payload.backupHistoryLimit) || DEFAULT_BACKUP_HISTORY_LIMIT, 1),
      MAX_BACKUP_HISTORY_LIMIT
    ),
    encryptLocalData: Boolean(payload.encryptLocalData),
    launchAtLogin: Boolean(payload.launchAtLogin),
    theme: payload.theme === "dark" ? "dark" : "light",
    fontFamily: coerceString(payload.fontFamily, "", 120),
    fontSize: Math.min(Math.max(Number(payload.fontSize) || 16, 13), 24),
    lineWidth: Math.min(Math.max(Number(payload.lineWidth) || 880, 640), 1200),
    lineHeight: Math.min(Math.max(Number(payload.lineHeight) || 1.72, 1.35), 2.2),
    currentPrivacyPin:
      typeof payload.currentPrivacyPin === "string" ? payload.currentPrivacyPin.slice(0, MAX_PIN_LENGTH) : undefined,
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
    note: sanitizeNotePayload(payload.note),
    encrypted: Boolean(payload.encrypted),
    currentPrivacyPin:
      typeof payload.currentPrivacyPin === "string" ? payload.currentPrivacyPin.slice(0, MAX_PIN_LENGTH) : undefined
  };
}

function sanitizeBatchExportRequest(raw: unknown): BatchExportRequest {
  if (typeof raw === "string") {
    if (!isBatchExportFormat(raw)) {
      throw new Error("Invalid export format");
    }
    return { format: raw };
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid export payload");
  }
  const payload = raw as Partial<BatchExportRequest>;
  if (!isBatchExportFormat(payload.format)) {
    throw new Error("Invalid export format");
  }
  return {
    format: payload.format,
    encrypted: Boolean(payload.encrypted),
    currentPrivacyPin:
      typeof payload.currentPrivacyPin === "string" ? payload.currentPrivacyPin.slice(0, MAX_PIN_LENGTH) : undefined
  };
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
  if (!notesDb) throw new Error("Storage locked");
  notesDb.exec({ sql, bind });
}

function dbRows<T>(sql: string, bind: unknown[] = []) {
  if (!notesDb) throw new Error("Storage locked");
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

async function persistNotesDatabase(settingsOverride?: StoredSettings) {
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
    const settings = settingsOverride ?? (await readStoredSettings());
    await writeStoredBytesFile(databasePath, bytes, settings);
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

async function initializeNotesDatabase(settings?: StoredSettings) {
  const effectiveSettings = settings ?? (await readStoredSettings());
  if (notesDb) {
    notesDb.close();
    notesDb = null;
  }

  const sqlite3 = await loadSqliteRuntime();
  try {
    const bytes = await readStoredBytesFile(databasePath);
    sqlite3.capi.sqlite3_js_posix_create_file(databaseVirtualPath, bytes);
  } catch {
    // A missing database file means this is the first launch for the data directory.
  }

  notesDb = new sqlite3.oo1.DB(databaseVirtualPath, "c");
  sqlite3.capi.sqlite3_trace_v2(notesDb.pointer, 0, 0, 0);
  ensureNotesSchema();
  await migrateJsonNotesToDatabaseIfNeeded();
  notesDbDirty = true;
  await persistNotesDatabase(effectiveSettings);
}

async function writeNoteToDatabase(note: NoteRecord, persist = true) {
  await ensureNotesDatabaseReady();
  upsertNoteInDatabase(note);
  if (persist) scheduleNotesDatabasePersist();
}

async function readStoredSettings(): Promise<StoredSettings> {
  if (settingsCache) return settingsCache;
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    settingsCache = sanitizeStoredSettings(JSON.parse(raw) as Partial<StoredSettings>);
    return settingsCache;
  } catch {
    await writeStoredSettings(DEFAULT_SETTINGS);
    settingsCache = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }
}

async function readSettings(): Promise<AppSettings> {
  return publicSettings(await readStoredSettings(), activePrivacyPin);
}

async function writeStoredSettings(settings: StoredSettings) {
  settingsCache = sanitizeStoredSettings(settings);
  await atomicWriteFile(settingsPath, JSON.stringify(settingsCache, null, 2));
}

async function rewriteLocalBackupFiles(currentPin: string | null, nextSettings: StoredSettings, nextPin: string | null) {
  const entries = await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(backupsDir, entry.name);
    const raw = decodeStoredBytes(await fs.readFile(filePath), currentPin).toString("utf8");
    const pinBeforeWrite = activePrivacyPin;
    activePrivacyPin = nextPin;
    try {
      await writeStoredBytesFile(filePath, Buffer.from(raw, "utf8"), nextSettings);
    } finally {
      activePrivacyPin = pinBeforeWrite;
    }
  }
}

async function reconfigureLocalStorage(current: StoredSettings, next: StoredSettings, nextPin: string | null) {
  const currentPin = activePrivacyPin;
  if (!notesDb) {
    const pinBeforeReload = activePrivacyPin;
    activePrivacyPin = nextPin;
    try {
      if (!isStorageEncryptionEnabled(next) || nextPin) {
        await initializeNotesDatabase(next);
      }
    } finally {
      activePrivacyPin = pinBeforeReload;
    }
    return;
  }

  const pinBeforeRewrite = activePrivacyPin;
  activePrivacyPin = nextPin;
  try {
    notesDbDirty = true;
    await persistNotesDatabase(next);
    if (!next.backupHistoryEnabled) {
      await pruneBackups();
    } else {
      await rewriteLocalBackupFiles(currentPin, next, nextPin);
      await pruneBackups();
    }
  } finally {
    activePrivacyPin = pinBeforeRewrite;
  }
}

async function updateStoredSettings(payload: SettingsUpdatePayload): Promise<AppSettings> {
  const current = await readStoredSettings();
  const requiresCurrentPin =
    Boolean(current.privacyPinHash && current.privacyPinSalt) &&
    (Boolean(payload.clearPrivacyPin) ||
      (typeof payload.privacyPin === "string" && payload.privacyPin.trim()) ||
      Boolean(payload.encryptLocalData) !== Boolean(current.storageEncrypted));
  const verifiedCurrentPin = requiresCurrentPin
    ? resolveVerifiedPin(current, payload.currentPrivacyPin, activePrivacyPin, false)
    : activePrivacyPin;
  const nextPin =
    payload.clearPrivacyPin
      ? null
      : typeof payload.privacyPin === "string" && payload.privacyPin.trim()
        ? payload.privacyPin.trim().slice(0, MAX_PIN_LENGTH)
        : verifiedCurrentPin;
  const next: StoredSettings = {
    ...current,
    hotkey: payload.hotkey || DEFAULT_HOTKEY,
    startHidden: Boolean(payload.startHidden),
    lockOnHide: Boolean(payload.lockOnHide),
    idleLockMinutes: payload.idleLockMinutes,
    backupHistoryEnabled: Boolean(payload.backupHistoryEnabled),
    backupHistoryLimit: payload.backupHistoryLimit,
    storageEncrypted: Boolean(payload.encryptLocalData),
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

  if (next.storageEncrypted && !(next.privacyPinHash && next.privacyPinSalt && nextPin)) {
    throw new Error("开启本地加密前需要先输入隐私密码");
  }

  if (!next.privacyPinHash || !next.privacyPinSalt) {
    next.storageEncrypted = false;
  }

  const storageChanged =
    current.backupHistoryEnabled !== next.backupHistoryEnabled ||
    current.backupHistoryLimit !== next.backupHistoryLimit ||
    isStorageEncryptionEnabled(current) !== isStorageEncryptionEnabled(next) ||
    current.privacyPinHash !== next.privacyPinHash ||
    current.privacyPinSalt !== next.privacyPinSalt;
  if (storageChanged) {
    await reconfigureLocalStorage(current, next, nextPin);
  }
  activePrivacyPin = next.storageEncrypted || next.privacyPinHash ? nextPin : null;

  await writeStoredSettings(next);
  if (!next.backupHistoryEnabled) {
    await pruneBackups();
  }
  app.setLoginItemSettings({
    openAtLogin: next.launchAtLogin,
    openAsHidden: next.startHidden
  });
  refreshIdleLockMonitor();
  return publicSettings(next, activePrivacyPin);
}

async function listNotes(): Promise<NoteRecord[]> {
  await ensureNotesDatabaseReady();
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
  try {
    await ensureNotesDatabaseReady();
  } catch {
    return [];
  }
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

async function exportAllNotesBackup(options?: BackupExportOptions) {
  const notes = await listNotes();
  const settings = await readStoredSettings();
  const encrypted = Boolean(options?.encrypted);
  const verifiedPin = encrypted ? resolveVerifiedPin(settings, options?.currentPrivacyPin, activePrivacyPin) : null;
  const backup: NotesBackup = {
    app: "suiji",
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    notes
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: encrypted ? "导出加密备份" : "备份全部记录",
        defaultPath: defaultBackupName(encrypted),
        filters: [
          encrypted
            ? { name: "Suiji Encrypted Backup", extensions: ["suiji-backup"] }
            : { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showSaveDialog({
        title: encrypted ? "导出加密备份" : "备份全部记录",
        defaultPath: defaultBackupName(encrypted),
        filters: [
          encrypted
            ? { name: "Suiji Encrypted Backup", extensions: ["suiji-backup"] }
            : { name: "JSON Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

  if (result.canceled || !result.filePath) return null;
  if (encrypted && verifiedPin) {
    await writeEncryptedBackupExport(result.filePath, backup, verifiedPin);
  } else {
    await atomicWriteFile(result.filePath, JSON.stringify(backup, null, 2));
  }
  return result.filePath;
}

async function restoreNotesBackup(options?: BackupImportOptions): Promise<RestoreResult | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "恢复记录备份",
        properties: ["openFile"],
        filters: [
          { name: "Suiji Backup", extensions: ["json", "suiji-backup"] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showOpenDialog({
        title: "恢复记录备份",
        properties: ["openFile"],
        filters: [
          { name: "Suiji Backup", extensions: ["json", "suiji-backup"] },
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

  const raw = await readImportedBackupText(result.filePaths[0], options?.currentPrivacyPin);
  const backupNotes = parseBackupNotes(JSON.parse(raw));
  return importSanitizedNotes(backupNotes, "restore");
}

async function importEncryptedExport(
  options?: EncryptedExportImportOptions
): Promise<EncryptedExportImportResult | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "导入加密导出",
        properties: ["openFile"],
        filters: [
          { name: "Suiji Encrypted Export", extensions: [ENCRYPTED_NOTE_EXPORT_EXTENSION, ENCRYPTED_BATCH_EXPORT_EXTENSION] },
          { name: "All Files", extensions: ["*"] }
        ]
      })
    : await dialog.showOpenDialog({
        title: "导入加密导出",
        properties: ["openFile"],
        filters: [
          { name: "Suiji Encrypted Export", extensions: [ENCRYPTED_NOTE_EXPORT_EXTENSION, ENCRYPTED_BATCH_EXPORT_EXTENSION] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

  if (result.canceled || result.filePaths.length === 0) return null;

  const warningOptions: MessageBoxOptions = {
    type: "warning",
    buttons: ["继续导入", "取消"],
    cancelId: 1,
    defaultId: 1,
    title: "导入加密导出",
    message: "导入会把加密导出里的记录写回当前资料库",
    detail: "如果本地存在相同 ID 的记录，应用会先保留本地历史版本，再用导出内容覆盖。"
  };
  const warning = mainWindow
    ? await dialog.showMessageBox(mainWindow, warningOptions)
    : await dialog.showMessageBox(warningOptions);
  if (warning.response !== 0) return null;

  const raw = await readImportedBackupText(result.filePaths[0], options?.currentPrivacyPin);
  const parsed = parseEncryptedExportBundle(JSON.parse(raw));
  const imported = await importSanitizedNotes(parsed.notes, parsed.kind === "note-export" ? "import-note" : "import-batch");
  return {
    ...imported,
    kind: parsed.kind
  };
}

async function importSanitizedNotes(rawNotes: unknown[], backupPrefix: string): Promise<RestoreResult> {
  let imported = 0;
  let skipped = 0;

  for (const rawNote of rawNotes) {
    try {
      const note = sanitizeNotePayload(rawNote);
      await backupExistingNote(note.id, backupPrefix);
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
    total: rawNotes.length,
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
  await ensureNotesDatabaseReady();
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
  await ensureNotesDatabaseReady();
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
  await ensureNotesDatabaseReady();
  const now = new Date().toISOString();
  const note = normalizeNote({
    id: randomUUID(),
    title: "未命名记录",
    content: emptyDoc,
    createdAt: now,
    updatedAt: now
  });
  await writeNoteToDatabase(note, false);
  await persistNotesDatabase();
  return note;
}

async function createNoteFromContent(title: string, plainText: string, content: NoteRecord["content"], html = "") {
  await ensureNotesDatabaseReady();
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
  await writeNoteToDatabase(note, false);
  await persistNotesDatabase();
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

async function batchExportNotes(rawPayload: BatchExportRequest | BatchExportFormat): Promise<string | { directory: string; count: number } | null> {
  const payload = sanitizeBatchExportRequest(rawPayload);
  const settings = await readStoredSettings();
  const canEncrypt = true;
  const warningOptions: MessageBoxOptions = canEncrypt
    ? {
        type: "question",
        buttons: ["明文导出", "加密导出", "取消"],
        cancelId: 2,
        defaultId: 0,
        title: "批量导出记录",
        message: "请选择导出方式",
        detail: "明文导出会生成普通文件；加密导出会生成仅限随记识别的专用加密文件。"
      }
    : {
        type: "warning",
        buttons: ["继续导出", "取消"],
        cancelId: 1,
        defaultId: 1,
        title: "批量导出记录",
        message: "批量导出会生成明文文件",
        detail: "请确认导出目录安全，避免把包含隐私的记录导出到公共目录、同步盘或共享设备。"
      };
  const warning = mainWindow
    ? await dialog.showMessageBox(mainWindow, warningOptions)
    : await dialog.showMessageBox(warningOptions);
  if (warning.response === warningOptions.cancelId) return null;

  const encrypted = canEncrypt && warning.response === 1;
  const notes = (await listNotes()).filter((note) => !note.trashedAt);

  if (encrypted) {
    const verifiedPin = resolveVerifiedPin(settings, payload.currentPrivacyPin, activePrivacyPin);
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: "导出加密记录",
          defaultPath: defaultEncryptedBatchExportName(),
          filters: [
            { name: "Suiji Encrypted Export", extensions: [ENCRYPTED_BATCH_EXPORT_EXTENSION] },
            { name: "All Files", extensions: ["*"] }
          ]
        })
      : await dialog.showSaveDialog({
          title: "导出加密记录",
          defaultPath: defaultEncryptedBatchExportName(),
          filters: [
            { name: "Suiji Encrypted Export", extensions: [ENCRYPTED_BATCH_EXPORT_EXTENSION] },
            { name: "All Files", extensions: ["*"] }
          ]
        });
    if (result.canceled || !result.filePath) return null;
    await writeEncryptedBackupExport(
      result.filePath,
      {
        app: "suiji",
        kind: "batch-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        format: payload.format,
        notes
      },
      verifiedPin
    );
    return result.filePath;
  }

  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "选择批量导出目录",
        properties: ["openDirectory", "createDirectory"]
      })
    : await dialog.showOpenDialog({
        title: "选择批量导出目录",
        properties: ["openDirectory", "createDirectory"]
      });
  if (result.canceled || result.filePaths.length === 0) return null;

  const directory = result.filePaths[0];
  for (const note of notes) {
    const filePath = await uniqueExportPath(directory, safeExportName(note.title, payload.format));
    await atomicWriteFile(filePath, buildExportText(note, payload.format));
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

  const raw = await readStoredTextFile(path.join(backupsDir, safeName));
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

function dispatchPrivacyLock() {
  mainWindow?.webContents.send("privacy:lock");
}

async function lockContentForPrivacy(force = false) {
  const settings = await readStoredSettings();
  if (!force && !settings.lockOnHide) return;
  if (isStorageEncryptionEnabled(settings)) {
    await persistNotesDatabase(settings);
    activePrivacyPin = null;
    if (notesDb) {
      try {
        notesDb.close();
      } catch {
        // Lock cleanup is best effort after flushing the encrypted store.
      }
      notesDb = null;
    }
  }
  idleLockTriggered = true;
  dispatchPrivacyLock();
}

function refreshIdleLockMonitor() {
  if (idleLockTimer) {
    clearInterval(idleLockTimer);
    idleLockTimer = null;
  }
  idleLockTriggered = false;
  void readStoredSettings().then((settings) => {
    if (!settings.idleLockMinutes || !(settings.privacyPinHash && settings.privacyPinSalt)) return;
    idleLockTimer = setInterval(() => {
      const thresholdSeconds = settings.idleLockMinutes * 60;
      const idleSeconds = powerMonitor.getSystemIdleTime();
      if (idleSeconds < Math.min(thresholdSeconds, 10)) {
        idleLockTriggered = false;
        return;
      }
      if (idleSeconds >= thresholdSeconds && !idleLockTriggered) {
        idleLockTriggered = true;
        void lockContentForPrivacy(true);
      }
    }, IDLE_LOCK_CHECK_INTERVAL_MS);
  });
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate({
        appQuit: () => {
          isQuitting = true;
          app.quit();
        },
        hideWindow,
        onAbout: () => {
          const options = {
            type: "info",
            title: "关于随记",
            message: "随记",
            detail:
              `版本：${app.getVersion()}\n版权：Copyright (c) 2026 Suiji. All rights reserved.\n\n随记是快捷呼出的本地自动保存富文本记录工具。可选启用本地加密来保护数据库、历史版本和整库备份；单篇与批量导出可按需选择明文或加密。`
          } as const;
          if (mainWindow) {
            void dialog.showMessageBox(mainWindow, options);
          } else {
            void dialog.showMessageBox(options);
          }
        },
        onClipboardNote: createClipboardNote,
        sendMenu: (channel, payload) => mainWindow?.webContents.send(channel, payload),
        showWindow
      })
    )
  );
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
    Menu.buildFromTemplate(
      buildTrayMenuTemplate(settings, {
        appQuit: () => {
          isQuitting = true;
          app.quit();
        },
        hideWindow,
        onAbout: () => undefined,
        onClipboardNote: createClipboardNote,
        sendMenu: (channel, payload) => mainWindow?.webContents.send(channel, payload),
        showWindow
      })
    )
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
  ipcMain.handle("notes:backup-all", (_event, options?: BackupExportOptions) => exportAllNotesBackup(options));
  ipcMain.handle("notes:restore-backup", (_event, options?: BackupImportOptions) => restoreNotesBackup(options));
  ipcMain.handle("notes:import-encrypted-export", (_event, options?: EncryptedExportImportOptions) =>
    importEncryptedExport(options)
  );
  ipcMain.handle("notes:import-markdown", importMarkdownNotes);
  ipcMain.handle("notes:batch-export", (_event, payload: BatchExportRequest | BatchExportFormat) =>
    batchExportNotes(payload)
  );
  ipcMain.handle("notes:export", async (_event, rawPayload: ExportPayload) => {
    const payload = sanitizeExportPayload(rawPayload);
    const settings = await readStoredSettings();
    const canEncrypt = payload.format !== "pdf";
    const warningOptions: MessageBoxOptions = canEncrypt
      ? {
          type: "question",
          buttons: ["明文导出", "加密导出", "取消"],
          cancelId: 2,
          defaultId: 0,
          title: "导出记录",
          message: "请选择导出方式",
          detail: "明文导出会保存普通文件；加密导出会保存为仅限随记识别的专用加密文件。"
        }
      : {
          type: "warning",
          buttons: ["继续导出", "取消"],
          cancelId: 1,
          defaultId: 1,
          title: "导出 PDF 文件",
          message: "导出的文件会保存为 PDF",
          detail: "请确认保存位置安全，避免把包含隐私的记录导出到公共目录、同步盘或共享设备。"
        };
    const warning = mainWindow
      ? await dialog.showMessageBox(mainWindow, warningOptions)
      : await dialog.showMessageBox(warningOptions);
    if (warning.response === warningOptions.cancelId) return null;

    const encrypted = canEncrypt && warning.response === 1;
    const ext = encrypted ? ENCRYPTED_NOTE_EXPORT_EXTENSION : payload.format;
    const dialogOptions = encrypted
      ? {
          title: "导出加密记录",
          defaultPath: `${safeExportBaseName(payload.note.title)}.${ENCRYPTED_NOTE_EXPORT_EXTENSION}`,
          filters: [
            { name: "Suiji Encrypted Note", extensions: [ENCRYPTED_NOTE_EXPORT_EXTENSION] },
            { name: "All Files", extensions: ["*"] }
          ]
        }
      : {
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

    if (encrypted) {
      const verifiedPin = resolveVerifiedPin(settings, payload.currentPrivacyPin, activePrivacyPin);
      await writeEncryptedBackupExport(
        result.filePath,
        {
          app: "suiji",
          kind: "note-export",
          version: 1,
          exportedAt: new Date().toISOString(),
          format: payload.format,
          note: payload.note
        },
        verifiedPin
      );
      return result.filePath;
    }

    await atomicWriteFile(result.filePath, buildExportText(payload.note, payload.format));
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
  ipcMain.handle("privacy:verify-pin", async (_event, pin: string) => {
    const settings = await readStoredSettings();
    const candidate = coerceString(pin, "", MAX_PIN_LENGTH);
    const ok = verifyPin(settings, candidate);
    if (!ok) return false;
    activePrivacyPin = candidate;
    idleLockTriggered = false;
    if (isStorageEncryptionEnabled(settings) && !notesDb) {
      await initializeNotesDatabase(settings);
    }
    return true;
  });
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
    refreshIdleLockMonitor();
    powerMonitor.on("suspend", () => {
      void lockContentForPrivacy(true);
    });
    powerMonitor.on("lock-screen", () => {
      void lockContentForPrivacy(true);
    });

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
    if (idleLockTimer) clearInterval(idleLockTimer);
    if (notesDb) {
      try {
        notesDb.close();
      } catch {
        // Shutdown cleanup is best effort; pending writes are flushed in before-quit.
      }
    }
  });
}

