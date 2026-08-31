// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { SlashMenuExtension } from "../src/renderer/editor/slash-menu";

// jsdom 无布局 API，给 ProseMirror coordsAtPos 补最小桩
for (const proto of [window.Element.prototype, window.Text.prototype, window.Range.prototype]) {
  const target = proto as unknown as Record<string, unknown>;
  target.getClientRects ??= function () {
    return [];
  };
  target.getBoundingClientRect ??= function () {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
}
window.HTMLElement.prototype.scrollIntoView ??= function () {};

function pressKey(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  return editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event));
}

describe("斜杠命令菜单", () => {
  it("输入 / 打开菜单，Enter 执行并清除斜杠", () => {
    let ran = "";
    const editor = new Editor({
      extensions: [
        StarterKit,
        SlashMenuExtension.configure({
          getCommands: () => [{ id: "h1", label: "一级标题", hint: "大标题", run: () => void (ran = "h1") }]
        })
      ],
      content: { type: "doc", content: [{ type: "paragraph" }] }
    });
    editor.commands.setTextSelection(1);
    editor.commands.insertContentAt(1, "/");

    expect(pressKey(editor, "Enter")).toBe(true);
    expect(ran).toBe("h1");
    expect(editor.state.doc.textContent).toBe("");
    editor.destroy();
  });

  it("单词中间的路径斜杠不触发", () => {
    let ran = "";
    const editor = new Editor({
      extensions: [
        StarterKit,
        SlashMenuExtension.configure({
          getCommands: () => [{ id: "h1", label: "一级标题", hint: "", run: () => void (ran = "h1") }]
        })
      ],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a/b" }] }] }
    });
    editor.commands.setTextSelection(4);
    // 菜单未打开：Enter 走默认 splitBlock，把段落切成两段，且命令不执行
    pressKey(editor, "Enter");
    expect(ran).toBe("");
    expect(editor.state.doc.childCount).toBe(2);
    editor.destroy();
  });
});
