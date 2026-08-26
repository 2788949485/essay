import type { JSONContent } from "@tiptap/react";

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`");
}

function escapeImageAlt(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function indentBlock(text: string, depth: number) {
  const indent = "  ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");
}

function renderImage(node: JSONContent) {
  const src = String(node.attrs?.src ?? "").trim();
  if (!src) return "";

  const alt = escapeImageAlt(String(node.attrs?.alt ?? ""));
  const title = String(node.attrs?.title ?? "").trim();
  const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  return `![${alt}](${src}${titlePart})`;
}

function applyMarks(text: string, marks: JSONContent["marks"]) {
  if (!marks?.length) return escapeText(text);

  return marks.reduce((current, mark) => {
    if (mark.type === "bold") return `**${current}**`;
    if (mark.type === "italic") return `*${current}*`;
    if (mark.type === "strike") return `~~${current}~~`;
    if (mark.type === "code") return `\`${text.replace(/`/g, "\\`")}\``;
    if (mark.type === "link") return `[${current}](${String(mark.attrs?.href ?? "")})`;
    return current;
  }, escapeText(text));
}

function renderInline(node: JSONContent): string {
  if (node.type === "text") {
    return applyMarks(node.text ?? "", node.marks);
  }

  if (node.type === "hardBreak") {
    return "  \n";
  }

  if (node.type === "mathInline") {
    return `$${String(node.attrs?.latex ?? "")}$`;
  }

  if (node.type === "image") {
    return renderImage(node);
  }

  return (node.content ?? []).map(renderInline).join("");
}

function renderListItems(items: JSONContent[] = [], ordered = false, depth = 0): string {
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      return renderListItem(item, marker, depth);
    })
    .join("\n");
}

function renderListItem(node: JSONContent, marker: string, depth: number): string {
  const indent = "  ".repeat(depth);
  const children = node.content ?? [];
  const firstBlock = children[0];
  const firstText = firstBlock ? renderInline(firstBlock).trim() : "";
  const nested = children
    .slice(1)
    .map((child) => renderBlock(child, depth + 1))
    .filter(Boolean)
    .join("\n");

  return `${indent}${marker} ${firstText}${nested ? `\n${nested}` : ""}`;
}

function renderTaskItems(items: JSONContent[] = [], depth = 0): string {
  return items
    .map((item) => {
      const checked = item.attrs?.checked ? "x" : " ";
      return renderListItem(item, `- [${checked}]`, depth);
    })
    .join("\n");
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, "<br>").trim();
}

function renderTableCell(node: JSONContent) {
  return escapeTableCell(renderInline(node).trim());
}

function renderTable(node: JSONContent) {
  const rows = node.content ?? [];
  if (!rows.length) return "";

  const cells = rows.map((row) => (row.content ?? []).map(renderTableCell));
  const columnCount = Math.max(...cells.map((row) => row.length), 1);
  const normalizeRow = (row: string[]) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
  const header = normalizeRow(cells[0]);
  const body = cells.slice(1).map(normalizeRow);
  const separator = Array.from({ length: columnCount }, () => "---");

  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function renderCollapsibleBlock(node: JSONContent, depth = 0): string {
  const title = escapeText(String(node.attrs?.title ?? "").trim() || "空折叠块");
  const indent = "  ".repeat(depth);
  const nested = (node.content ?? [])
    .map((child) => {
      if (child.type === "collapsibleBlock") {
        return renderCollapsibleBlock(child, depth + 1);
      }

      const rendered = renderBlock(child, 0).trim();
      return rendered ? indentBlock(rendered, depth + 1) : "";
    })
    .filter(Boolean)
    .join("\n");

  return `${indent}- ${title}${nested ? `\n${nested}` : ""}`;
}

function renderBlock(node: JSONContent, depth = 0): string {
  const children = node.content ?? [];

  switch (node.type) {
    case "doc":
      return children
        .map((child) => renderBlock(child, depth))
        .filter(Boolean)
        .join("\n\n");
    case "paragraph":
      return renderInline(node).trim();
    case "image":
      return renderImage(node);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${renderInline(node).trim()}`;
    }
    case "bulletList":
      return renderListItems(children, false, depth);
    case "orderedList":
      return renderListItems(children, true, depth);
    case "listItem":
      return renderListItem(node, "-", depth);
    case "taskList":
      return renderTaskItems(children, depth);
    case "taskItem": {
      const checked = node.attrs?.checked ? "x" : " ";
      return renderListItem(node, `- [${checked}]`, depth);
    }
    case "table":
      return renderTable(node);
    case "blockquote":
      return children
        .map((child) => renderBlock(child, depth))
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "collapsibleBlock":
      return renderCollapsibleBlock(node, depth);
    case "mathBlock":
      return `$$${String(node.attrs?.latex ?? "")}$$`;
    case "codeBlock":
      return `\`\`\`\n${node.content?.map((child) => child.text ?? "").join("") ?? ""}\n\`\`\``;
    case "horizontalRule":
      return "---";
    default:
      return children
        .map((child) => renderBlock(child, depth))
        .filter(Boolean)
        .join("\n\n");
  }
}

export function toMarkdown(content: JSONContent) {
  return `${renderBlock(content).trim()}\n`;
}
