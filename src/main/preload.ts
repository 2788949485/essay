import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, ExportPayload, NoteRecord, SettingsUpdatePayload } from "../shared/types.js";

const api = {
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<NoteRecord[]>,
  createNote: () => ipcRenderer.invoke("notes:create") as Promise<NoteRecord>,
  saveNote: (note: NoteRecord) => ipcRenderer.invoke("notes:save", note) as Promise<NoteRecord>,
  togglePinNote: (id: string) => ipcRenderer.invoke("notes:toggle-pin", id) as Promise<NoteRecord>,
  deleteNote: (id: string) => ipcRenderer.invoke("notes:delete", id) as Promise<void>,
  exportNote: (payload: ExportPayload) => ipcRenderer.invoke("notes:export", payload) as Promise<string | null>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  updateSettings: (settings: SettingsUpdatePayload) =>
    ipcRenderer.invoke("settings:update", settings) as Promise<AppSettings>,
  verifyPrivacyPin: (pin: string) => ipcRenderer.invoke("privacy:verify-pin", pin) as Promise<boolean>,
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
