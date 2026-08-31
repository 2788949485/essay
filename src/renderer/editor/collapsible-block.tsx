import { useState } from "react";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
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

/** 选区在内容区直属段落内时，返回段落与所属块的位置信息 */
function findBodyParagraphContext(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph" || $from.depth < 2) return null;
  const bodyDepth = $from.depth - 1;
  if ($from.node(bodyDepth).type.name !== "collapsibleBody") return null;
  return {
    para: $from.parent,
    paraPos: $from.before($from.depth),
    body: $from.node(bodyDepth),
    bodyPos: $from.before(bodyDepth),
    block: $from.node(bodyDepth - 1),
    blockPos: $from.before(bodyDepth - 1)
  };
}

/** 选区在任意折叠块内部时（Mod-Enter 逃逸用），返回最近的块 */
function findEnclosingBlock(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "collapsibleBlock") {
      return { block: $from.node(depth), blockPos: $from.before(depth) };
    }
  }
  return null;
}

/** 块的前一条文本行末尾位置（删除/合并后光标落点），没有则 null */
function findPreviousTextEnd(state: EditorState, blockPos: number): number | null {
  const $pos = state.doc.resolve(blockPos);
  const container = $pos.parent;
  const index = $pos.index();
  if (index > 0) {
    const prev = container.child(index - 1);
    const prevPos = blockPos - prev.nodeSize;
    if (prev.type.name === "collapsibleBlock") return prevPos + (prev.firstChild?.nodeSize ?? 1);
    if (prev.isTextblock) return prevPos + prev.nodeSize - 1;
    return null;
  }
  // 嵌套且是内容区第一个子节点：落点是父块标题末尾
  if (container.type.name === "collapsibleBody") return $pos.before($pos.depth) - 1;
  return null;
}

function setCaretAfterDelete(tr: EditorState["tr"], prevEnd: number | null, fallbackPos: number) {
  if (prevEnd !== null) {
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(prevEnd)));
    return;
  }
  const near = Math.min(tr.mapping.map(fallbackPos), tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(near), -1));
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
            editor.chain().focus().insertContentAt(pos + 1, { type: "paragraph" }).setTextSelection(pos + 2).run();
          }}
        >
          点击添加内容
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

const collapsibleSelectionGuardKey = new PluginKey("collapsibleSelectionGuard");

// priority 高于 StarterKit：块内按键语义先于默认处理，块外返回 false 交还默认
const COLLAPSIBLE_PRIORITY = 1000;

