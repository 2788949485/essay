import { describe, expect, it } from "vitest";
import { markdownToDoc, parseBackupNotes, safeExportName } from "../src/main/note-transfer";
import { isStandaloneLatex } from "../src/shared/math-patterns";

describe("note transfer helpers", () => {
  it("markdown 可以转为基础文档结构", () => {
    const doc = markdownToDoc("# 标题\n\n- 列表项");
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[1]?.type).toBe("bulletList");
  });

  it("markdown 可以覆盖常见块级和行内格式", () => {
    const doc = markdownToDoc(
      [
        "# 标题",
        "",
        "> 引用",
        "",
        "- [x] 已完成",
        "- [ ] 待办",
        "",
        "1. 第一项",
        "   - 子项",
        "",
        "```bash",
        "dir",
        "```",
        "",
        "---",
        "",
        "![封面](https://example.com/a.png \"图\")",
        "",
        "| 列1 | 列2 |",
        "| --- | --- |",
        "| A | B |",
        "",
        "**加粗** *斜体* ~~删除线~~ `代码` [链接](https://example.com)"
      ].join("\n")
    );

    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[1]?.type).toBe("blockquote");
    expect(doc.content?.[2]?.type).toBe("taskList");
    expect(doc.content?.[3]?.type).toBe("orderedList");
    expect(doc.content?.[3]?.content?.[0]?.content?.[1]?.type).toBe("bulletList");
    expect(doc.content?.[4]?.type).toBe("codeBlock");
    expect(doc.content?.[4]?.content?.[0]?.text).toBe("dir");
    expect(doc.content?.[5]?.type).toBe("horizontalRule");
    expect(doc.content?.[6]?.type).toBe("image");
    expect(doc.content?.[6]?.attrs?.src).toBe("https://example.com/a.png");
    expect(doc.content?.[7]?.type).toBe("table");

    const paragraph = doc.content?.[8];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.content?.[0]?.marks?.[0]?.type).toBe("bold");
    expect(paragraph?.content?.[2]?.marks?.[0]?.type).toBe("italic");
    expect(paragraph?.content?.[4]?.marks?.[0]?.type).toBe("strike");
    expect(paragraph?.content?.[6]?.marks?.[0]?.type).toBe("code");
    expect(paragraph?.content?.[8]?.marks?.[0]?.type).toBe("link");
  });

  it("可以从备份对象中取出 notes", () => {
    const notes = parseBackupNotes({
      app: "suiji",
      notes: [{ id: "1" }, { id: "2" }]
    });
    expect(notes).toHaveLength(2);
  });

  it("导出文件名会清理非法字符", () => {
    expect(safeExportName('a:b/c*?"', "md")).toBe("a_b_c___.md");
  });

  it("自动链接不包含前面的中文", () => {
    const paragraph = markdownToDoc("或者在电脑端访问www.caixuetang.cn，查看个人中心").content?.[0];

    expect(paragraph?.content).toEqual([
      { type: "text", text: "或者在电脑端访问", marks: undefined },
      {
        type: "text",
        text: "www.caixuetang.cn",
        marks: [{ type: "link", attrs: { href: "http://www.caixuetang.cn" } }]
      },
      { type: "text", text: "，查看个人中心", marks: undefined }
    ]);
  });

  it("可以识别未包裹分隔符的 LaTeX 公式", () => {
    expect(isStandaloneLatex("J(\\theta) = -\\frac{1}{m} \\sum_{i=1}^{m} y^{(i)}")).toBe(true);
    expect(isStandaloneLatex("这是一段普通文本")).toBe(false);
  });
});
