import type { JSONContent } from "@tiptap/react";

export type NoteSummary = {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  folder: string;
  favoriteAt: string | null;
  archivedAt: string | null;
  trashedAt: string | null;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteRecord = NoteSummary & {
  content: JSONContent;
  html: string;
  plainText: string;
};

export type AppSettings = {
  hotkey: string;
  startHidden: boolean;
  lockOnHide: boolean;
  idleLockMinutes: number;
  hasPrivacyPin: boolean;
  backupHistoryEnabled: boolean;
  backupHistoryLimit: number;
  storageEncrypted: boolean;
  storageUnlocked: boolean;
  launchAtLogin: boolean;
  alwaysOnTop: boolean;
  theme: "light" | "dark";
  fontFamily: string;
  fontSize: number;
  lineWidth: number;
  lineHeight: number;
  trashRetentionDays: number;
};

export type SettingsUpdatePayload = {
  hotkey: string;
  startHidden: boolean;
  lockOnHide: boolean;
  idleLockMinutes: number;
  backupHistoryEnabled: boolean;
  backupHistoryLimit: number;
  encryptLocalData: boolean;
  launchAtLogin: boolean;
  alwaysOnTop: boolean;
  theme: "light" | "dark";
  fontFamily: string;
  fontSize: number;
  lineWidth: number;
  lineHeight: number;
  trashRetentionDays: number;
  currentPrivacyPin?: string;
  privacyPin?: string;
  clearPrivacyPin?: boolean;
};

export type BackupExportOptions = {
  encrypted: boolean;
  currentPrivacyPin?: string;
};

export type BackupImportOptions = {
  currentPrivacyPin?: string;
};

export type EncryptedExportImportOptions = {
  currentPrivacyPin?: string;
};

export type BatchExportFormat = "html" | "json" | "txt" | "md";

export type BatchExportRequest = {
  format: BatchExportFormat;
  encrypted?: boolean;
  currentPrivacyPin?: string;
};

export type ExportPayload = {
  note: NoteRecord;
  format: "html" | "json" | "txt" | "md" | "pdf";
  encrypted?: boolean;
  currentPrivacyPin?: string;
};

export type BackupAttachment = {
  name: string;
  data: string;
};

export type NotesBackup = {
  app: "suiji";
  version: string;
  exportedAt: string;
  notes: NoteRecord[];
  attachments?: BackupAttachment[];
};

export type RestoreFailure = {
  id?: string;
  title?: string;
  reason: string;
};

export type RestoreResult = {
  total: number;
  imported: number;
  skipped: number;
  failures?: RestoreFailure[];
};

export type EncryptedExportImportResult = RestoreResult & {
  kind: "note-export" | "batch-export";
};

export type BackupEntry = {
  fileName: string;
  prefix: string;
  createdAt: string;
  size: number;
};
