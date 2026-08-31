import { useState } from "react";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { ChevronDown, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";

/** 新建折叠块的 JSON 结构：标题与内容区都是文档内的真实节点 */
function collapsibleBlockJson(open: boolean) {
  return {
    type: "collapsibleBlock",
    attrs: { open },
    content: [{ type: "collapsibleTitle" }, { type: "collapsibleBody" }]
  };
}

/** 选区在折叠块标题内时，返回所属块的位置信息 */
function findTitleContext(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "collapsibleTitle" || $from.depth < 2) return null;
  const blockDepth = $from.depth - 1;
  const block = $from.node(blockDepth);
  if (block.type.name !== "collapsibleBlock") return null;
  return { block, blockPos: $from.before(blockDepth), offset: $from.parentOffset };
}

function CollapsibleBlockView({ editor, getPos, node, selected, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;
  const [menuOpen, setMenuOpen] = useState(false);

  function deleteBlock() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    setMenuOpen(false);
    // 删掉文档里唯一的块会留下非法的空 doc，换成空段落
    if (pos === 0 && editor.state.doc.childCount === 1) {
      editor
        .chain()
        .focus()
        .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph" })
        .run();
      return;
    }
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  }

  return (
    <NodeViewWrapper
      className={selected ? "collapsible-block is-selected" : "collapsible-block"}
      data-open={open ? "true" : "false"}
    >
      <div className="collapsible-block-chrome" contentEditable={false}>
        <span
          className="collapsible-block-drag"
          data-drag-handle
          draggable
          role="button"
          title="拖动排序"
          aria-label="拖动排序"
        >
          <GripVertical size={14} />
        </span>
        <button
          type="button"
          className={open ? "collapsible-block-toggle is-open" : "collapsible-block-toggle"}
          title={open ? "收起折叠块" : "展开折叠块"}
          aria-label={open ? "收起折叠块" : "展开折叠块"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => updateAttributes({ open: !open })}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="collapsible-block-menu-wrap" contentEditable={false}>
        <button
          type="button"
          className={menuOpen ? "collapsible-block-menu-trigger is-open" : "collapsible-block-menu-trigger"}
          aria-label="折叠块操作"
          title="折叠块操作"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen ? (
          <>
            <div
              className="collapsible-block-menu-backdrop"
              onMouseDown={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div className="collapsible-block-menu" onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="collapsible-block-menu-delete" onClick={deleteBlock}>
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </>
        ) : null}
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

function CollapsibleTitleView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className={node.childCount === 0 ? "collapsible-block-title-wrap is-empty" : "collapsible-block-title-wrap"}>
      <NodeViewContent className="collapsible-block-title" />
    </NodeViewWrapper>
  );
}

