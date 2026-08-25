import type { AppSettings } from "../shared/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type ExportFormat = "html" | "json" | "txt" | "md" | "pdf";
export type ViewMode = "active" | "favorites" | "archive" | "trash" | "recent";
export type LeftPaneMode = "document" | "files";

export type FindMatch = {
  from: number;
  to: number;
};

export type OutlineItem = {
  level: number;
  text: string;
  pos: number;
};

export type LinkDialogState = {
  empty: boolean;
  from: number;
  to: number;
  hasActiveLink: boolean;
};

export type BlockMenuCommand = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
};

export type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  icon?: "trash" | "history";
  onConfirm: () => Promise<void> | void;
};

export type TextRole = "body" | "caption";
export type ColorToken = "default" | "slate" | "gray" | "indigo" | "blue" | "mint" | "purple" | "pink" | "peach" | "sand";
export type FontPresetId = "default" | "serif" | "mono" | "rounded";

export type SearchSyntax = {
  text: string;
  tags: string[];
  folder: string;
  fav: boolean;
  archive: boolean;
  trash: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  hotkey: "CommandOrControl+Alt+J",
  startHidden: false,
  lockOnHide: true,
  idleLockMinutes: 0,
  hasPrivacyPin: false,
  backupHistoryEnabled: true,
  backupHistoryLimit: 80,
  storageEncrypted: false,
  storageUnlocked: true,
  launchAtLogin: false,
  theme: "light",
  fontFamily: "",
  fontSize: 16,
  lineWidth: 880,
  lineHeight: 1.72
};

export const FORMAT_COLORS: Array<{ id: ColorToken; label: string; swatch: string }> = [
  { id: "default", label: "默认", swatch: "#3a3f47" },
  { id: "slate", label: "石墨", swatch: "#64748b" },
  { id: "gray", label: "银灰", swatch: "#9ca3af" },
  { id: "indigo", label: "靛蓝", swatch: "#1d39f2" },
  { id: "blue", label: "天蓝", swatch: "#316ee8" },
  { id: "mint", label: "薄荷", swatch: "#59c98c" },
  { id: "purple", label: "紫罗兰", swatch: "#a12ee7" },
  { id: "pink", label: "粉莓", swatch: "#e11d48" },
  { id: "peach", label: "蜜桃", swatch: "#f28f32" },
  { id: "sand", label: "砂岩", swatch: "#8b5a21" }
];

export const FONT_PRESETS: Array<{ id: FontPresetId; label: string; preview: string; family: string }> = [
  { id: "default", label: "默认", preview: "Aa", family: "" },
  { id: "serif", label: "衬线", preview: "Ss", family: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif' },
  { id: "mono", label: "等宽", preview: "00", family: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", monospace' },
  { id: "rounded", label: "圆体", preview: "Rr", family: '"Arial Rounded MT Bold", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' }
];
