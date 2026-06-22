import { buildHtmlExport } from "./html-export.js";
import { toMarkdown } from "../shared/markdown.js";
import type { BackupEntry, ExportPayload, NoteRecord, NotesBackup } from "../shared/types.js";

export function safeExportName(name: string, ext: string) {
  const base = (name || "未命名记录")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "未命名记录"}.${ext}`;
}

export function safeExportBaseName(name: string) {
  return safeExportName(name, "tmp").replace(/\.tmp$/, "");
}

export function defaultEncryptedBatchExportName() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `suiji-export-${stamp}.suiji-export`;
}

export function defaultBackupName(encrypted = false) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `suiji-backup-${stamp}.${encrypted ? "suiji-backup" : "json"}`;
}

export function buildExportText(note: NoteRecord, format: Exclude<ExportPayload["format"], "pdf">) {
  return format === "html"
    ? buildHtmlExport(note)
    : format === "json"
      ? JSON.stringify(note, null, 2)
      : format === "md"
        ? buildMarkdownExport(note)
        : buildTextExport(note);
}

export function plainDoc(text: string): NoteRecord["content"] {
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
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCellNode(type: "tableHeader" | "tableCell", text: string) {
  return {
    type,
    content: text ? [{ type: "text", text }] : undefined
  };
}

function markdownTableToDocRows(lines: string[]) {
  const rows = lines.map(splitMarkdownTableRow).filter((cells) => cells.length > 0);
  if (rows.length < 2 || !isMarkdownTableSeparator(lines[1] || "")) return null;
  const header = rows[0];
  const body = rows.slice(2);
  return [
    {
      type: "tableRow",
      content: header.map((cell) => tableCellNode("tableHeader", cell))
    },
    ...body.map((cells) => ({
      type: "tableRow",
      content: cells.map((cell) => tableCellNode("tableCell", cell))
    }))
  ];
}

export function markdownToDoc(markdown: string): NoteRecord["content"] {
  const lines = markdown.split(/\r?\n/);
  const blocks: NonNullable<NoteRecord["content"]["content"]> = [];
  let pendingParagraph: string[] = [];
  let tableLines: string[] = [];

  const flushParagraph = () => {
    if (pendingParagraph.length === 0) return;
    const text = pendingParagraph.join(" ").trim();
    blocks.push({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : undefined
    });
    pendingParagraph = [];
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    const rows = markdownTableToDocRows(tableLines);
    if (rows) {
      flushParagraph();
      blocks.push({
        type: "table",
        content: rows
      });
    } else {
      pendingParagraph.push(...tableLines);
    }
    tableLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushTable();
      flushParagraph();
      continue;
    }

    if (line.includes("|")) {
      tableLines.push(line);
      continue;
    }
    flushTable();

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

  flushTable();
  flushParagraph();
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

export function parseBackupNotes(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as Partial<NotesBackup>).notes)) {
    return (raw as Partial<NotesBackup>).notes ?? [];
  }
  throw new Error("Invalid backup file");
}

export function parseBackupEntryName(fileName: string, id: string, size: number, fallbackDate: Date): BackupEntry | null {
  if (!fileName.endsWith(`-${id}.json`)) return null;
  const match = fileName.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9-]{36}\.json$/i);
  return {
    fileName,
    prefix: match?.[1] ?? "backup",
    createdAt: match?.[2]?.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") ?? fallbackDate.toISOString(),
    size
  };
}

export function buildMarkdownExport(note: NoteRecord) {
  const title = (note.title || "未命名记录").trim() || "未命名记录";
  const body = toMarkdown(note.content).trim();
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
}

export function buildTextExport(note: NoteRecord) {
  const title = (note.title || "未命名记录").trim() || "未命名记录";
  const body = note.plainText.trim();
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}
