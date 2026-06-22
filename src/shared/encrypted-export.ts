import type { NoteRecord } from "./types.js";

export type EncryptedExportBundle =
  | {
      app: "suiji";
      kind: "note-export";
      version: 1;
      exportedAt: string;
      format: string;
      note: NoteRecord;
    }
  | {
      app: "suiji";
      kind: "batch-export";
      version: 1;
      exportedAt: string;
      format: string;
      notes: NoteRecord[];
    };

export type ParsedEncryptedExport = {
  kind: "note-export" | "batch-export";
  notes: unknown[];
};

export function parseEncryptedExportBundle(raw: unknown): ParsedEncryptedExport {
  if (!raw || typeof raw !== "object") {
    throw new Error("无效的加密导出文件");
  }

  const payload = raw as Partial<EncryptedExportBundle>;
  if (payload.app !== "suiji" || payload.version !== 1) {
    throw new Error("无效的加密导出文件");
  }

  if (payload.kind === "note-export") {
    if (!payload.note || typeof payload.note !== "object") {
      throw new Error("无效的加密导出文件");
    }
    return {
      kind: "note-export",
      notes: [payload.note]
    };
  }

  if (payload.kind === "batch-export") {
    if (!Array.isArray(payload.notes)) {
      throw new Error("无效的加密导出文件");
    }
    return {
      kind: "batch-export",
      notes: payload.notes
    };
  }

  throw new Error("无效的加密导出文件");
}
