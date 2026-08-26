import { useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
  const currentLabel = CODE_LANGUAGES.find(([value]) => value === language)?.[1] ?? "自动";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时不打断编辑
    }
  }

  function pickLanguage(value: string) {
    setMenuOpen(false);
    updateAttributes({ language: value || null });
  }

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-header" contentEditable={false}>
        <div className="code-block-language-wrap">
          <button
            type="button"
            className={menuOpen ? "code-block-language is-open" : "code-block-language"}
            aria-label="代码语言"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            {currentLabel}
            <ChevronDown size={12} />
          </button>
          {menuOpen ? (
            <>
              <div
                className="code-block-language-backdrop"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                }}
              />
              <div className="code-block-language-menu" role="listbox" aria-label="选择代码语言">
                {CODE_LANGUAGES.map(([value, label]) => (
                  <button
                    key={value || "auto"}
                    type="button"
                    role="option"
                    aria-selected={value === language}
                    className={value === language ? "is-active" : ""}
                    onClick={() => pickLanguage(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
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
      // 工具头里的事件必须拦下，否则 ProseMirror 抢焦点，菜单一打开就被关掉
      stopEvent: ({ event }) =>
        event.target instanceof Element && Boolean(event.target.closest(".code-block-header"))
    });
  }
});
