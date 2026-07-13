import type { NoteRecord } from "./types";

export type NoteMetadataKind = "tag" | "folder";

export function removeNoteMetadata(note: NoteRecord, kind: NoteMetadataKind, value: string): NoteRecord {
  if (kind === "tag") return { ...note, tags: note.tags.filter((tag) => tag !== value) };
  return note.folder === value ? { ...note, folder: "" } : note;
}
