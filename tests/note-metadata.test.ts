import { describe, expect, it } from "vitest";
import { removeNoteMetadata } from "../src/shared/note-metadata";
import type { NoteRecord } from "../src/shared/types";

const note = { id: "1", tags: ["大模型", "数据"], folder: "公司" } as NoteRecord;

describe("note metadata removal", () => {
  it("only removes the requested tag or folder", () => {
    expect(removeNoteMetadata(note, "tag", "大模型").tags).toEqual(["数据"]);
    expect(removeNoteMetadata(note, "folder", "公司").folder).toBe("");
    expect(removeNoteMetadata(note, "folder", "其他").folder).toBe("公司");
  });
});
