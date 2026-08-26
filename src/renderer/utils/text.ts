import type { JSONContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { AppSettings, NoteRecord, RestoreFailure } from "../../shared/types";
import { BLOCK_MATH, isStandaloneLatex, splitInlineMath } from "../../shared/math-patterns";
import { FONT_PRESETS, type FontPresetId, type OutlineItem, type SearchSyntax } from "../constants";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function describeRestoreFailures(failures?: RestoreFailure[]): string {
  if (!failures || failures.length === 0) return "";
  const shown = failures.slice(0, 3).map((f) => `${f.title ?? f.id ?? "未知记录"}：${f.reason}`);
  const suffix = failures.length > shown.length ? ` 等 ${failures.length} 条` : "";
  return `（${shown.join("；")}${suffix}）`;
}

export function parseSearchSyntax(value: string): SearchSyntax {
  const tokens = value.match(/"[^"]+"|\S+/g) ?? [];
  const syntax: SearchSyntax = { text: "", tags: [], folder: "", fav: false, archive: false, trash: false };
  const text: string[] = [];

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^"|"$/g, "");
    const lower = token.toLowerCase();
    if (lower.startsWith("tag:")) {
      const tag = token.slice(4).trim().toLowerCase();
      if (tag) syntax.tags.push(tag);
      continue;
    }
    if (lower.startsWith("folder:")) {
      syntax.folder = token.slice(7).trim().toLowerCase();
      continue;
    }
    if (lower === "fav" || lower === "favorite" || lower === "收藏") {
      syntax.fav = true;
      continue;
    }
    if (lower === "archive" || lower === "归档") {
      syntax.archive = true;
      continue;
    }
    if (lower === "trash" || lower === "回收站") {
      syntax.trash = true;
      continue;
    }
    text.push(token);
  }

  syntax.text = text.join(" ").trim().toLowerCase();
  return syntax;
}

export function normalizePastedLineBreaks(text: string): string {
  return text
    .replace(/([一-鿿])\r?\n([一-鿿])/g, "$1$2")
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]+/g, " ");
}

export function buildPlainTextBlocks(text: string): JSONContent[] {
  const blocks: JSONContent[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const normalized = normalizePastedLineBreaks(para).trim();
    if (normalized) blocks.push({ type: "paragraph", content: [{ type: "text", text: normalized }] });
  }
  return blocks;
}

export function splitPastedMath(text: string): JSONContent[] | null {
  if (!text.includes("$")) {
    const latex = text.trim();
    return isStandaloneLatex(latex) ? [{ type: "mathBlock", attrs: { latex } }] : null;
  }
  const blocks: JSONContent[] = [];
  const blockRe = new RegExp(BLOCK_MATH.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  let hasMath = false;

  const flushText = (chunk: string) => {
    if (!chunk) return;
    for (const para of chunk.split(/\n{2,}/)) {
      const inline: JSONContent[] = [];
      for (const seg of splitInlineMath(para)) {
        if (seg.type === "math") {
          inline.push({ type: "mathInline", attrs: { latex: seg.latex } });
          hasMath = true;
        } else if (seg.text) {
          const normalized = normalizePastedLineBreaks(seg.text);
          if (normalized) inline.push({ type: "text", text: normalized });
        }
      }
      blocks.push({ type: "paragraph", content: inline.length ? inline : undefined });
    }
  };

  while ((match = blockRe.exec(text)) !== null) {
    flushText(text.slice(cursor, match.index));
    blocks.push({ type: "mathBlock", attrs: { latex: match[1].trim() } });
    hasMath = true;
    cursor = match.index + match[0].length;
  }
  flushText(text.slice(cursor));

  return hasMath ? blocks : null;
}

export function extractOutline(editor: Editor | null): OutlineItem[] {
  if (!editor) return [];
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const text = node.textContent.trim();
    if (!text) return;
    items.push({ level: Number(node.attrs.level) || 1, text, pos });
  });
  return items;
}

export function isEmptyParagraphSelection(editor: Editor | null) {
  if (!editor) return false;
  const { empty, $from } = editor.state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== "paragraph") return false;
  return $from.parent.textContent.trim() === "";
}

export function getContentPlainText(content: JSONContent | undefined) {
  const parts: string[] = [];

  function walk(node: JSONContent | undefined) {
    if (!node) return;

    if (node.type === "text") {
      if (node.text) parts.push(node.text);
      return;
    }

    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }

    if (node.type === "image") {
      const alt = String(node.attrs?.alt ?? "").trim();
      if (alt) parts.push(alt);
      return;
    }

    if (node.type === "collapsibleBlock") {
      const title = String(node.attrs?.title ?? "").trim();
      if (title) {
        parts.push(title);
        parts.push("\n");
      }
    }

    (node.content ?? []).forEach(walk);

    if (
      [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "listItem",
        "taskItem",
        "collapsibleBlock",
        "tableRow"
      ].includes(node.type ?? "")
    ) {
      parts.push("\n");
    }
    if (["bulletList", "orderedList", "taskList", "table"].includes(node.type ?? "")) {
      parts.push("\n");
    }
  }

  walk(content);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sortNotes(notes: NoteRecord[]) {
  return [...notes].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function parseTagsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 24))
    )
  ).slice(0, 12);
}

export function normalizeFolderInput(value: string) {
  return value
    // eslint-disable-next-line no-control-regex -- 清洗文件系统非法字符
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim()
    .slice(0, 40);
}

export function normalizeLinkUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function formatHotkeyEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const normalizedKey = key.length === 1 ? key.toUpperCase() : key === " " ? "Space" : key.replace("Arrow", "");
  if (!parts.length || !normalizedKey) return "";
  parts.push(normalizedKey);
  return Array.from(new Set(parts)).join("+");
}

export function settingsPayload(settings: AppSettings, hotkey: string) {
  return {
    hotkey: hotkey.trim() || "CommandOrControl+Alt+J",
    startHidden: settings.startHidden,
    lockOnHide: settings.lockOnHide,
    idleLockMinutes: settings.idleLockMinutes,
    backupHistoryEnabled: settings.backupHistoryEnabled,
    backupHistoryLimit: settings.backupHistoryLimit,
    encryptLocalData: settings.storageEncrypted,
    launchAtLogin: settings.launchAtLogin,
    theme: settings.theme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    lineHeight: settings.lineHeight,
    trashRetentionDays: settings.trashRetentionDays
  };
}

export function getCurrentFontPresetId(fontFamily: string | undefined): FontPresetId {
  const current = fontFamily?.trim() || "";
  const matched = FONT_PRESETS.find((preset) => preset.family === current);
  return matched?.id ?? "default";
}

export type OpenTask = {
  noteId: string;
  noteTitle: string;
  text: string;
  updatedAt: string;
};

function nodePlainText(node: JSONContent): string {
  const own = node.type === "text" ? (node.text ?? "") : "";
  return own + (node.content ?? []).map(nodePlainText).join("");
}

export function collectOpenTasks(notes: NoteRecord[]): OpenTask[] {
  const tasks: OpenTask[] = [];
  for (const note of notes) {
    if (note.trashedAt) continue;
    const walk = (node: JSONContent | undefined) => {
      if (!node) return;
      if (node.type === "taskItem" && !node.attrs?.checked) {
        tasks.push({
          noteId: note.id,
          noteTitle: note.title || "未命名记录",
          text: nodePlainText(node).trim(),
          updatedAt: note.updatedAt
        });
      }
      node.content?.forEach(walk);
    };
    walk(note.content);
  }
  return tasks;
}
