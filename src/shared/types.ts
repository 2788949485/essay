import type { JSONContent } from "@tiptap/react";

export type NoteSummary = {
  id: string;
  title: string;
  excerpt: string;
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
};

export type SettingsUpdatePayload = {
  hotkey: string;
  startHidden: boolean;
  lockOnHide: boolean;
  privacyPin?: string;
  clearPrivacyPin?: boolean;
};

export type ExportPayload = {
  note: NoteRecord;
  format: "html" | "json" | "txt" | "md";
};
