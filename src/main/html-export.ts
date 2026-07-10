import fs from "node:fs";
import path from "node:path";
import katex from "katex";
import type { NoteRecord } from "../shared/types.js";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function katexHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

let katexCssCache: string | null = null;
function getKatexCss(): string {
  if (katexCssCache !== null) return katexCssCache;
  try {
    const pkgPath = require.resolve("katex/package.json");
    const cssPath = path.join(path.dirname(pkgPath), "dist", "katex.min.css");
    katexCssCache = fs.readFileSync(cssPath, "utf8").replace(/url\([^)]*\)/g, "url()");
  } catch {
    katexCssCache = "";
  }
  return katexCssCache;
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

type JsonNode = NoteRecord["content"];

function validateExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeHtmlUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  return validateExternalUrl(raw) ?? "";
}

function renderInlineHtml(node: JsonNode): string {
  if (node.type === "text") {
    const text = escapeHtml(node.text ?? "");
    return (node.marks ?? []).reduce((current, mark) => {
      if (mark.type === "bold") return `<strong>${current}</strong>`;
      if (mark.type === "italic") return `<em>${current}</em>`;
      if (mark.type === "strike") return `<s>${current}</s>`;
      if (mark.type === "underline") return `<u>${current}</u>`;
      if (mark.type === "code") return `<code>${current}</code>`;
      if (mark.type === "highlight") return `<mark>${current}</mark>`;
      if (mark.type === "link") {
        const href = safeHtmlUrl(mark.attrs?.href);
        return href ? `<a href="${escapeHtmlAttribute(href)}" rel="noreferrer">${current}</a>` : current;
      }
      return current;
    }, text);
  }

  if (node.type === "hardBreak") return "<br>";
  if (node.type === "mathInline") return katexHtml(String(node.attrs?.latex ?? ""), false);
  if (node.type === "image") return renderBlockHtml(node);
  return (node.content ?? []).map(renderInlineHtml).join("");
}

function renderListItemHtml(node: JsonNode): string {
  const children = node.content ?? [];
  const body = children.map(renderBlockHtml).join("");
  return `<li>${body || "<p></p>"}</li>`;
}

function renderTaskItemHtml(node: JsonNode): string {
  const checked = node.attrs?.checked ? " checked" : "";
  const children = node.content ?? [];
  return `<li><label><input type="checkbox"${checked} disabled></label><div>${children.map(renderBlockHtml).join("") || "<p></p>"}</div></li>`;
}

function renderTableCellHtml(node: JsonNode) {
  const tag = node.type === "tableHeader" ? "th" : "td";
  const align = typeof node.attrs?.colspan === "number" && node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : "";
  const rowspan = typeof node.attrs?.rowspan === "number" && node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : "";
  return `<${tag}${align}${rowspan}>${(node.content ?? []).map(renderBlockHtml).join("") || "<p></p>"}</${tag}>`;
}

function renderTableHtml(node: JsonNode) {
  const rows = node.content ?? [];
  return `<table><tbody>${rows
    .map((row) => `<tr>${(row.content ?? []).map(renderTableCellHtml).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderBlockHtml(node: JsonNode): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return `<p>${children.map(renderInlineHtml).join("") || "<br>"}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 4);
      return `<h${level}>${children.map(renderInlineHtml).join("")}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children.map(renderListItemHtml).join("")}</ul>`;
    case "orderedList": {
      const start = Number(node.attrs?.start) > 1 ? ` start="${Number(node.attrs?.start)}"` : "";
      return `<ol${start}>${children.map(renderListItemHtml).join("")}</ol>`;
    }
    case "listItem":
      return renderListItemHtml(node);
    case "taskList":
      return `<ul data-type="taskList">${children.map(renderTaskItemHtml).join("")}</ul>`;
    case "taskItem":
      return renderTaskItemHtml(node);
    case "blockquote":
      return `<blockquote>${children.map(renderBlockHtml).join("")}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(node.textContent || children.map(renderInlineHtml).join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const src = safeHtmlUrl(node.attrs?.src);
      if (!src) return "";
      const alt = escapeHtmlAttribute(typeof node.attrs?.alt === "string" ? node.attrs.alt : "");
      return `<img src="${escapeHtmlAttribute(src)}" alt="${alt}">`;
    }
    case "table":
      return renderTableHtml(node);
    case "tableRow":
      return `<tr>${children.map(renderTableCellHtml).join("")}</tr>`;
    case "tableHeader":
    case "tableCell":
      return renderTableCellHtml(node);
    case "collapsibleBlock": {
      const title = escapeHtml(typeof node.attrs?.title === "string" ? node.attrs.title : "折叠块");
      const open = node.attrs?.open ? " open" : "";
      return `<details data-type="collapsible-block"${open}><summary>${title}</summary><div>${children.map(renderBlockHtml).join("") || "<p></p>"}</div></details>`;
    }
    case "mathBlock":
      return `<div class="math-block">${katexHtml(String(node.attrs?.latex ?? ""), true)}</div>`;
    default:
      return children.map(renderBlockHtml).join("");
  }
}

function formatExportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function buildHtmlExport(note: NoteRecord) {
  const title = escapeHtml(note.title || "未命名记录");
  const createdAt = formatExportDate(note.createdAt);
  const updatedAt = formatExportDate(note.updatedAt);
  const plainText = note.plainText.trim();
  const wordCount = plainText ? Array.from(plainText.replace(/\s+/g, "")).length : 0;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    ${getKatexCss()}
    .math-block { text-align: center; margin: 1em 0; }
    @page {
      size: A4;
      margin: 18mm 16mm 20mm;
    }

    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --paper: #fffdf8;
      --ink: #28251f;
      --muted: #777064;
      --line: #ded2bd;
      --accent: #2f6b57;
      --accent-soft: #e5f0ea;
      --code-bg: #26302c;
      --code-ink: #f8f1e6;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      line-height: 1.75;
    }

    .page {
      width: min(920px, calc(100% - 32px));
      margin: 32px auto;
      padding: 42px 48px 56px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 16px 42px rgba(74, 61, 39, 0.12);
    }

    header {
      padding-bottom: 24px;
      margin-bottom: 28px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0 0 14px;
      font-size: clamp(30px, 5vw, 44px);
      line-height: 1.2;
      letter-spacing: 0;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      color: var(--muted);
      font-size: 13px;
    }

    .meta span {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 1px 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #faf6ed;
    }

    main {
      font-size: 16px;
    }

    main > *:first-child {
      margin-top: 0;
    }

    main > *:last-child {
      margin-bottom: 0;
    }

    h2, h3, h4 {
      margin: 1.6em 0 0.65em;
      line-height: 1.3;
    }

    h2 {
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      font-size: 26px;
    }

    h3 {
      font-size: 21px;
    }

    p {
      margin: 0.85em 0;
    }

    a {
      color: #1b6fba;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 18px auto;
      border-radius: 8px;
      border: 1px solid var(--line);
    }

    blockquote {
      margin: 20px 0;
      padding: 12px 18px;
      border-left: 4px solid #2f6b5b;
      background: #eef5f3;
      color: #47515a;
    }

    details[data-type="collapsible-block"] {
      margin: 20px 0;
      padding-left: 18px;
      border-left: 2px solid #d7dde5;
    }

    details[data-type="collapsible-block"] > summary {
      cursor: default;
      font-weight: 650;
      margin-bottom: 10px;
    }

    details[data-type="collapsible-block"] > div > *:first-child {
      margin-top: 0;
    }

    table {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th, td {
      border: 1px solid var(--line);
      padding: 9px 11px;
      vertical-align: top;
    }

    th {
      background: #edf3f6;
      font-weight: 700;
    }

    td {
      background: #ffffff;
    }

    th > *, td > * {
      margin-bottom: 0;
    }

    ul, ol {
      padding-left: 26px;
    }

    li + li {
      margin-top: 4px;
    }

    ul[data-type="taskList"] {
      padding-left: 0;
      list-style: none;
    }

    ul[data-type="taskList"] li {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }

    ul[data-type="taskList"] label {
      padding-top: 2px;
    }

    ul[data-type="taskList"] div > *:first-child {
      margin-top: 0;
    }

    code {
      padding: 2px 5px;
      border-radius: 4px;
      background: #edf2f5;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.92em;
    }

    pre {
      overflow-x: auto;
      margin: 18px 0;
      padding: 16px 18px;
      border-radius: 8px;
      background: var(--code-bg);
      color: var(--code-ink);
    }

    pre code {
      padding: 0;
      background: transparent;
      color: inherit;
    }

    mark {
      border-radius: 4px;
      background: #ffe08a;
      padding: 0 3px;
    }

    hr {
      height: 1px;
      margin: 28px 0;
      border: 0;
      background: var(--line);
    }

    footer {
      margin-top: 40px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    @media print {
      body {
        background: #fff;
      }

      .page {
        width: auto;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: #fff;
      }

      header {
        margin-bottom: 10mm;
        padding-bottom: 6mm;
      }

      footer {
        margin-top: 14mm;
        padding-top: 5mm;
      }
    }

    @media (max-width: 640px) {
      .page {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 28px 20px 40px;
        border: 0;
        border-radius: 0;
      }
    }
  </style>
</head>
<body>
  <article class="page">
    <header>
      <h1>${title}</h1>
      <div class="meta">
        ${createdAt ? `<span>创建：${escapeHtml(createdAt)}</span>` : ""}
        ${updatedAt ? `<span>更新：${escapeHtml(updatedAt)}</span>` : ""}
        <span>字数：${wordCount}</span>
        <span>由随记导出</span>
      </div>
    </header>
    <main>
      ${renderBlockHtml(note.content) || "<p></p>"}
    </main>
    <footer>
      Copyright (c) 2026 Suiji. Exported from 随记.
    </footer>
  </article>
</body>
</html>`;
}
