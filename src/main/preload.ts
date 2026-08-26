import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  BackupExportOptions,
  BackupImportOptions,
  BackupEntry,
  BatchExportFormat,
  BatchExportRequest,
  EncryptedExportImportOptions,
  EncryptedExportImportResult,
  ExportPayload,
  NoteRecord,
  RestoreResult,
  SettingsUpdatePayload
} from "../shared/types.js";

const api = {
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<NoteRecord[]>,
  searchNotes: (query: string) => ipcRenderer.invoke("notes:search", query) as Promise<string[]>,
  createNote: () => ipcRenderer.invoke("notes:create") as Promise<NoteRecord>,
  saveNote: (note: NoteRecord) => ipcRenderer.invoke("notes:save", note) as Promise<NoteRecord>,
  togglePinNote: (id: string) => ipcRenderer.invoke("notes:toggle-pin", id) as Promise<NoteRecord>,
  toggleFavoriteNote: (id: string) => ipcRenderer.invoke("notes:toggle-favorite", id) as Promise<NoteRecord>,
  toggleArchiveNote: (id: string) => ipcRenderer.invoke("notes:toggle-archive", id) as Promise<NoteRecord>,
  deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", id) as Promise<void>,
  restoreNote: (id: string) => ipcRenderer.invoke("notes:restore", id) as Promise<NoteRecord>,
  purgeNote: (id: string) => ipcRenderer.invoke("notes:purge", id) as Promise<void>,
  renameTag: (from: string, to: string) => ipcRenderer.invoke("notes:rename-tag", from, to) as Promise<number>,
  listNoteBackups: (id: string) => ipcRenderer.invoke("notes:list-backups", id) as Promise<BackupEntry[]>,
  restoreNoteBackup: (id: string, fileName: string) =>
    ipcRenderer.invoke("notes:restore-backup-version", id, fileName) as Promise<NoteRecord>,
  backupAllNotes: (options: BackupExportOptions) =>
    ipcRenderer.invoke("notes:backup-all", options) as Promise<string | null>,
  restoreNotesBackup: (options: BackupImportOptions) =>
    ipcRenderer.invoke("notes:restore-backup", options) as Promise<RestoreResult | null>,
  importEncryptedExport: (options: EncryptedExportImportOptions) =>
    ipcRenderer.invoke("notes:import-encrypted-export", options) as Promise<EncryptedExportImportResult | null>,
  importMarkdownNotes: () => ipcRenderer.invoke("notes:import-markdown") as Promise<NoteRecord[]>,
  saveImageAsset: (payload: { base64: string; ext: string }) =>
    ipcRenderer.invoke("notes:save-asset", payload) as Promise<string>,
  batchExportNotes: (payload: BatchExportRequest) =>
    ipcRenderer.invoke("notes:batch-export", payload) as Promise<string | { directory: string; count: number } | null>,
  exportNote: (payload: ExportPayload) => ipcRenderer.invoke("notes:export", payload) as Promise<string | null>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  updateSettings: (settings: SettingsUpdatePayload) =>
    ipcRenderer.invoke("settings:update", settings) as Promise<AppSettings>,
  testHotkey: (hotkey: string) => ipcRenderer.invoke("settings:test-hotkey", hotkey) as Promise<boolean>,
  verifyPrivacyPin: (pin: string) => ipcRenderer.invoke("privacy:verify-pin", pin) as Promise<boolean>,
  openExternalLink: (url: string) => ipcRenderer.invoke("shell:open-external", url) as Promise<boolean>,
  openDataFolder: () => ipcRenderer.invoke("app:open-data-folder") as Promise<string | null>,
  changeDataFolder: () => ipcRenderer.invoke("app:change-data-folder") as Promise<string | null>,
  hideWindow: () => ipcRenderer.invoke("window:hide") as Promise<void>,
  onNewNote: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:new-note", listener);
    return () => {
      ipcRenderer.removeListener("menu:new-note", listener);
    };
  },
  onOpenFind: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:find", listener);
    return () => {
      ipcRenderer.removeListener("menu:find", listener);
    };
  },
  onOpenReplace: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:replace", listener);
    return () => {
      ipcRenderer.removeListener("menu:replace", listener);
    };
  },
  onSaveRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:save", listener);
    return () => {
      ipcRenderer.removeListener("menu:save", listener);
    };
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:settings", listener);
    return () => {
      ipcRenderer.removeListener("menu:settings", listener);
    };
  },
  onOpenHistory: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:history", listener);
    return () => {
      ipcRenderer.removeListener("menu:history", listener);
    };
  },
  onExportNote: (callback: (format: ExportPayload["format"]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, format: ExportPayload["format"]) => callback(format);
    ipcRenderer.on("menu:export-note", listener);
    return () => {
      ipcRenderer.removeListener("menu:export-note", listener);
    };
  },
  onBatchExport: (callback: (format: BatchExportFormat) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, format: BatchExportFormat) => callback(format);
    ipcRenderer.on("menu:batch-export", listener);
    return () => {
      ipcRenderer.removeListener("menu:batch-export", listener);
    };
  },
  onPrivacyLock: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("privacy:lock", listener);
    return () => {
      ipcRenderer.removeListener("privacy:lock", listener);
    };
  },
  onNotesReload: (callback: (id?: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id?: string) => callback(id);
    ipcRenderer.on("notes:reload", listener);
    return () => {
      ipcRenderer.removeListener("notes:reload", listener);
    };
  }
};

contextBridge.exposeInMainWorld("suiji", api);

export type SuijiApi = typeof api;
