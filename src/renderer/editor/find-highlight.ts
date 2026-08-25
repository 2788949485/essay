import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import type { FindMatch } from "../constants";

const findHighlightPluginKey = new PluginKey<DecorationSet>("findHighlight");

/** 查找面板的全部匹配高亮：通过 setFindHighlights 推送，不占用文档选区 */
export const FindHighlightExtension = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const meta = tr.getMeta(findHighlightPluginKey);
            if (meta) return meta;
            return old.map(tr.mapping, tr.doc);
          }
        },
        props: {
          decorations(state) {
            return findHighlightPluginKey.getState(state);
          }
        }
      })
    ];
  }
});

export function setFindHighlights(editor: Editor, matches: FindMatch[], currentIndex: number) {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === currentIndex ? "find-hit is-current" : "find-hit"
    })
  );
  editor.view.dispatch(
    editor.state.tr.setMeta(findHighlightPluginKey, DecorationSet.create(editor.state.doc, decorations))
  );
}

export function clearFindHighlights(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(findHighlightPluginKey, DecorationSet.empty)
  );
}
