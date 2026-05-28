import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, BackupEntry, ExportPayload, NoteRecord, RestoreResult, SettingsUpdatePayload } from "../shared/types.js";

const api = {
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<NoteRecord[]>,
  createNote: () => ipcRenderer.invoke("notes:create") as Promise<NoteRecord>,
  saveNote: (note: NoteRecord) => ipcRenderer.invoke("notes:save", note) as Promise<NoteRecord>,
  togglePinNote: (id: string) => ipcRenderer.invoke("notes:toggle-pin", id) as Promise<NoteRecord>,
  toggleFavoriteNote: (id: string) => ipcRenderer.invoke("notes:toggle-favorite", id) as Promise<NoteRecord>,
  toggleArchiveNote: (id: string) => ipcRenderer.invoke("notes:toggle-archive", id) as Promise<NoteRecord>,
  deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", id) as Promise<void>,
  restoreNote: (id: string) => ipcRenderer.invoke("notes:restore", id) as Promise<NoteRecord>,
  purgeNote: (id: string) => ipcRenderer.invoke("notes:purge", id) as Promise<void>,
  listNoteBackups: (id: string) => ipcRenderer.invoke("notes:list-backups", id) as Promise<BackupEntry[]>,
  restoreNoteBackup: (id: string, fileName: string) =>
    ipcRenderer.invoke("notes:restore-backup-version", id, fileName) as Promise<NoteRecord>,
  backupAllNotes: () => ipcRenderer.invoke("notes:backup-all") as Promise<string | null>,
  restoreNotesBackup: () => ipcRenderer.invoke("notes:restore-backup") as Promise<RestoreResult | null>,
  exportNote: (payload: ExportPayload) => ipcRenderer.invoke("notes:export", payload) as Promise<string | null>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  updateSettings: (settings: SettingsUpdatePayload) =>
    ipcRenderer.invoke("settings:update", settings) as Promise<AppSettings>,
  verifyPrivacyPin: (pin: string) => ipcRenderer.invoke("privacy:verify-pin", pin) as Promise<boolean>,
  openExternalLink: (url: string) => ipcRenderer.invoke("shell:open-external", url) as Promise<boolean>,
  openDataFolder: () => ipcRenderer.invoke("app:open-data-folder") as Promise<string | null>,
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
  onPrivacyLock: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("privacy:lock", listener);
    return () => {
      ipcRenderer.removeListener("privacy:lock", listener);
    };
  }
};

contextBridge.exposeInMainWorld("suiji", api);

export type SuijiApi = typeof api;
