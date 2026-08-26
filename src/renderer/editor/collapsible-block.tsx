import { useState } from "react";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { ChevronDown, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";

function CollapsibleBlockView({ editor, getPos, node, selected, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const hasChild = node.content.childCount > 0;

  function focusInsertedTitle(atPos: number) {
    window.requestAnimationFrame(() => {
      const dom = editor.view.nodeDOM(atPos) as HTMLElement | null;
      const input = dom?.querySelector(".collapsible-block-title") as HTMLInputElement | null;
      input?.focus();
    });
  }

  function findParentCollapsiblePos() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return null;
    const $pos = editor.state.doc.resolve(pos);

    for (let depth = $pos.depth - 1; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "collapsibleBlock") return $pos.before(depth);
    }

    return null;
  }

  function findParentCollapsibleAfterPos() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return null;
    const $pos = editor.state.doc.resolve(pos);

    for (let depth = $pos.depth - 1; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "collapsibleBlock") return $pos.after(depth);
    }

    return null;
  }

  function insertSiblingCollapsibleBlock() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const $pos = editor.state.doc.resolve(pos);
    let siblingPos = pos + node.nodeSize;

    for (let depth = $pos.depth - 1; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== "collapsibleBlock") continue;
      siblingPos = $pos.before(depth) + $pos.node(depth).nodeSize;
      break;
    }

    editor
      .chain()
      .focus()
      .insertContentAt(siblingPos, {
        type: "collapsibleBlock",
        attrs: { title: "", open: false }
      })
      .run();
    focusInsertedTitle(siblingPos);
  }

  function insertSiblingChildCollapsibleBlock() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const $pos = editor.state.doc.resolve(pos);

    for (let depth = $pos.depth - 1; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== "collapsibleBlock") continue;
      const siblingPos = pos + node.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(siblingPos, {
          type: "collapsibleBlock",
          attrs: { title: "", open: false }
        })
        .run();
      focusInsertedTitle(siblingPos);
      return;
    }
  }

  function removeEmptyCollapsibleBlock() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;

    const parentPos = findParentCollapsiblePos();
    const parentAfterPos = findParentCollapsibleAfterPos();
    const { state, view } = editor;
    const tr = state.tr.delete(pos, pos + node.nodeSize);

    if (parentPos !== null && parentAfterPos !== null) {
      const insertPos = tr.mapping.map(parentAfterPos);
      tr.insert(insertPos, state.schema.nodes.collapsibleBlock.create({ title: "", open: false }));
      view.dispatch(tr.scrollIntoView());
      editor.commands.focus();
      focusInsertedTitle(insertPos);
      return;
    }

    const mappedPos = tr.mapping.map(pos);
    if (tr.doc.childCount === 0) {
      const paragraph = state.schema.nodes.paragraph?.create();
      if (paragraph) {
        tr.insert(mappedPos, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, mappedPos + 1));
      }
    } else {
      const selectionPos = Math.min(Math.max(1, mappedPos), tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    }

    view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
  }

  function insertChildCollapsibleBlock() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;

    const childPos = pos + node.nodeSize - 1;
    const childBlock = {
      type: "collapsibleBlock",
      attrs: { title: "", open: false }
    };
    editor.chain().focus().insertContentAt(childPos, childBlock).run();
    focusInsertedTitle(childPos);
  }

  return (
    <NodeViewWrapper
      className={selected ? "collapsible-block is-selected" : "collapsible-block"}
      data-open={open ? "true" : "false"}
    >
      <div className="collapsible-block-header" contentEditable={false}>
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
        <input
          className="collapsible-block-title"
          value={title}
          placeholder="空折叠块"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ title: event.target.value.slice(0, 80) })}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const parentPos = findParentCollapsiblePos();
            const isChildBlock = parentPos !== null;

            if (!title.trim()) {
              removeEmptyCollapsibleBlock();
              return;
            }

            if (!isChildBlock) {
              if (open) {
                insertChildCollapsibleBlock();
                return;
              }

              insertSiblingCollapsibleBlock();
              return;
            }

            insertSiblingChildCollapsibleBlock();
          }}
        />
        <div className="collapsible-block-menu-wrap">
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
            <div className="collapsible-block-menu" onMouseDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="collapsible-block-menu-delete"
                onClick={() => {
                  setMenuOpen(false);
                  const pos = typeof getPos === "function" ? getPos() : null;
                  if (typeof pos !== "number") return;
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: pos, to: pos + node.nodeSize })
                    .run();
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="collapsible-block-body">
        <NodeViewContent className="collapsible-block-content" />
        {open && !hasChild ? (
          <button
            type="button"
            className="collapsible-block-insert"
            contentEditable={false}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={insertChildCollapsibleBlock}
          >
            空折叠块
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

export const CollapsibleBlockExtension = TiptapNode.create({
  name: "collapsibleBlock",
  group: "block",
  content: "collapsibleBlock*",
  draggable: true,
  selectable: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (element) =>
          element.querySelector("summary")?.textContent ?? element.getAttribute("data-title") ?? "",
        renderHTML: (attributes) => (attributes.title ? { "data-title": attributes.title } : {})
      },
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
    const title =
      typeof HTMLAttributes["data-title"] === "string" && HTMLAttributes["data-title"].trim()
        ? HTMLAttributes["data-title"]
        : "空折叠块";
    const isOpen = HTMLAttributes["data-open"] !== "false";

    return [
      "details",
      mergeAttributes(HTMLAttributes, { "data-type": "collapsible-block" }, isOpen ? { open: "open" } : {}),
      ["summary", title],
      ["div", 0]
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlockView);
  }
});