function CollapsibleBodyView({ editor, getPos, node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="collapsible-block-body">
      <NodeViewContent className="collapsible-block-content" />
      {node.childCount === 0 ? (
        <button
          type="button"
          className="collapsible-block-insert"
          contentEditable={false}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            const pos = typeof getPos === "function" ? getPos() : null;
            if (typeof pos !== "number") return;
            editor.chain().focus().insertContentAt(pos + 1, { type: "paragraph" }).run();
          }}
        >
          点击添加内容
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

const collapsibleSelectionGuardKey = new PluginKey("collapsibleSelectionGuard");

export const CollapsibleBlockExtension = TiptapNode.create({
  name: "collapsibleBlock",
  group: "block",
  content: "collapsibleTitle collapsibleBody",
  draggable: true,
  selectable: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => ({ "data-open": attributes.open === false ? "false" : "true" })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'details[data-type="collapsible-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const isOpen = HTMLAttributes["data-open"] !== "false";
    return [
      "details",
      mergeAttributes(HTMLAttributes, { "data-type": "collapsible-block" }, isOpen ? { open: "open" } : {}),
      0
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlockView);
  },
  addKeyboardShortcuts() {
    return {
      // 标题上 Enter：展开 → 进内容区；收起 → 块后新建同级折叠块（对齐 TipTap Details）
      Enter: () => {
        const context = findTitleContext(this.editor.state);
        if (!context) return false;
        const { block, blockPos } = context;
        const titleSize = block.firstChild?.nodeSize ?? 0;

        if (block.attrs.open !== false) {
          const insertPos = blockPos + 1 + titleSize + 1;
          this.editor.chain().focus().insertContentAt(insertPos, { type: "paragraph" }).run();
          return true;
        }

        const siblingPos = blockPos + block.nodeSize;
        this.editor
          .chain()
          .focus()
          .insertContentAt(siblingPos, collapsibleBlockJson(false))
          .setTextSelection(siblingPos + 2)
          .run();
        return true;
      },
      // 空标题行首 Backspace → 解除折叠：内容区子块原地保留，标题消失
      Backspace: () => {
        const context = findTitleContext(this.editor.state);
        if (!context || context.offset !== 0) return false;
        const { block, blockPos } = context;
        if ((block.firstChild?.childCount ?? 0) > 0) return false;

        const bodyContent = block.lastChild?.content;
        const { state, view } = this.editor;
        const replacement =
          bodyContent && bodyContent.size > 0
            ? bodyContent
            : state.schema.nodes.paragraph?.create();
        if (!replacement) return false;

        const tr = state.tr.replaceWith(blockPos, blockPos + block.nodeSize, replacement);
        const next = Selection.findFrom(tr.doc.resolve(blockPos + 1), 1);
        if (next) tr.setSelection(next);
        view.dispatch(tr.scrollIntoView());
        return true;
      }
    };
  },
  addProseMirrorPlugins() {
    return [
      // 光标不允许停留在已收起的内容区，弹回标题末尾
      new Plugin({
        key: collapsibleSelectionGuardKey,
        appendTransaction(_transactions, _oldState, newState) {
          const { $from } = newState.selection;
          for (let depth = $from.depth; depth > 1; depth -= 1) {
            if ($from.node(depth).type.name !== "collapsibleBody") continue;
            const block = $from.node(depth - 1);
            if (block.type.name !== "collapsibleBlock" || block.attrs.open !== false) continue;
            const titleNode = block.firstChild;
            if (!titleNode) return null;
            const titleEnd = $from.before(depth - 1) + titleNode.nodeSize;
            return newState.tr.setSelection(TextSelection.create(newState.doc, titleEnd));
          }
          return null;
        }
      })
    ];
  }
});

export const CollapsibleTitleExtension = TiptapNode.create({
  name: "collapsibleTitle",
  content: "inline*",
  selectable: false,
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'details[data-type="collapsible-block"] > summary' }];
  },
  renderHTML() {
    return ["summary", 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleTitleView);
  }
});

export const CollapsibleBodyExtension = TiptapNode.create({
  name: "collapsibleBody",
  content: "block*",
  selectable: false,
  defining: true,
  isolating: true,
  parseHTML() {
    return [
      { tag: 'div[data-type="collapsible-body"]' },
      // 兼容旧版导出 HTML 里没有 data-type 的内容容器
      { tag: 'details[data-type="collapsible-block"] > div' }
    ];
  },
  renderHTML() {
    return ["div", { "data-type": "collapsible-body" }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBodyView);
  },
  addKeyboardShortcuts() {
    return {
      // 内容区末尾的空段落上再按 Enter → 逃逸到折叠块之后
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        let bodyDepth = -1;
        for (let depth = $from.depth; depth > 1; depth -= 1) {
          if ($from.node(depth).type.name === "collapsibleBody") {
            bodyDepth = depth;
            break;
          }
        }
        if (bodyDepth < 0) return false;

        const body = $from.node(bodyDepth);
        const last = body.lastChild;
        if (!last || last.type.name !== "paragraph" || last.childCount > 0) return false;

        const lastStart = $from.start(bodyDepth) + body.content.size - last.nodeSize;
        if ($from.pos < lastStart) return false;

        const block = $from.node(bodyDepth - 1);
        const blockPos = $from.before(bodyDepth - 1);
        this.editor
          .chain()
          .focus()
          .insertContentAt({ from: lastStart, to: blockPos + block.nodeSize }, { type: "paragraph" })
          .run();
        return true;
      }
    };
  }
});

/** 折叠块相关的三个节点扩展，需一起注册 */
export const CollapsibleBlockExtensions = [
  CollapsibleBlockExtension,
  CollapsibleTitleExtension,
  CollapsibleBodyExtension
];
