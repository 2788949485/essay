import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { findWebUrls, safeAutolinkPlugin } from "../src/renderer/safe-link";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {}
  },
  marks: {
    link: { attrs: { href: {} } }
  }
});

function correctLink(content: object[]) {
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content }] }),
    plugins: [safeAutolinkPlugin()]
  });
  return state.applyTransaction(state.tr.insert(state.doc.content.size - 1, schema.text(" "))).state.doc.toJSON()
    .content[0].content;
}

describe("safe link", () => {
  it.each([
    ["中文www.example.com", "www.example.com"],
    ["中文https://example.com", "https://example.com"],
    ["或者在电脑端访问www.caixuetang.cn，查看个人中心", "www.caixuetang.cn"]
  ])("只识别网址部分：%s", (text, url) => {
    expect(findWebUrls(text)).toEqual([{ from: text.indexOf(url), to: text.indexOf(url) + url.length, url }]);
  });

  it("缩短包含中文前缀的自动链接", () => {
    expect(
      correctLink([
        {
          type: "text",
          text: "中文www.example.com",
          marks: [{ type: "link", attrs: { href: "http://中文www.example.com" } }]
        }
      ])
    ).toEqual([
      { type: "text", text: "中文" },
      {
        type: "text",
        text: "www.example.com",
        marks: [{ type: "link", attrs: { href: "http://www.example.com" } }]
      },
      { type: "text", text: " " }
    ]);
  });

  it("把 https 协议补进自动链接", () => {
    expect(
      correctLink([
        { type: "text", text: "中文https://" },
        {
          type: "text",
          text: "example.com",
          marks: [{ type: "link", attrs: { href: "http://example.com" } }]
        }
      ])
    ).toEqual([
      { type: "text", text: "中文" },
      {
        type: "text",
        text: "https://example.com",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }]
      },
      { type: "text", text: " " }
    ]);
  });
});
