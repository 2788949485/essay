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
  hasPrivacyPin: boolean;
  launchAtLogin: boolean;
  theme: "light" | "dark";
  fontFamily: string;
  fontSize: number;
  lineWidth: number;
  lineHeight: number;
};

export type SettingsUpdatePayload = {
  hotkey: string;
  startHidden: boolean;
  lockOnHide: boolean;
  launchAtLogin: boolean;
  theme: "light" | "dark";
  fontFamily: string;
  fontSize: number;
  lineWidth: number;
  lineHeight: number;
  privacyPin?: string;
  clearPrivacyPin?: boolean;
};

export type BatchExportFormat = "html" | "json" | "txt" | "md";

export type ExportPayload = {
  note: NoteRecord;
  format: "html" | "json" | "txt" | "md";
};

export type NotesBackup = {
  app: "suiji";
  version: string;
  exportedAt: string;
  notes: NoteRecord[];
};

export type RestoreResult = {
  total: number;
  imported: number;
  skipped: number;
};

export type BackupEntry = {
  fileName: string;
  prefix: string;
  createdAt: string;
  size: number;
};
