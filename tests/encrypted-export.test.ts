import { describe, expect, it } from "vitest";
import { parseEncryptedExportBundle } from "../src/shared/encrypted-export";

describe("parseEncryptedExportBundle", () => {
  it("解析单篇加密导出", () => {
    const result = parseEncryptedExportBundle({
      app: "suiji",
      kind: "note-export",
      version: 1,
      exportedAt: "2026-06-22T00:00:00.000Z",
      format: "md",
      note: { id: "1" }
    });

    expect(result.kind).toBe("note-export");
    expect(result.notes).toHaveLength(1);
  });

  it("解析批量加密导出", () => {
    const result = parseEncryptedExportBundle({
      app: "suiji",
      kind: "batch-export",
      version: 1,
      exportedAt: "2026-06-22T00:00:00.000Z",
      format: "json",
      notes: [{ id: "1" }, { id: "2" }]
    });

    expect(result.kind).toBe("batch-export");
    expect(result.notes).toHaveLength(2);
  });

  it("拒绝无效导出文件", () => {
    expect(() =>
      parseEncryptedExportBundle({
        app: "suiji",
        kind: "unknown",
        version: 1
      })
    ).toThrow("无效的加密导出文件");
  });
});
