import { describe, expect, it } from "vitest";
import { assetFileNameFromUrl, collectAssetFileNames } from "../src/shared/note-assets";
import { collectOpenTasks, toggleTaskAtIndex } from "../src/renderer/utils/text";
import { matchNoteLinkTrigger } from "../src/renderer/editor/note-link-suggestion";
import type { NoteRecord } from "../src/shared/types";

describe("assetFileNameFromUrl", () => {
  it("提取合法附件文件名", () => {
    expect(assetFileNameFromUrl("suiji-asset://abc-123.png")).toBe("abc-123.png");
  });

  it("拒绝非附件链接", () => {
    expect(assetFileNameFromUrl("https://example.com/a.png")).toBeNull();
    expect(assetFileNameFromUrl("suiji-note://some-id")).toBeNull();
  });

  it("拒绝路径穿越", () => {
    expect(assetFileNameFromUrl("suiji-asset://../../etc/passwd")).toBeNull();
    expect(assetFileNameFromUrl("suiji-asset://..%2F..%2Fx")).toBeNull();
  });
});

describe("collectAssetFileNames", () => {
  it("从文档树里收集图片附件引用", () => {
    const names = collectAssetFileNames({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        { type: "image", attrs: { src: "suiji-asset://a.png" } },
        {
          type: "collapsibleBlock",
          attrs: { title: "", open: true },
          content: [{ type: "image", attrs: { src: "suiji-asset://b.jpg" } }]
        },
        { type: "image", attrs: { src: "https://example.com/c.png" } }
      ]
    });
    expect([...names].sort()).toEqual(["a.png", "b.jpg"]);
  });

  it("空文档返回空集合", () => {
    expect(collectAssetFileNames(null).size).toBe(0);
    expect(collectAssetFileNames({ type: "doc", content: [] }).size).toBe(0);
  });
});

function noteWithContent(content: unknown, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "n1",
    title: "测试",
    excerpt: "",
    tags: [],
    folder: "",
    favoriteAt: null,
    archivedAt: null,
    trashedAt: null,
    pinnedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    content: content as NoteRecord["content"],
    html: "",
    plainText: "",
    ...overrides
  };
}

describe("collectOpenTasks", () => {
  it("汇总未勾选的待办并跳过回收站", () => {
    const notes = [
      noteWithContent({
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [{ type: "paragraph", content: [{ type: "text", text: "买牛奶" }] }]
              },
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: "已完成" }] }]
              }
            ]
          }
        ]
      }),
      noteWithContent(
        {
          type: "doc",
          content: [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "回收站里的待办" }] }]
                }
              ]
            }
          ]
        },
        { id: "n2", trashedAt: "2026-01-02T00:00:00.000Z" }
      )
    ];
    const tasks = collectOpenTasks(notes);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("买牛奶");
    expect(tasks[0].noteId).toBe("n1");
    expect(tasks[0].taskIndex).toBe(0);
  });
});

describe("toggleTaskAtIndex", () => {
  it("把第 N 个未勾选任务标记为完成，不动其它节点", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "任务一" }] }]
            },
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "已完成" }] }]
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "任务二" }] }]
            }
          ]
        }
      ]
    };
    const next = toggleTaskAtIndex(doc as never, 1) as typeof doc;
    const items = next.content[0].content!;
    expect(items[0].attrs?.checked).toBe(false);
    expect(items[1].attrs?.checked).toBe(true);
    expect(items[2].attrs?.checked).toBe(true);
    // 原树不被修改
    expect(doc.content[0].content![2].attrs?.checked).toBe(false);
  });
});

describe("matchNoteLinkTrigger", () => {
  it("识别 [[ 触发", () => {
    const trigger = matchNoteLinkTrigger("见 [[会议", 6);
    expect(trigger).toEqual({ from: 2, query: "会议" });
  });

  it("空查询也触发", () => {
    expect(matchNoteLinkTrigger("[[", 2)).toEqual({ from: 0, query: "" });
  });

  it("没有 [[ 时不触发", () => {
    expect(matchNoteLinkTrigger("普通文本", 4)).toBeNull();
    expect(matchNoteLinkTrigger("已经 [[闭合]] 了", 10)).toBeNull();
  });
});
