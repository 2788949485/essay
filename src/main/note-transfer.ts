import { buildHtmlExport } from "./html-export.js";
import type { JSONContent } from "@tiptap/react";
import MarkdownIt from "markdown-it";
import { toMarkdown } from "../shared/markdown.js";
import { splitInlineMath } from "../shared/math-patterns.js";
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

type MarkdownToken = {
  type: string;
  tag: string;
  content: string;
  info: string;
  markup: string;
  attrs?: Array<[string, string]> | null;
  children?: MarkdownToken[] | null;
  attrGet?: (name: string) => string | null;
};

const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
});

function tokenAttr(token: MarkdownToken, name: string) {
  return token.attrGet?.(name) ?? token.attrs?.find(([key]) => key === name)?.[1] ?? null;
}

function cloneMarks(marks: JSONContent["marks"]) {
  return marks?.length ? marks.map((mark) => ({ ...mark, attrs: mark.attrs ? { ...mark.attrs } : undefined })) : undefined;
}

function pushTextNode(target: JSONContent[], text: string, marks: JSONContent["marks"]) {
  if (!text) return;
  target.push({
    type: "text",
    text,
    marks: cloneMarks(marks)
  });
}

function parseInlineTokens(tokens: MarkdownToken[] = []) {
  const nodes: JSONContent[] = [];
  const marks: NonNullable<JSONContent["marks"]> = [];
  let autoLink = false;

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const match = autoLink ? token.content.match(/^(.+?)(www\..+)$/i) : null;
        if (match) {
          pushTextNode(nodes, match[1], marks.slice(0, -1));
          marks[marks.length - 1].attrs = { href: `http://${match[2]}` };
          pushTextNode(nodes, match[2], marks);
          break;
        }
        for (const seg of splitInlineMath(token.content)) {
          if (seg.type === "math") {
            nodes.push({ type: "mathInline", attrs: { latex: seg.latex } });
          } else {
            pushTextNode(nodes, seg.text, marks);
          }
        }
        break;
      }
      case "softbreak":
      case "hardbreak":
        nodes.push({ type: "hardBreak" });
        break;
      case "code_inline":
        pushTextNode(nodes, token.content, [...marks, { type: "code" }]);
        break;
      case "strong_open":
        marks.push({ type: "bold" });
        break;
      case "strong_close":
        marks.pop();
        break;
      case "em_open":
        marks.push({ type: "italic" });
        break;
      case "em_close":
        marks.pop();
        break;
      case "s_open":
        marks.push({ type: "strike" });
        break;
      case "s_close":
        marks.pop();
        break;
      case "link_open":
        autoLink = token.markup === "linkify";
        marks.push({
          type: "link",
          attrs: { href: tokenAttr(token, "href") ?? "" }
        });
        break;
      case "link_close":
        marks.pop();
        autoLink = false;
        break;
      case "image":
        nodes.push({
          type: "image",
          attrs: {
            src: tokenAttr(token, "src") ?? "",
            alt: token.content || tokenAttr(token, "alt") || "",
            title: tokenAttr(token, "title") ?? ""
          }
        });
        break;
      default:
        break;
    }
  }

  return nodes;
}

function filterInlineCellContent(nodes: JSONContent[]) {
  return nodes.filter((node) => node.type !== "image");
}

function paragraphBlocksFromInline(tokens: MarkdownToken[] = []) {
  const inlineNodes = parseInlineTokens(tokens);
  const blocks: JSONContent[] = [];
  let paragraphContent: JSONContent[] = [];

  const flushParagraph = () => {
    if (!paragraphContent.length) return;
    blocks.push({
      type: "paragraph",
      content: paragraphContent
    });
    paragraphContent = [];
  };

  for (const node of inlineNodes) {
    if (node.type === "image") {
      flushParagraph();
      blocks.push(node);
      continue;
    }
    paragraphContent.push(node);
  }

  flushParagraph();
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

function consumeTaskMarker(paragraph: JSONContent) {
  const firstTextNode = paragraph.content?.find((node) => node.type === "text" && typeof node.text === "string");
  if (!firstTextNode?.text) return null;
  const match = firstTextNode.text.match(/^\[([ xX])\]\s+/);
  if (!match) return null;
  firstTextNode.text = firstTextNode.text.slice(match[0].length);
  if (!firstTextNode.text) {
    paragraph.content = paragraph.content?.filter((node) => node !== firstTextNode);
  }
  return { checked: match[1].toLowerCase() === "x" };
}

function parseTable(tokens: MarkdownToken[], startIndex: number) {
  const rows: JSONContent[] = [];
  let index = startIndex + 1;
  let currentRow: JSONContent | null = null;
  let currentCellType: "tableHeader" | "tableCell" | null = null;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === "table_close") {
      return {
        node: {
          type: "table",
          content: rows
        },
        nextIndex: index + 1
      };
    }

    if (token.type === "tr_open") {
      currentRow = { type: "tableRow", content: [] };
      index += 1;
      continue;
    }

    if (token.type === "tr_close") {
      if (currentRow) rows.push(currentRow);
      currentRow = null;
      index += 1;
      continue;
    }

    if (token.type === "th_open" || token.type === "td_open") {
      currentCellType = token.type === "th_open" ? "tableHeader" : "tableCell";
      index += 1;
      continue;
    }

    if ((token.type === "th_close" || token.type === "td_close") && currentCellType) {
      currentCellType = null;
      index += 1;
      continue;
    }

    if (token.type === "inline" && currentRow && currentCellType) {
      currentRow.content = currentRow.content ?? [];
      currentRow.content.push({
        type: currentCellType,
        content: filterInlineCellContent(parseInlineTokens(token.children ?? []))
      });
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    node: {
      type: "table",
      content: rows
    },
    nextIndex: index
  };
}

