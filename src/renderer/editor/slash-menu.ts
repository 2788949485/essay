import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
};

type SlashState = {
  open: boolean;
  from: number;
  items: SlashCommand[];
  index: number;
};

const CLOSED: SlashState = { open: false, from: 0, items: [], index: 0 };

type SlashMeta = { type: "close" } | { type: "move"; index: number };

/** 行首或空白后的 / 触发；返回斜杠位置与已输入的查询词 */
function matchSlashTrigger(textBefore: string, cursorPos: number) {
  const match = /(^|\s)\/([^\s/]*)$/.exec(textBefore);
  if (!match) return null;
  return { from: cursorPos - match[0].length + match[1].length, query: match[2] };
}

export const SlashMenuExtension = Extension.create<{ getCommands: () => SlashCommand[] }>({
  name: "slashMenu",
  // 高于折叠块等键盘扩展：菜单打开时 Enter/方向键先选条目
  priority: 1100,
  addOptions() {
    return {
      getCommands: () => [] as SlashCommand[]
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    const key = new PluginKey<SlashState>("slashMenu");

    function runCommand(view: EditorView, state: SlashState, index: number) {
      const item = state.items[index];
      if (!item) return;
      view.dispatch(
        view.state.tr
          .delete(state.from, view.state.selection.from)
          .setMeta(key, { type: "close" } satisfies SlashMeta)
      );
      item.run();
    }

    function handleKey(view: EditorView, event: KeyboardEvent): boolean {
      const state = key.getState(view.state);
      if (!state?.open) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const index = (state.index + delta + state.items.length) % state.items.length;
        view.dispatch(view.state.tr.setMeta(key, { type: "move", index } satisfies SlashMeta));
        return true;
      }
      if (event.key === "Enter") {
        runCommand(view, state, state.index);
        return true;
      }
      if (event.key === "Escape") {
        view.dispatch(view.state.tr.setMeta(key, { type: "close" } satisfies SlashMeta));
        return true;
      }
      return false;
    }

    return [
      new Plugin<SlashState>({
        key,
        state: {
          init: () => CLOSED,
          apply(tr, prev) {
            const meta = tr.getMeta(key) as SlashMeta | null | undefined;
            if (meta?.type === "close") return CLOSED;
            if (meta?.type === "move") return prev.open ? { ...prev, index: meta.index } : CLOSED;

            const selection = tr.selection;
            if (!selection.empty || !selection.$from.parent.isTextblock) return CLOSED;
            const textBefore = selection.$from.parent.textBetween(
              Math.max(0, selection.$from.parentOffset - 80),
              selection.$from.parentOffset,
              undefined,
              "￼"
            );
            const trigger = matchSlashTrigger(textBefore, selection.from);
            if (!trigger) return CLOSED;

            const query = trigger.query.toLowerCase();
            const items = options
              .getCommands()
              .filter(
                (command) =>
                  !query ||
                  command.label.toLowerCase().includes(query) ||
                  command.hint.toLowerCase().includes(query)
              )
              .slice(0, 9);
            if (items.length === 0) return CLOSED;
            const index = prev.open && prev.from === trigger.from ? Math.min(prev.index, items.length - 1) : 0;
            return { open: true, from: trigger.from, items, index };
          }
        },
        props: {
          handleKeyDown(view, event) {
            return handleKey(view, event);
          }
        },
        view(editorView) {
          const container = document.createElement("div");
          container.className = "slash-menu";
          container.style.display = "none";
          document.body.appendChild(container);

          // 捕获阶段拦截，避免被编辑器其它按键处理抢占（真机下更可靠）
          const onKeyDown = (event: KeyboardEvent) => {
            if (handleKey(editorView, event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          };
          editorView.dom.addEventListener("keydown", onKeyDown, true);

          const render = () => {
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
                button.className = itemIndex === state.index ? "slash-menu-item is-active" : "slash-menu-item";
                const label = document.createElement("strong");
                label.textContent = item.label;
                const hint = document.createElement("span");
                hint.textContent = item.hint;
                button.append(label, hint);
                button.addEventListener("mousedown", (event) => {
                  event.preventDefault();
                  runCommand(editorView, { ...state, index: itemIndex }, itemIndex);
                });
                return button;
              })
            );
            container.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
          };

          return {
            update: render,
            destroy() {
              editorView.dom.removeEventListener("keydown", onKeyDown, true);
              container.remove();
            }
          };
        }
      })
    ];
  }
});
