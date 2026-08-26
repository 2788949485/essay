import { describe, expect, it } from "vitest";
import {
  buildPlainTextBlocks,
  describeRestoreFailures,
  formatHotkeyEvent,
  getContentPlainText,
  getCurrentFontPresetId,
  normalizeFolderInput,
  normalizeLinkUrl,
  normalizePastedLineBreaks,
  parseSearchSyntax,
  parseTagsInput,
  settingsPayload,
  sortNotes,
  splitPastedMath
} from "../src/renderer/utils/text";
import { DEFAULT_APP_SETTINGS, FONT_PRESETS } from "../src/renderer/constants";
import type { NoteRecord } from "../src/shared/types";

describe("parseSearchSyntax", () => {
  it("解析纯关键词", () => {
    expect(parseSearchSyntax("hello world").text).toBe("hello world");
  });

  it("解析 tag:/folder: 与视图关键字", () => {
    const syntax = parseSearchSyntax('tag:工作 folder:项目 fav "精确 短语"');
    expect(syntax.tags).toEqual(["工作"]);
    expect(syntax.folder).toBe("项目");
    expect(syntax.fav).toBe(true);
    expect(syntax.text).toBe("精确 短语");
  });

  it("支持中文关键字 收藏/归档/回收站", () => {
    expect(parseSearchSyntax("收藏").fav).toBe(true);
    expect(parseSearchSyntax("归档").archive).toBe(true);
    expect(parseSearchSyntax("回收站").trash).toBe(true);
  });

  it("空输入返回空语法", () => {
    expect(parseSearchSyntax("")).toEqual({ text: "", tags: [], folder: "", fav: false, archive: false, trash: false });
  });
});

describe("normalizePastedLineBreaks", () => {
  it("合并中文之间的视觉换行", () => {
    expect(normalizePastedLineBreaks("这是第一行\n接着第二行")).toBe("这是第一行接着第二行");
  });

  it("英文之间换行转为空格并压缩空白", () => {
    expect(normalizePastedLineBreaks("hello\nworld  \t again")).toBe("hello world again");
  });
});

describe("buildPlainTextBlocks", () => {
  it("按空行分段并忽略空段", () => {
    const blocks = buildPlainTextBlocks("第一段\n\n\n第二段");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].content?.[0]).toEqual({ type: "text", text: "第一段" });
  });

  it("空白输入返回空数组", () => {
    expect(buildPlainTextBlocks("  \n\n  ")).toEqual([]);
  });
});

describe("splitPastedMath", () => {
  it("识别块级公式", () => {
    const blocks = splitPastedMath("$$E = mc^2$$");
    expect(blocks).toEqual([{ type: "mathBlock", attrs: { latex: "E = mc^2" } }]);
  });

  it("混合文本与行内公式", () => {
    const blocks = splitPastedMath("能量公式 $E=mc^2$ 很著名");
    expect(blocks?.[0].type).toBe("paragraph");
    expect(blocks?.[0].content).toContainEqual({ type: "mathInline", attrs: { latex: "E=mc^2" } });
  });

  it("普通文本返回 null", () => {
    expect(splitPastedMath("没有任何公式")).toBeNull();
  });
});

describe("getContentPlainText", () => {
  it("提取段落、标题、折叠块标题与图片 alt", () => {
    const text = getContentPlainText({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
        {
          type: "collapsibleBlock",
          attrs: { title: "折叠", open: true },
          content: [
            {
              type: "collapsibleBlock",
              attrs: { title: "", open: true },
              content: []
            }
          ]
        },
        { type: "image", attrs: { alt: "示意图", src: "data:..." } }
      ]
    });
    expect(text).toContain("标题");
    expect(text).toContain("折叠");
    expect(text).toContain("示意图");
  });

  it("空内容返回空字符串", () => {
    expect(getContentPlainText(undefined)).toBe("");
  });
});

describe("parseTagsInput", () => {
  it("支持中英文逗号与空格分隔并去重", () => {
    expect(parseTagsInput("工作， 学习,工作 生活")).toEqual(["工作", "学习", "生活"]);
  });

  it("最多保留 12 个标签", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `t${i}`).join(",");
    expect(parseTagsInput(tags)).toHaveLength(12);
  });
});

describe("normalizeFolderInput", () => {
  it("替换非法字符并截断", () => {
    expect(normalizeFolderInput("a/b\\c:d")).toBe("a_b_c_d");
    expect(normalizeFolderInput("x".repeat(50))).toHaveLength(40);
  });
});

describe("normalizeLinkUrl", () => {
  it("空输入返回空", () => {
    expect(normalizeLinkUrl("  ")).toBe("");
  });

  it("裸域名补全 https", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com");
  });

  it("已有协议保持不变", () => {
    expect(normalizeLinkUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });
});

describe("sortNotes", () => {
  const base = {
    id: "",
    title: "",
    excerpt: "",
    tags: [],
    folder: "",
    favoriteAt: null,
    archivedAt: null,
    trashedAt: null,
    pinnedAt: null,
    createdAt: "",
    updatedAt: "",
    content: {},
    html: "",
    plainText: ""
  } as NoteRecord;

  it("置顶优先，其余按更新时间倒序", () => {
    const sorted = sortNotes([
      { ...base, id: "a", updatedAt: "2024-01-01" },
      { ...base, id: "b", pinnedAt: "2024-01-02", updatedAt: "2024-01-01" },
      { ...base, id: "c", updatedAt: "2024-01-03" }
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["b", "c", "a"]);
  });
});

describe("settingsPayload", () => {
  it("映射 encryptLocalData 并给热键兜底", () => {
    const payload = settingsPayload({ ...DEFAULT_APP_SETTINGS, storageEncrypted: true }, "");
    expect(payload.encryptLocalData).toBe(true);
    expect(payload.hotkey).toBe("CommandOrControl+Alt+J");
  });
});

describe("describeRestoreFailures", () => {
  it("最多展示 3 条并附总数", () => {
    const failures = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, reason: "x" }));
    const text = describeRestoreFailures(failures);
    expect(text).toContain("t0");
    expect(text).toContain("等 5 条");
  });

  it("空列表返回空字符串", () => {
    expect(describeRestoreFailures([])).toBe("");
  });
});

describe("getCurrentFontPresetId", () => {
  it("匹配预设字体，未知返回默认", () => {
    expect(getCurrentFontPresetId(FONT_PRESETS[1].family)).toBe("serif");
    expect(getCurrentFontPresetId("Some Other Font")).toBe("default");
  });
});

describe("formatHotkeyEvent", () => {
  const mockEvent = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
    ({
      key,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ...mods
    }) as React.KeyboardEvent<HTMLInputElement>;

  it("组合键格式化为 Electron accelerator", () => {
    expect(formatHotkeyEvent(mockEvent("j", { ctrlKey: true, altKey: true }))).toBe("CommandOrControl+Alt+J");
  });

  it("纯修饰键或无修饰键返回空", () => {
    expect(formatHotkeyEvent(mockEvent("Control", { ctrlKey: true }))).toBe("");
    expect(formatHotkeyEvent(mockEvent("a"))).toBe("");
  });
});
