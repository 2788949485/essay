// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CollapsibleBlockExtensions } from "../src/renderer/editor/collapsible-block";
import { EditorPlaceholder } from "../src/renderer/editor/placeholder";
import type { JSONContent } from "@tiptap/react";

function createEditor(content: JSONContent) {
  return new Editor({ extensions: [StarterKit, ...CollapsibleBlockExtensions, EditorPlaceholder], content });
}

function pressKey(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...options });
  return editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event));
}

const block = (title: string, open: boolean, body: JSONContent[] = []): JSONContent => ({
  type: "collapsibleBlock",
  attrs: { open },
  content: [
    title ? { type: "collapsibleTitle", content: [{ type: "text", text: title }] } : { type: "collapsibleTitle" },
    { type: "collapsibleBody", content: body }
  ]
});

const para = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("折叠块大纲式键盘交互", () => {
  it("空标题回车新建同级折叠块", () => {
    const editor = createEditor({ type: "doc", content: [block("", false)] });
    editor.commands.setTextSelection(2);
    expect(pressKey(editor, "Enter")).toBe(true);

    const content = editor.getJSON().content!;
    expect(content).toHaveLength(2);
    expect(content[1].type).toBe("collapsibleBlock");
    // 光标落在新块标题内
    expect(editor.state.selection.$from.parent.type.name).toBe("collapsibleTitle");
    editor.destroy();
  });

  it("有字标题回车进入内容区，收起自动展开", () => {
    const editor = createEditor({ type: "doc", content: [block("计划", false)] });
    editor.commands.setTextSelection(4);
    expect(pressKey(editor, "Enter")).toBe(true);

    const first = editor.getJSON().content![0];
    expect(first.attrs?.open).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("内容区行中回车切分文字为下一级折叠块标题", () => {
    const editor = createEditor({ type: "doc", content: [block("计划", true, [para("甲乙丙")])] });
    // 标题(计划,2字)内容 2..4，body 内容起点 6，段落内容起点 7；偏移 1 → 8
    editor.commands.setTextSelection(8);
    expect(pressKey(editor, "Enter")).toBe(true);

    const body = editor.getJSON().content![0].content![1].content!;
    expect(body[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "甲" }] });
    const child = body[1];
    expect(child.type).toBe("collapsibleBlock");
    expect(child.content![0]).toMatchObject({ content: [{ type: "text", text: "乙丙" }] });
    expect(editor.state.selection.$from.parent.type.name).toBe("collapsibleTitle");
    editor.destroy();
  });

  it("空标题空内容区退格删除整块", () => {
    const editor = createEditor({
      type: "doc",
      content: [para("前文"), block("", false)]
    });
    editor.commands.setTextSelection(6);
    expect(pressKey(editor, "Backspace")).toBe(true);

    const content = editor.getJSON().content!;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("paragraph");
    editor.destroy();
  });

  it("空标题有内容区退格上提子块", () => {
    const editor = createEditor({ type: "doc", content: [block("", true, [para("内容")])] });
    editor.commands.setTextSelection(2);
    expect(pressKey(editor, "Backspace")).toBe(true);

    const content = editor.getJSON().content!;
    expect(content[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "内容" }] });
    editor.destroy();
  });

  it("有字标题行首退格并入前一折叠块", () => {
    const editor = createEditor({
      type: "doc",
      content: [block("甲", true, [para("正文")]), block("乙", false)]
    });
    const doc = editor.state.doc;
    let target = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === "collapsibleTitle" && node.textContent === "乙") target = pos + 1;
    });
    editor.commands.setTextSelection(target);
    expect(pressKey(editor, "Backspace")).toBe(true);

    const content = editor.getJSON().content!;
    expect(content).toHaveLength(1);
    expect(content[0].content![0]).toMatchObject({ content: [{ type: "text", text: "甲乙" }] });
    // 乙的内容区为空，合并后内容区只有甲原有的一个段落
    expect(content[0].content![1].content).toHaveLength(1);
    editor.destroy();
  });

  it("内容区空首段行首退格删除段落回标题", () => {
    const editor = createEditor({ type: "doc", content: [block("标题", true, [{ type: "paragraph" }])] });
    editor.commands.setTextSelection(7);
    expect(pressKey(editor, "Backspace")).toBe(true);

    const first = editor.getJSON().content![0];
    expect(first.content![1].content ?? []).toHaveLength(0);
    expect(editor.state.selection.$from.parent.type.name).toBe("collapsibleTitle");
    editor.destroy();
  });

  it("内容区首段行首退格并回标题", () => {
    const editor = createEditor({ type: "doc", content: [block("标题", true, [para("正文")])] });
    editor.commands.setTextSelection(7);
    expect(pressKey(editor, "Backspace")).toBe(true);

    const first = editor.getJSON().content![0];
    expect(first.content![0]).toMatchObject({ content: [{ type: "text", text: "标题正文" }] });
    expect(first.content![1].content ?? []).toHaveLength(0);
    editor.destroy();
  });

  it("Ctrl+Enter 逃逸出块", () => {
    const editor = createEditor({ type: "doc", content: [block("甲", true, [para("乙")]), block("丙", false)] });
    editor.commands.setTextSelection(9);
    expect(pressKey(editor, "Enter", { ctrlKey: true })).toBe(true);

    const content = editor.getJSON().content!;
    expect(content[1].type).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("插入空折叠块后「开始记录」占位符不再叠在块上", () => {
    const empty = createEditor({ type: "doc", content: [{ type: "paragraph" }] });
    expect(empty.view.dom.firstElementChild?.getAttribute("data-placeholder")).toBe("开始记录...");
    empty.destroy();

    const withBlock = createEditor({ type: "doc", content: [block("", false)] });
    expect(withBlock.view.dom.firstElementChild?.getAttribute("data-placeholder") ?? "").toBe("");
    withBlock.destroy();
  });

  it("标题内 Shift+Enter 插入换行", () => {
    const editor = createEditor({ type: "doc", content: [block("甲", false)] });
    editor.commands.setTextSelection(3);
    expect(pressKey(editor, "Enter", { shiftKey: true })).toBe(true);

    const title = editor.getJSON().content![0].content![0];
    expect(title.content?.some((n) => n.type === "hardBreak")).toBe(true);
    editor.destroy();
  });
});
