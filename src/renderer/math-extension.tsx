import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import katex from "katex";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stopMathPanelMouseDown({ event }: { event: Event }) {
  return event.type === "mousedown" && event.target instanceof Element && Boolean(event.target.closest(".math-edit-panel"));
}

export function renderLatex(latex: string, displayMode: boolean) {
  try {
    return {
      html: katex.renderToString(latex, { displayMode, throwOnError: true, output: "htmlAndMathml" }),
      error: ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/i, "") : "公式语法错误";
    return {
      html: katex.renderToString(latex, { displayMode, throwOnError: false, output: "htmlAndMathml", errorColor: "#c2413b" }),
      error: message || escapeHtml(latex)
    };
  }
}

function MathView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const isBlock = node.type.name === "mathBlock";
  const latex = String(node.attrs.latex ?? "");
  const editOnCreate = Boolean(node.attrs.editOnCreate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const rendered = useMemo(() => renderLatex(latex, isBlock), [latex, isBlock]);
  const draftRendered = useMemo(() => renderLatex(draft, isBlock), [draft, isBlock]);

  useEffect(() => {
    if (editOnCreate && !editing) setEditing(true);
  }, [editOnCreate, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const startEdit = useCallback(() => {
    setDraft(latex);
    setEditing(true);
  }, [latex]);

  const commit = useCallback(() => {
    setEditing(false);
    const next = draft;
    if (!next.trim()) {
      deleteNode();
      return;
    }
    updateAttributes({ latex: next, editOnCreate: false });
  }, [draft, latex, updateAttributes, deleteNode]);

  const cancel = useCallback(() => {
    if (editOnCreate && !latex.trim()) {
      deleteNode();
      return;
    }
    setEditing(false);
    setDraft(latex);
    if (editOnCreate) updateAttributes({ editOnCreate: false });
  }, [editOnCreate, latex, updateAttributes, deleteNode]);

  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={`math-node math-${isBlock ? "block" : "inline"}${selected ? " is-selected" : ""}${rendered.error ? " is-invalid" : ""}`}
      contentEditable={false}
      aria-label={rendered.error ? `公式语法错误：${rendered.error}` : "数学公式"}
      title={rendered.error || undefined}
      onClick={(event: MouseEvent) => {
        if (editing) return;
        event.preventDefault();
        event.stopPropagation();
        startEdit();
      }}
    >
      {editing ? (
        <span
          className="math-edit-panel"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="math-edit-header">
            <span>LaTeX 源码</span>
            <span className="math-edit-actions">
              <span className="math-edit-hint">{isBlock ? "Ctrl/⌘ + Enter 保存 · Esc 取消" : "Enter 保存 · Esc 取消"}</span>
              <button type="button" className="math-edit-save" onClick={commit}>保存</button>
            </span>
          </span>
          <textarea
            ref={textareaRef}
            className="math-editor"
            value={draft}
            rows={isBlock ? 3 : 1}
            placeholder="输入公式，例如：E = mc^2"
            aria-label="LaTeX 公式源码"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              } else if (event.key === "Enter" && (isBlock ? event.metaKey || event.ctrlKey : true)) {
                event.preventDefault();
                commit();
              }
            }}
          />
          <span className="math-live-preview" aria-label="公式预览">
            {draft.trim() ? <span dangerouslySetInnerHTML={{ __html: draftRendered.html }} /> : <span className="math-preview-empty">输入源码后实时预览</span>}
          </span>
          {draftRendered.error ? <span className="math-error" role="alert">{draftRendered.error}</span> : null}
        </span>
      ) : (
        <span className="math-render" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      )}
    </NodeViewWrapper>
  );
}

const latexAttribute = {
  default: "",
  parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? element.textContent ?? "",
  renderHTML: (attributes: { latex?: string }) => ({ "data-latex": String(attributes.latex ?? "") })
};

const editOnCreateAttribute = {
  default: false,
  parseHTML: () => false,
  renderHTML: () => ({})
};

const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { latex: latexAttribute, editOnCreate: editOnCreateAttribute };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "math-inline" }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { stopEvent: stopMathPanelMouseDown });
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(^|[^$])\$([^$\n]+)\$$/,
        handler: ({ chain, range, match }) => {
          const latex = match[2];
          if (!latex || !latex.trim()) return null;
          const from = range.from + match[1].length;
          chain()
            .deleteRange({ from, to: range.to })
            .insertContentAt(from, { type: "mathInline", attrs: { latex } })
            .setTextSelection(from + 1)
            .run();
        }
      })
    ];
  }
});

const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  defining: true,
  addAttributes() {
    return { latex: latexAttribute, editOnCreate: editOnCreateAttribute };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "math-block" }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { stopEvent: stopMathPanelMouseDown });
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([\s\S]+?)\$\$$/,
        handler: ({ chain, state, range, match }) => {
          const latex = match[1];
          if (!latex || !latex.trim()) return null;
          const $from = state.doc.resolve(range.from);
          const paraStart = $from.before($from.depth);
          const paraEnd = paraStart + $from.parent.nodeSize;
          chain()
            .deleteRange({ from: paraStart, to: paraEnd })
            .insertContentAt(paraStart, { type: "mathBlock", attrs: { latex } })
            .setTextSelection(paraStart + 1)
            .run();
        }
      })
    ];
  }
});

export const MathExtensions = [MathBlock, MathInline];
