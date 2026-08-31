import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type NoteLinkCandidate = {
  id: string;
  title: string;
};

export type NoteLinkTrigger = {
  from: number;
  query: string;
};

/** 光标前文本里 [[ 触发的匹配；返回触发位置和已输入的查询词 */
export function matchNoteLinkTrigger(textBefore: string, cursorPos: number): NoteLinkTrigger | null {
  // eslint-disable-next-line no-useless-escape -- [[] 里的转义让触发字面量一目了然
  const match = /\[\[([^\[\]]*)$/.exec(textBefore);
  if (!match) return null;
  return { from: cursorPos - match[0].length, query: match[1] };
}

type SuggestionState = {
  open: boolean;
  from: number;
  items: NoteLinkCandidate[];
  index: number;
};

const CLOSED: SuggestionState = { open: false, from: 0, items: [], index: 0 };

type SuggestionMeta = { type: "close" } | { type: "move"; index: number };

type NoteLinkSuggestionOptions = {
  getNotes: () => NoteLinkCandidate[];
};

/**
 * 输入 [[ 后弹出笔记选择器，选中后插入 suiji-note:// 链接。
 * 点击链接的跳转在 App 的 handleClick 里按 scheme 拦截。
 */
export const NoteLinkSuggestionExtension = Extension.create<NoteLinkSuggestionOptions>({
  name: "noteLinkSuggestion",
  // 高于折叠块等键盘扩展：建议菜单打开时 Enter/方向键先选条目
  priority: 1100,

  addOptions() {
    return {
      getNotes: () => []
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const key = new PluginKey<SuggestionState>("noteLinkSuggestion");
    let renderDropdown = () => {};

    function insertLink(view: EditorView, state: SuggestionState) {
      const candidate = state.items[state.index];
      const linkMark = view.state.schema.marks.link;
      if (!candidate || !linkMark) return;
      const title = candidate.title.trim() || "未命名记录";
      const textNode = view.state.schema.text(title, [linkMark.create({ href: `suiji-note://${candidate.id}` })]);
      const tr = view.state.tr
        .replaceWith(state.from, view.state.selection.from, textNode)
        .setMeta(key, { type: "close" } satisfies SuggestionMeta)
        .scrollIntoView();
      view.dispatch(tr);
    }

    return [
      new Plugin<SuggestionState>({
        key,
        state: {
          init: () => CLOSED,
          apply(tr, prev) {
            const meta = tr.getMeta(key) as SuggestionMeta | null | undefined;
            if (meta?.type === "close") return CLOSED;
            if (meta?.type === "move") return prev.open ? { ...prev, index: meta.index } : CLOSED;
            const selection = tr.selection;
            if (!selection.empty || !selection.$from.parent.isTextblock) return CLOSED;
            const textBefore = selection.$from.parent.textBetween(
              Math.max(0, selection.$from.parentOffset - 80),
              selection.$from.parentOffset,
              undefined,
              "\ufffc"
            );
            const trigger = matchNoteLinkTrigger(textBefore, selection.from);
            if (!trigger) return CLOSED;
            const keyword = trigger.query.trim().toLowerCase();
            const items = options
              .getNotes()
              .filter((note) => !keyword || note.title.toLowerCase().includes(keyword))
              .slice(0, 8);
            if (items.length === 0) return CLOSED;
            const index = prev.open && prev.from === trigger.from ? prev.index % items.length : 0;
            return { open: true, from: trigger.from, items, index };
          }
        },
        props: {
          handleKeyDown(view, event) {
            const state = key.getState(view.state);
            if (!state?.open) return false;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const delta = event.key === "ArrowDown" ? 1 : -1;
              const index = (state.index + delta + state.items.length) % state.items.length;
              view.dispatch(view.state.tr.setMeta(key, { type: "move", index } satisfies SuggestionMeta));
              return true;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              insertLink(view, state);
              return true;
            }
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(key, { type: "close" } satisfies SuggestionMeta));
              return true;
            }
            return false;
          }
        },
        view(editorView) {
          const container = document.createElement("div");
          container.className = "note-link-suggestion";
          container.style.display = "none";
          document.body.appendChild(container);

          renderDropdown = () => {
            const state = key.getState(editorView.state);
            if (!state?.open) {
              container.style.display = "none";
              return;
            }
            const coords = editorView.coordsAtPos(editorView.state.selection.from);
            container.style.display = "";
            container.style.left = `${coords.left}px`;
            container.style.top = `${coords.bottom + 6}px`;
            container.replaceChildren(
              ...state.items.map((item, itemIndex) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className =
                  itemIndex === state.index ? "note-link-suggestion-item is-active" : "note-link-suggestion-item";
                button.textContent = item.title.trim() || "未命名记录";
                button.addEventListener("mousedown", (event) => {
                  event.preventDefault();
                  insertLink(editorView, { ...state, index: itemIndex });
                });
                return button;
              })
            );
          };

          return {
            update: renderDropdown,
            destroy() {
              container.remove();
            }
          };
        }
      })
    ];
  }
});
