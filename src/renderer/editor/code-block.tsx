import { useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";

// lowlight common 里使用频率最高的语言；空值表示自动检测
const CODE_LANGUAGES: Array<[string, string]> = [
  ["", "自动"],
  ["plaintext", "纯文本"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["java", "Java"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["php", "PHP"],
  ["ruby", "Ruby"],
  ["sql", "SQL"],
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["bash", "Bash"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["xml", "XML"],
  ["markdown", "Markdown"]
];

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = typeof node.attrs.language === "string" ? node.attrs.language : "";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时不打断编辑
    }
  }

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-header" contentEditable={false}>
        <select
          className="code-block-language"
          value={language}
          aria-label="代码语言"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ language: event.target.value || null })}
        >
          {CODE_LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="code-block-copy" aria-label="复制代码" onClick={copyCode}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <NodeViewContent as="pre" />
    </NodeViewWrapper>
  );
}

export const CodeBlockExtension = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, {
      // 工具头里的事件（尤其是 select 的 mousedown）必须拦下，
      // 否则 ProseMirror 抢焦点，原生下拉一打开就被关掉
      stopEvent: ({ event }) =>
        event.target instanceof Element && Boolean(event.target.closest(".code-block-header"))
    });
  }
});
