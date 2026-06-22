import { describe, expect, it } from "vitest";
import { markdownToDoc, parseBackupNotes, safeExportName } from "../src/main/note-transfer";

describe("note transfer helpers", () => {
  it("markdown 可以转为基础文档结构", () => {
    const doc = markdownToDoc("# 标题\n\n- 列表项");
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[1]?.type).toBe("bulletList");
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
});