function parseBlocks(tokens: MarkdownToken[], startIndex = 0, stopType?: string): { nodes: JSONContent[]; nextIndex: number } {
  const nodes: JSONContent[] = [];
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (stopType && token.type === stopType) {
      return { nodes, nextIndex: index + 1 };
    }

    switch (token.type) {
      case "heading_open": {
        const level = Number(token.tag.replace(/^h/, "")) || 1;
        const inline = tokens[index + 1];
        nodes.push({
          type: "heading",
          attrs: { level },
          content: inline?.type === "inline" ? parseInlineTokens(inline.children ?? []) : undefined
        });
        index += 3;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[index + 1];
        const children = inline?.type === "inline" ? inline.children ?? [] : [];
        const fullText = children
          .map((t) => (t.type === "softbreak" || t.type === "hardbreak" ? "\n" : t.content ?? ""))
          .join("");
        const blockMatch = fullText.match(/^\s*\$\$([\s\S]+?)\$\$\s*$/);
        if (blockMatch) {
          nodes.push({ type: "mathBlock", attrs: { latex: blockMatch[1].trim() } });
          index += 3;
          break;
        }
        nodes.push(...paragraphBlocksFromInline(children));
        index += 3;
        break;
      }
      case "blockquote_open": {
        const result = parseBlocks(tokens, index + 1, "blockquote_close");
        nodes.push({
          type: "blockquote",
          content: result.nodes
        });
        index = result.nextIndex;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const listItems: JSONContent[] = [];
        const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
        const orderedStart = Number(tokenAttr(token, "start") ?? 1) || 1;
        index += 1;
        while (index < tokens.length && tokens[index].type !== closeType) {
          if (tokens[index].type !== "list_item_open") {
            index += 1;
            continue;
          }
          const itemResult = parseBlocks(tokens, index + 1, "list_item_close");
          listItems.push({
            type: "listItem",
            content: itemResult.nodes
          });
          index = itemResult.nextIndex;
        }
        index += 1;

        if (token.type === "bullet_list_open") {
          const taskItems = listItems.map((item) => {
            const firstParagraph = item.content?.find((node) => node.type === "paragraph");
            const marker = firstParagraph ? consumeTaskMarker(firstParagraph) : null;
            return marker
              ? {
                  type: "taskItem",
                  attrs: { checked: marker.checked },
                  content: item.content
                }
              : null;
          });

          if (taskItems.every(Boolean) && taskItems.length) {
            nodes.push({
              type: "taskList",
              content: taskItems as JSONContent[]
            });
            break;
          }
        }

        nodes.push(
          token.type === "ordered_list_open"
            ? {
                type: "orderedList",
                attrs: { start: orderedStart },
                content: listItems
              }
            : {
                type: "bulletList",
                content: listItems
              }
        );
        break;
      }
      case "fence":
      case "code_block":
        nodes.push({
          type: "codeBlock",
          content: token.content ? [{ type: "text", text: token.content.replace(/\n$/, "") }] : undefined
        });
        index += 1;
        break;
      case "hr":
        nodes.push({ type: "horizontalRule" });
        index += 1;
        break;
      case "table_open": {
        const result = parseTable(tokens, index);
        nodes.push(result.node);
        index = result.nextIndex;
        break;
      }
      default:
        index += 1;
        break;
    }
  }

  return { nodes, nextIndex: index };
}

export function markdownToDoc(markdown: string): NoteRecord["content"] {
  const tokens = markdownParser.parse(markdown, {}) as MarkdownToken[];
  const content = parseBlocks(tokens).nodes;
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }]
  };
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