export const CollapsibleBlockExtension = TiptapNode.create({
  name: "collapsibleBlock",
  group: "block",
  content: "collapsibleTitle collapsibleBody",
  draggable: true,
  selectable: true,
  defining: true,
  isolating: true,
  priority: COLLAPSIBLE_PRIORITY,
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
      // 标题 Enter：空标题 → 新建同级；有字 → 换行进入内容区（收起自动展开）
      Enter: () => {
        const context = findTitleContext(this.editor.state);
        if (!context) return false;
        const { editor } = this;
        const { block, blockPos } = context;
        const title = block.firstChild;
        const body = block.lastChild;
        if (!title || !body) return false;

        if (title.childCount === 0) {
          const siblingPos = blockPos + block.nodeSize;
          editor
            .chain()
            .focus()
            .insertContentAt(siblingPos, collapsibleBlockJson(false))
            .setTextSelection(siblingPos + 2)
            .run();
          return true;
        }

        if (block.attrs.open === false) {
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(blockPos, undefined, { ...block.attrs, open: true })
          );
        }
        const bodyContentStart = blockPos + 1 + title.nodeSize + 1;
        if (body.childCount === 0) {
          editor
            .chain()
            .focus()
            .insertContentAt(bodyContentStart, { type: "paragraph" })
            .setTextSelection(bodyContentStart + 1)
            .run();
          return true;
        }
        const target = Selection.findFrom(editor.state.doc.resolve(bodyContentStart), 1);
        if (target) {
          editor.chain().focus().setTextSelection(target.from).run();
        } else {
          editor.chain().focus().insertContentAt(bodyContentStart, { type: "paragraph" }).run();
        }
        return true;
      },
      // 标题行首 Backspace：空标题删除/上提子块；有字标题向后合并
      Backspace: () => {
        const context = findTitleContext(this.editor.state);
        if (!context || context.offset !== 0) return false;
        const { editor } = this;
        const { state, view } = editor;
        const { schema, tr } = state;
        const { block, blockPos } = context;
        const title = block.firstChild;
        const body = block.lastChild;
        if (!title || !body) return false;

        if (title.childCount === 0) {
          const prevEnd = findPreviousTextEnd(state, blockPos);
          if (body.childCount === 0) {
            if (state.doc.childCount === 1) {
              tr.replaceWith(blockPos, blockPos + block.nodeSize, schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
            } else {
              tr.delete(blockPos, blockPos + block.nodeSize);
              setCaretAfterDelete(tr, prevEnd, blockPos);
            }
          } else {
            // 解除该层级：内容区子块原地上提，内容不丢
            tr.replaceWith(blockPos, blockPos + block.nodeSize, body.content);
            setCaretAfterDelete(tr, prevEnd, blockPos);
          }
          view.dispatch(tr.scrollIntoView());
          return true;
        }

        const $pos = state.doc.resolve(blockPos);
        const container = $pos.parent;
        const index = $pos.index();
        const prev = index > 0 ? container.child(index - 1) : null;
        const prevPos = prev ? blockPos - prev.nodeSize : 0;

        if (prev && prev.type.name === "collapsibleBlock") {
          const prevTitle = prev.firstChild;
          const prevBody = prev.lastChild;
          if (!prevTitle || !prevBody) return false;
          const prevTitleEnd = prevPos + prevTitle.nodeSize;
          const prevBodyEnd = prevPos + 1 + prevTitle.nodeSize + 1 + prevBody.content.size;
          tr.insert(prevTitleEnd, title.content);
          tr.insert(tr.mapping.map(prevBodyEnd), body.content);
          const delFrom = tr.mapping.map(blockPos);
          tr.delete(delFrom, delFrom + block.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(prevTitleEnd)));
        } else if (prev && prev.isTextblock) {
          const prevEnd = prevPos + prev.nodeSize - 1;
          tr.insert(prevEnd, title.content);
          tr.insert(tr.mapping.map(prevPos + prev.nodeSize), body.content);
          const delFrom = tr.mapping.map(blockPos);
          tr.delete(delFrom, delFrom + block.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(prevEnd)));
        } else if (!prev && container.type.name === "collapsibleBody") {
          const parentTitleEnd = $pos.before($pos.depth) - 1;
          tr.insert(parentTitleEnd, title.content);
          const delFrom = tr.mapping.map(blockPos);
          tr.replaceWith(delFrom, delFrom + block.nodeSize, body.content);
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(parentTitleEnd)));
        } else {
          // 顶层且前面没有块：降级为普通段落，内容区子块成为后续兄弟
          tr.replaceWith(
            blockPos,
            blockPos + block.nodeSize,
            Fragment.from(schema.nodes.paragraph.create(null, title.content)).append(body.content)
          );
          tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // Ctrl+Enter：逃逸出当前块，在块后新建普通段落
      "Mod-Enter": () => {
        const enclosing = findEnclosingBlock(this.editor.state);
        if (!enclosing) return false;
        const after = enclosing.blockPos + enclosing.block.nodeSize;
        this.editor
          .chain()
          .focus()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .run();
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
  priority: COLLAPSIBLE_PRIORITY,
  parseHTML() {
    return [{ tag: 'details[data-type="collapsible-block"] > summary' }];
  },
  renderHTML() {
    return ["summary", 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleTitleView);
  },
  addKeyboardShortcuts() {
    return {
      // 标题是 isolating 节点，setHardBreak 拒执行，换行手动插入
      "Shift-Enter": () => {
        const { state, view } = this.editor;
        if (state.selection.$from.parent.type.name !== "collapsibleTitle") return false;
        view.dispatch(
          state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create()).scrollIntoView()
        );
        return true;
      }
    };
  }
});

export const CollapsibleBodyExtension = TiptapNode.create({
  name: "collapsibleBody",
  content: "block*",
  selectable: false,
  defining: true,
  isolating: true,
  priority: COLLAPSIBLE_PRIORITY,
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
      // 内容区段落 Enter：新建下一级折叠块，光标后文字切分为新块标题
      Enter: () => {
        const context = findBodyParagraphContext(this.editor.state);
        if (!context) return false;
        const { editor } = this;
        const { state, view } = editor;
        const { $from } = state.selection;
        const { para, paraPos } = context;
        const offset = $from.parentOffset;
        const schema = state.schema;

        const trailing = para.content.cut(offset);
        const child = schema.nodes.collapsibleBlock.create({ open: false }, [
          schema.nodes.collapsibleTitle.create(null, trailing),
          schema.nodes.collapsibleBody.create()
        ]);

        const tr = state.tr;
        tr.delete(paraPos + 1 + offset, paraPos + para.nodeSize - 1);
        const insertAt = paraPos + offset + 2;
        tr.insert(insertAt, child);
        tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // 内容区首段行首 Backspace：空段删除回标题末尾，有字并回标题（"换行进入"的逆操作）
      Backspace: () => {
        const context = findBodyParagraphContext(this.editor.state);
        if (!context || this.editor.state.selection.$from.parentOffset !== 0) return false;
        const { para, paraPos, bodyPos, block, blockPos } = context;
        if (paraPos !== bodyPos + 1) return false;

        const { state, view } = this.editor;
        const titleEnd = blockPos + (block.firstChild?.nodeSize ?? 1);
        const tr = state.tr;
        if (para.childCount === 0) {
          tr.delete(paraPos, paraPos + para.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, titleEnd));
        } else {
          tr.insert(titleEnd, para.content);
          const delFrom = tr.mapping.map(paraPos);
          tr.delete(delFrom, delFrom + para.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, titleEnd));
        }
        view.dispatch(tr.scrollIntoView());
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
