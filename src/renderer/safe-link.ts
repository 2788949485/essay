import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export function findWebUrls(text: string) {
  return Array.from(text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'，。！？；：、()[\]{}]+/gi), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
    url: match[0]
  }));
}

export function safeAutolinkPlugin() {
  return new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return;
          const linkType = newState.schema.marks.link;
          if (!linkType) return;

          const transaction = newState.tr;
          newState.doc.descendants((node, position) => {
            if (!node.isTextblock) return;

            const text = node.textContent;
            for (const match of findWebUrls(text)) {
              const from = position + 1 + match.from;
              const to = position + 1 + match.to;
              const href = /^www\./i.test(match.url) ? `http://${match.url}` : match.url;
              const linkedBefore = from > position + 1 && newState.doc.rangeHasMark(from - 1, from, linkType);
              const fullyLinked = newState.doc.rangeHasMark(from, to, linkType);
              const currentHref = newState.doc.nodeAt(from)?.marks.find((mark) => mark.type === linkType)?.attrs.href;

              if (fullyLinked && !linkedBefore && currentHref === href) continue;
              if (linkedBefore) transaction.removeMark(position + 1, from, linkType);
              transaction.removeMark(from, to, linkType);
              transaction.addMark(from, to, linkType.create({ href }));
            }
          });

          return transaction.steps.length ? transaction : undefined;
        }
      });
}

export const SafeAutolink = Extension.create({
  name: "safeAutolink",

  addProseMirrorPlugins() {
    return [safeAutolinkPlugin()];
  }
});
