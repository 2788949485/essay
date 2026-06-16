import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BubbleMenu, EditorContent, FloatingMenu, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import {
  Archive,
  ArchiveRestore,
  Bold,
  ChevronDown,
  CheckSquare,
  Clock,
  Code2,
  Download,
  EyeOff,
  Folder,
  FolderOpen,
  Heading1,
  Heading2,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Quote,
  Redo2,
  Search,
  Star,
  StarOff,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Upload
} from "lucide-react";
import type { AppSettings, BackupEntry, BatchExportFormat, NoteRecord } from "../shared/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ExportFormat = "html" | "json" | "txt" | "md" | "pdf";
type ViewMode = "active" | "favorites" | "archive" | "trash" | "recent";
type ActiveEditor = NonNullable<ReturnType<typeof useEditor>>;

type FindMatch = {
  from: number;
  to: number;
};

type OutlineItem = {
  level: number;
  text: string;
  pos: number;
};

type BlockMenuCommand = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
};

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  icon?: "trash" | "history";
  onConfirm: () => Promise<void> | void;
};

type SearchSyntax = {
  text: string;
  tags: string[];
  folder: string;
  fav: boolean;
  archive: boolean;
  trash: boolean;
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

function formatTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function cnHotkey(value: string) {
  return value.replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
}

function parseSearchSyntax(value: string): SearchSyntax {
  const tokens = value.match(/"[^"]+"|\S+/g) ?? [];
  const syntax: SearchSyntax = { text: "", tags: [], folder: "", fav: false, archive: false, trash: false };
  const text: string[] = [];

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^"|"$/g, "");
    const lower = token.toLowerCase();
    if (lower.startsWith("tag:")) {
      const tag = token.slice(4).trim().toLowerCase();
      if (tag) syntax.tags.push(tag);
      continue;
    }
    if (lower.startsWith("folder:")) {
      syntax.folder = token.slice(7).trim().toLowerCase();
      continue;
    }
    if (lower === "fav" || lower === "favorite" || lower === "收藏") {
      syntax.fav = true;
      continue;
    }
    if (lower === "archive" || lower === "归档") {
      syntax.archive = true;
      continue;
    }
    if (lower === "trash" || lower === "回收站") {
      syntax.trash = true;
      continue;
    }
    text.push(token);
  }

  syntax.text = text.join(" ").trim().toLowerCase();
  return syntax;
}

function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let index = 0;
  let match = lower.indexOf(keyword);
  while (match >= 0) {
    if (match > index) parts.push(text.slice(index, match));
    parts.push(
      <mark key={`${match}-${keyword}`} className="search-hit">
        {text.slice(match, match + keyword.length)}
      </mark>
    );
    index = match + keyword.length;
    match = lower.indexOf(keyword, index);
  }
  if (index < text.length) parts.push(text.slice(index));
  return <>{parts}</>;
}

function extractOutline(editor: ActiveEditor | null): OutlineItem[] {
  if (!editor) return [];
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const text = node.textContent.trim();
    if (!text) return;
    items.push({ level: Number(node.attrs.level) || 1, text, pos });
  });
  return items;
}

function isEmptyParagraphSelection(editor: ActiveEditor | null) {
  if (!editor) return false;
  const { empty, $from } = editor.state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== "paragraph") return false;
  return $from.parent.textContent.trim() === "";
}

function formatHotkeyEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const normalizedKey =
    key.length === 1 ? key.toUpperCase() : key === " " ? "Space" : key.replace("Arrow", "");
  if (!parts.length || !normalizedKey) return "";
  parts.push(normalizedKey);
  return Array.from(new Set(parts)).join("+");
}

function sortNotes(notes: NoteRecord[]) {
  return [...notes].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function parseTagsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 24))
    )
  ).slice(0, 12);
}

function normalizeFolderInput(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 40);
}

function settingsPayload(settings: AppSettings, hotkey: string) {
  return {
    hotkey: hotkey.trim() || "CommandOrControl+Alt+J",
    startHidden: settings.startHidden,
    lockOnHide: settings.lockOnHide,
    launchAtLogin: settings.launchAtLogin,
    theme: settings.theme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    lineHeight: settings.lineHeight
  };
}

function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? "tool-button is-active" : "tool-button"}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export default function App() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [hotkeyStatus, setHotkeyStatus] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [privacyLocked, setPrivacyLocked] = useState(false);
  const [privacyPinDraft, setPrivacyPinDraft] = useState("");
  const [clearPrivacyPin, setClearPrivacyPin] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [ftsMatchedIds, setFtsMatchedIds] = useState<string[] | null>(null);
  const [dataActionStatus, setDataActionStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<BackupEntry[]>([]);
  const [historyStatus, setHistoryStatus] = useState("");
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [metaEditorOpen, setMetaEditorOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const outlineTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef("");
  const revisionRef = useRef(0);
  const saveStateRef = useRef<SaveState>("idle");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const activeNote = useMemo(() => notes.find((note) => note.id === activeId) ?? null, [activeId, notes]);

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    setSaveState("dirty");
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: false
      }),
      Image.configure({
        inline: false,
        allowBase64: true
      }),
      Placeholder.configure({
        placeholder: "开始记录..."
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Highlight,
      Typography
    ],
    content: activeNote?.content,
    editable: true,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "editor-surface",
        spellcheck: "false"
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const link = target?.closest("a[href]") as HTMLAnchorElement | null;
        if (!link?.href) return false;
        event.preventDefault();
        void window.suiji.openExternalLink(link.href);
        return true;
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (!isEmptyParagraphSelection(editor) || activeNote?.trashedAt) {
        setBlockMenuOpen(false);
      }
    },
    onUpdate: ({ editor }) => {
      markDirty();
      setEditorText(editor.getText());
      if (!isEmptyParagraphSelection(editor) || activeNote?.trashedAt) {
        setBlockMenuOpen(false);
      }
      if (outlineTimerRef.current) window.clearTimeout(outlineTimerRef.current);
      outlineTimerRef.current = window.setTimeout(() => {
        setOutlineItems(extractOutline(editor));
        outlineTimerRef.current = null;
      }, 250);
    }
  });

  const loadNotes = useCallback(async () => {
    const [loadedNotes, loadedSettings] = await Promise.all([window.suiji.listNotes(), window.suiji.getSettings()]);
    let nextNotes = loadedNotes;
    if (nextNotes.length === 0) {
      const created = await window.suiji.createNote();
      nextNotes = [created];
    }
    setNotes(nextNotes);
    setActiveId((current) => current || nextNotes[0]?.id || "");
    setSettings(loadedSettings);
    setHotkeyDraft(loadedSettings.hotkey);
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    return () => {
      if (outlineTimerRef.current) window.clearTimeout(outlineTimerRef.current);
    };
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (!editor || !activeNote) return;
    setTitle(activeNote.title);
    setTagsDraft(activeNote.tags.join(", "));
    setFolderDraft(activeNote.folder);
    setMetaEditorOpen(false);
    editor.commands.setContent(activeNote.content, false);
    setEditorText(editor.getText());
    setOutlineItems(extractOutline(editor));
    window.setTimeout(() => editor.commands.focus("end"), 0);
    revisionRef.current = 0;
    setSaveState("saved");
  }, [activeNote?.id, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!activeNote?.trashedAt);
  }, [activeNote?.trashedAt, editor]);

  useEffect(() => {
    if (!findOpen) return;
    findText();
  }, [findQuery, editor?.state.doc, findOpen]);

  useEffect(() => {
    const dispose = window.suiji.onNewNote(() => {
      void handleCreate();
    });
    return dispose;
  });

  useEffect(() => {
    const dispose = window.suiji.onNotesReload((id) => {
      void (async () => {
        const loaded = await window.suiji.listNotes();
        setNotes(loaded);
        if (id) setActiveId(id);
      })();
    });
    return dispose;
  }, []);

  useEffect(() => {
    const dispose = window.suiji.onPrivacyLock(() => {
      setPrivacyLocked(true);
      setUnlockPin("");
      setUnlockError("");
    });
    return dispose;
  }, []);

  useEffect(() => {
    const disposeFind = window.suiji.onOpenFind(() => {
      setFindOpen(true);
      setReplaceOpen(false);
    });
    const disposeReplace = window.suiji.onOpenReplace(() => {
      setFindOpen(true);
      setReplaceOpen(true);
    });
    return () => {
      disposeFind();
      disposeReplace();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        setReplaceOpen(false);
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setFindOpen(true);
        setReplaceOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (!editor?.isFocused) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void handleInsertImage(file);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editor]);

  useEffect(() => {
    const keyword = parseSearchSyntax(query).text;
    if (!keyword) {
      setFtsMatchedIds(null);
      return;
    }

    let canceled = false;
    const timer = window.setTimeout(() => {
      void window.suiji.searchNotes(keyword).then((ids) => {
        if (!canceled) setFtsMatchedIds(ids);
      });
    }, 120);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const saveActive = useCallback(async (options?: { skipClean?: boolean }) => {
    if (!editor || !activeNote) return;
    if (options?.skipClean && saveStateRef.current !== "dirty") {
      return activeNote;
    }

    const revisionAtStart = revisionRef.current;
    const snapshot: NoteRecord = {
      ...activeNote,
      title,
      tags: parseTagsInput(tagsDraft),
      folder: normalizeFolderInput(folderDraft),
      content: editor.getJSON(),
      html: editor.getHTML(),
      plainText: editor.getText()
    };

    const saveTask = saveQueueRef.current.then(async () => {
      if (activeIdRef.current === snapshot.id) {
        setSaveState("saving");
      }

      try {
        const saved = await window.suiji.saveNote(snapshot);
        setNotes((current) => sortNotes([saved, ...current.filter((note) => note.id !== saved.id)]));
        if (activeIdRef.current === saved.id) {
          setSaveState(revisionRef.current === revisionAtStart ? "saved" : "dirty");
        }
        return saved;
      } catch {
        if (activeIdRef.current === snapshot.id) {
          setSaveState("error");
        }
        return null;
      }
    });

    saveQueueRef.current = saveTask.then(
      () => undefined,
      () => undefined
    );

    return saveTask;
  }, [activeNote, editor, folderDraft, tagsDraft, title]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => {
      void saveActive();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [saveActive, saveState]);

  useEffect(() => {
    const disposeSave =
      typeof window.suiji.onSaveRequest === "function"
        ? window.suiji.onSaveRequest(() => {
            void saveActive();
          })
        : () => {};
    const disposeSettings =
      typeof window.suiji.onOpenSettings === "function"
        ? window.suiji.onOpenSettings(() => {
            setSettingsOpen(true);
          })
        : () => {};
    const disposeHistory =
      typeof window.suiji.onOpenHistory === "function"
        ? window.suiji.onOpenHistory(() => {
            void handleOpenHistory();
          })
        : () => {};
    const disposeExport =
      typeof window.suiji.onExportNote === "function"
        ? window.suiji.onExportNote((format) => {
            void handleExport(format);
          })
        : () => {};
    const disposeBatchExport =
      typeof window.suiji.onBatchExport === "function"
        ? window.suiji.onBatchExport((format) => {
            void handleBatchExport(format);
          })
        : () => {};
    return () => {
      disposeSave();
      disposeSettings();
      disposeHistory();
      disposeExport();
      disposeBatchExport();
    };
  }, [handleBatchExport, handleExport, handleOpenHistory, saveActive]);

  const searchSyntax = useMemo(() => parseSearchSyntax(query), [query]);
  const searchKeyword = searchSyntax.text;
  const ftsMatchedIdSet = useMemo(() => (ftsMatchedIds ? new Set(ftsMatchedIds) : null), [ftsMatchedIds]);
  const editorStats = useMemo(() => {
    const compact = editorText.replace(/\s+/g, "");
    const chars = Array.from(compact).length;
    return {
      chars,
      readingMinutes: chars ? Math.max(1, Math.ceil(chars / 500)) : 0
    };
  }, [editorText]);
  const metaTagsPreview = useMemo(() => parseTagsInput(tagsDraft), [tagsDraft]);
  const folderPreview = folderDraft.trim();
  const hasMetaInfo = metaTagsPreview.length > 0 || Boolean(folderPreview);

  const filteredNotes = useMemo(() => {
    const keyword = searchSyntax.text;
    const source =
      viewMode === "recent"
        ? [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        : sortNotes(notes);
    return source.filter((note) => {
      if (searchSyntax.trash) {
        if (!note.trashedAt) return false;
      } else {
        if (viewMode === "trash" && !note.trashedAt) return false;
        if (viewMode !== "trash" && note.trashedAt) return false;
      }
      if (viewMode === "active" && note.archivedAt && !searchSyntax.archive) return false;
      if (viewMode === "favorites" && !note.favoriteAt) return false;
      if (viewMode === "archive" && !note.archivedAt) return false;
      if (searchSyntax.fav && !note.favoriteAt) return false;
      if (searchSyntax.archive && !note.archivedAt) return false;
      if (searchSyntax.folder && !note.folder.toLowerCase().includes(searchSyntax.folder)) return false;
      if (
        searchSyntax.tags.length > 0 &&
        !searchSyntax.tags.every((tag) => note.tags.some((item) => item.toLowerCase().includes(tag)))
      ) {
        return false;
      }
      const matchesTag = !selectedTag || note.tags.includes(selectedTag);
      const matchesFolder = !selectedFolder || note.folder === selectedFolder;
      const localMatchesKeyword =
        note.title.toLowerCase().includes(keyword) ||
        note.excerpt.toLowerCase().includes(keyword) ||
        note.plainText.toLowerCase().includes(keyword) ||
        note.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
        note.folder.toLowerCase().includes(keyword);
      const matchesKeyword = !keyword || (ftsMatchedIdSet ? ftsMatchedIdSet.has(note.id) : localMatchesKeyword);
      return matchesTag && matchesFolder && matchesKeyword;
    });
  }, [ftsMatchedIdSet, notes, searchSyntax, selectedFolder, selectedTag, viewMode]);

  const allTags = useMemo(() => {
    return Array.from(new Set(notes.filter((note) => !note.trashedAt).flatMap((note) => note.tags))).sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
  }, [notes]);

  const allFolders = useMemo(() => {
    return Array.from(new Set(notes.filter((note) => !note.trashedAt && note.folder).map((note) => note.folder))).sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
  }, [notes]);

  const recentNotes = useMemo(() => {
    return [...notes]
      .filter((note) => !note.trashedAt)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 8);
  }, [notes]);

  function focusEditorSoon() {
    window.setTimeout(() => editor?.commands.focus("end"), 0);
  }

  function firstVisibleNote(source: NoteRecord[], mode = viewMode) {
    return sortNotes(source).find((note) => {
      if (mode === "trash") return Boolean(note.trashedAt);
      if (note.trashedAt) return false;
      if (mode === "favorites") return Boolean(note.favoriteAt);
      if (mode === "archive") return Boolean(note.archivedAt);
      if (mode === "active") return !note.archivedAt;
      return true;
    });
  }

  async function reloadNotes(selectMode = viewMode) {
    const loaded = await window.suiji.listNotes();
    setNotes(loaded);
    const stillVisible = firstVisibleNote(loaded.filter((note) => note.id === activeId), selectMode);
    const next = stillVisible ?? firstVisibleNote(loaded, selectMode) ?? firstVisibleNote(loaded, "active");
    setActiveId(next?.id || "");
    return loaded;
  }

  function findText(query = findQuery) {
    if (!editor || !query) {
      setFindMatches([]);
      setFindIndex(0);
      return [];
    }

    const matches: FindMatch[] = [];
    const lowerQuery = query.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const lowerText = node.text.toLowerCase();
      let index = lowerText.indexOf(lowerQuery);
      while (index >= 0) {
        matches.push({ from: pos + index, to: pos + index + query.length });
        index = lowerText.indexOf(lowerQuery, index + Math.max(query.length, 1));
      }
    });

    setFindMatches(matches);
    setFindIndex((current) => Math.min(current, Math.max(matches.length - 1, 0)));
    return matches;
  }

  function selectFindMatch(matches = findMatches, index = findIndex) {
    if (!editor || matches.length === 0) return;
    const safeIndex = (index + matches.length) % matches.length;
    const match = matches[safeIndex];
    editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).run();
    setFindIndex(safeIndex);
  }

  function handleFindNext(direction: 1 | -1 = 1) {
    const matches = findText();
    if (matches.length === 0) return;
    selectFindMatch(matches, findIndex + direction);
  }

  function handleFindSubmit() {
    const matches = findText();
    selectFindMatch(matches, 0);
  }

  function handleReplaceCurrent() {
    if (!editor || findMatches.length === 0) return;
    const match = findMatches[findIndex];
    editor.chain().focus().command(({ tr, dispatch }) => {
      tr.insertText(replaceValue, match.from, match.to);
      dispatch?.(tr);
      return true;
    }).run();
    markDirty();
    window.setTimeout(() => {
      const matches = findText();
      selectFindMatch(matches, Math.min(findIndex, Math.max(matches.length - 1, 0)));
    }, 0);
  }

  function handleReplaceAll() {
    if (!editor || !findQuery) return;
    const matches = findText();
    if (matches.length === 0) return;
    editor.chain().focus().command(({ tr, dispatch }) => {
      [...matches].reverse().forEach((match) => {
        tr.insertText(replaceValue, match.from, match.to);
      });
      dispatch?.(tr);
      return true;
    }).run();
    markDirty();
    setFindMatches([]);
    setFindIndex(0);
  }

  async function handleInsertImage(file: File | undefined) {
    if (!editor || !file) return;
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    markDirty();
  }

  async function handleCreate() {
    await saveActive({ skipClean: true });
    const created = await window.suiji.createNote();
    const note = selectedFolder
      ? await window.suiji.saveNote({ ...created, folder: selectedFolder })
      : created;
    setNotes((current) => sortNotes([note, ...current]));
    setActiveId(note.id);
    setViewMode("active");
    focusEditorSoon();
  }

  async function handleSelectNote(id: string) {
    if (id === activeId) {
      focusEditorSoon();
      return;
    }
    await saveActive({ skipClean: true });
    setActiveId(id);
    focusEditorSoon();
  }

  async function handleDeleteNote(id: string) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    setConfirmDialog({
      title: "移到回收站",
      description: `「${note.title}」会从当前列表移到回收站，你之后仍然可以恢复。`,
      confirmLabel: "移到回收站",
      tone: "danger",
      icon: "trash",
      onConfirm: async () => {
        await window.suiji.deleteNote(id);
        await reloadNotes(viewMode === "trash" ? "trash" : "active");
      }
    });
  }

  async function handleTogglePin(id: string) {
    await saveActive({ skipClean: true });
    const updated = await window.suiji.togglePinNote(id);
    setNotes((current) => sortNotes([updated, ...current.filter((note) => note.id !== updated.id)]));
  }

  async function handleToggleFavorite(id: string) {
    await saveActive({ skipClean: true });
    const updated = await window.suiji.toggleFavoriteNote(id);
    setNotes((current) => sortNotes([updated, ...current.filter((note) => note.id !== updated.id)]));
  }

  async function handleToggleArchive(id: string) {
    await saveActive({ skipClean: true });
    const updated = await window.suiji.toggleArchiveNote(id);
    setNotes((current) => sortNotes([updated, ...current.filter((note) => note.id !== updated.id)]));
    if (viewMode === "active" && updated.archivedAt) {
      await reloadNotes("active");
    }
  }

  async function handleRestoreNote(id: string) {
    const restored = await window.suiji.restoreNote(id);
    setNotes((current) => sortNotes([restored, ...current.filter((note) => note.id !== restored.id)]));
    setActiveId(restored.id);
    setViewMode("active");
  }

  async function handlePurgeNote(id: string) {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    setConfirmDialog({
      title: "永久删除记录",
      description: `「${note.title}」会被彻底删除，历史版本和内容都无法恢复。`,
      confirmLabel: "永久删除",
      tone: "danger",
      icon: "trash",
      onConfirm: async () => {
        await window.suiji.purgeNote(id);
        await reloadNotes("trash");
      }
    });
  }

  async function handleExport(format: ExportFormat) {
    await saveActive({ skipClean: true });
    if (!activeNote || !editor) return;
    await window.suiji.exportNote({
      note: {
        ...activeNote,
        title,
        tags: parseTagsInput(tagsDraft),
        folder: normalizeFolderInput(folderDraft),
        content: editor.getJSON(),
        html: editor.getHTML(),
        plainText: editor.getText()
      },
      format
    });
  }

  async function handleBatchExport(format: BatchExportFormat) {
    setDataActionStatus("正在批量导出...");
    await saveActive({ skipClean: true });
    const result = await window.suiji.batchExportNotes(format);
    setDataActionStatus(result ? `已导出 ${result.count} 条：${result.directory}` : "已取消批量导出");
  }

  async function handleImportMarkdown() {
    setDataActionStatus("正在导入 Markdown...");
    await saveActive({ skipClean: true });
    const imported = await window.suiji.importMarkdownNotes();
    if (imported.length === 0) {
      setDataActionStatus("已取消 Markdown 导入");
      return;
    }
    const loaded = await window.suiji.listNotes();
    setNotes(loaded);
    setActiveId(imported[0].id);
    setViewMode("active");
    setDataActionStatus(`已导入 ${imported.length} 个 Markdown 文件`);
  }

  async function handleHotkeyRecord(event: React.KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();
    const next = formatHotkeyEvent(event);
    if (!next) {
      setHotkeyStatus("继续按下带 Ctrl/Alt/Shift 的完整组合键");
      return;
    }
    setHotkeyDraft(next);
    setHotkeyStatus("正在检测冲突...");
    const available = await window.suiji.testHotkey(next);
    setHotkeyStatus(available ? "快捷键可用" : "快捷键可能已被占用，建议更换");
  }

  function jumpToOutline(item: OutlineItem) {
    if (!editor) return;
    const targetPos = Math.min(item.pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
    window.requestAnimationFrame(() => {
      const wrap = editorWrapRef.current;
      if (!wrap) return;
      const coords = editor.view.coordsAtPos(targetPos);
      const wrapRect = wrap.getBoundingClientRect();
      const top = coords.top - wrapRect.top + wrap.scrollTop - 24;
      wrap.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }

  async function handleSettingsSave() {
    const next = await window.suiji.updateSettings({
      ...settingsPayload(
        settings ?? {
          hotkey: "CommandOrControl+Alt+J",
          startHidden: false,
          lockOnHide: true,
          hasPrivacyPin: false,
          launchAtLogin: false,
          theme: "light",
          fontFamily: "",
          fontSize: 16,
          lineWidth: 880,
          lineHeight: 1.72
        },
        hotkeyDraft
      ),
      privacyPin: privacyPinDraft.trim() || undefined,
      clearPrivacyPin
    });
    setSettings(next);
    setHotkeyDraft(next.hotkey);
    setHotkeyStatus("");
    setPrivacyPinDraft("");
    setClearPrivacyPin(false);
    setSettingsOpen(false);
  }

  async function handleBackupAllNotes() {
    setDataActionStatus("正在备份...");
    await saveActive({ skipClean: true });
    const filePath = await window.suiji.backupAllNotes();
    setDataActionStatus(filePath ? `备份已保存：${filePath}` : "已取消备份");
  }

  async function handleRestoreNotesBackup() {
    setDataActionStatus("正在恢复...");
    await saveActive({ skipClean: true });
    const result = await window.suiji.restoreNotesBackup();
    if (!result) {
      setDataActionStatus("已取消恢复");
      return;
    }

    const loadedNotes = await window.suiji.listNotes();
    let nextNotes = loadedNotes;
    if (nextNotes.length === 0) {
      const created = await window.suiji.createNote();
      nextNotes = [created];
    }
    const nextActive = nextNotes.find((note) => note.id === activeId) ?? nextNotes[0];
    setNotes(nextNotes);
    setActiveId(nextActive?.id || "");
    if (nextActive && editor) {
      setTitle(nextActive.title);
      setTagsDraft(nextActive.tags.join(", "));
      setFolderDraft(nextActive.folder);
      editor.commands.setContent(nextActive.content, false);
      setEditorText(editor.getText());
      setOutlineItems(extractOutline(editor));
      revisionRef.current = 0;
      setSaveState("saved");
    }
    setDataActionStatus(`恢复完成：导入 ${result.imported}/${result.total} 条，跳过 ${result.skipped} 条`);
  }

  async function handleOpenDataFolder() {
    const error = await window.suiji.openDataFolder();
    setDataActionStatus(error ? `打开失败：${error}` : "已打开本地数据目录");
  }

  async function handleChangeDataFolder() {
    setDataActionStatus("正在选择数据目录...");
    const dataPath = await window.suiji.changeDataFolder();
    if (!dataPath) {
      setDataActionStatus("已取消修改数据目录");
      return;
    }

    const loaded = await reloadNotes("active");
    if (loaded.length === 0) {
      const created = await window.suiji.createNote();
      setNotes([created]);
      setActiveId(created.id);
    }
    const loadedSettings = await window.suiji.getSettings();
    setSettings(loadedSettings);
    setHotkeyDraft(loadedSettings.hotkey);
    setViewMode("active");
    setSelectedFolder("");
    setSelectedTag("");
    setDataActionStatus(`数据目录已切换：${dataPath}`);
  }

  async function handleOpenHistory() {
    if (!activeNote) return;
    setHistoryStatus("正在读取历史版本...");
    setHistoryOpen(true);
    const entries = await window.suiji.listNoteBackups(activeNote.id);
    setHistoryEntries(entries);
    setHistoryStatus(entries.length ? "" : "暂无可恢复的历史版本");
  }

  async function handleRestoreHistory(entry: BackupEntry) {
    if (!activeNote) return;
    setConfirmDialog({
      title: "恢复历史版本",
      description: "当前内容会先自动备份，然后用这个历史版本覆盖编辑区。",
      confirmLabel: "确认恢复",
      tone: "default",
      icon: "history",
      onConfirm: async () => {
        const restored = await window.suiji.restoreNoteBackup(activeNote.id, entry.fileName);
        setNotes((current) => sortNotes([restored, ...current.filter((note) => note.id !== restored.id)]));
        setActiveId(restored.id);
        setTitle(restored.title);
        setTagsDraft(restored.tags.join(", "));
        setFolderDraft(restored.folder);
        editor?.commands.setContent(restored.content, false);
        if (editor) {
          setEditorText(editor.getText());
          setOutlineItems(extractOutline(editor));
        }
        revisionRef.current = 0;
        setSaveState("saved");
        setHistoryOpen(false);
      }
    });
  }

  async function handleUnlock() {
    if (!settings?.hasPrivacyPin) {
      setPrivacyLocked(false);
      setUnlockError("");
      focusEditorSoon();
      return;
    }

    const ok = await window.suiji.verifyPrivacyPin(unlockPin);
    if (!ok) {
      setUnlockError("密码不正确");
      return;
    }
    setPrivacyLocked(false);
    setUnlockPin("");
    setUnlockError("");
    focusEditorSoon();
  }

  function handleLink() {
    if (!editor) return;

    const current = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址", current || "https://");
    if (url === null) return;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    const { from, to, empty } = editor.state.selection;
    if (empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: trimmedUrl,
          marks: [{ type: "link", attrs: { href: trimmedUrl } }]
        })
        .run();
      return;
    }

    editor.chain().focus().setTextSelection({ from, to }).extendMarkRange("link").setLink({ href: trimmedUrl }).run();
  }

  const blockMenuCommands: BlockMenuCommand[] = [
    {
      id: "heading-1",
      label: "一级标题",
      hint: "大标题",
      run: () => editor?.chain().focus().toggleHeading({ level: 1 }).run()
    },
    {
      id: "heading-2",
      label: "二级标题",
      hint: "分节标题",
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run()
    },
    {
      id: "bullet-list",
      label: "项目列表",
      hint: "无序列表",
      run: () => editor?.chain().focus().toggleBulletList().run()
    },
    {
      id: "ordered-list",
      label: "编号列表",
      hint: "有序列表",
      run: () => editor?.chain().focus().toggleOrderedList().run()
    },
    {
      id: "task-list",
      label: "任务列表",
      hint: "待办事项",
      run: () => editor?.chain().focus().toggleTaskList().run()
    },
    {
      id: "blockquote",
      label: "引用",
      hint: "强调段落",
      run: () => editor?.chain().focus().toggleBlockquote().run()
    },
    {
      id: "code-block",
      label: "代码块",
      hint: "输入代码",
      run: () => editor?.chain().focus().toggleCodeBlock().run()
    },
    {
      id: "divider",
      label: "分割线",
      hint: "插入分隔",
      run: () => editor?.chain().focus().setHorizontalRule().run()
    },
    {
      id: "image",
      label: "图片",
      hint: "选择本地图片",
      run: () => imageInputRef.current?.click()
    }
  ];

  function applyBlockMenuCommand(command: BlockMenuCommand) {
    setBlockMenuOpen(false);
    command.run();
  }

  function closeConfirmDialog() {
    if (confirmBusy) return;
    setConfirmDialog(null);
  }

  async function runConfirmDialog() {
    if (!confirmDialog || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const statusText =
    saveState === "saving"
      ? "保存中"
      : saveState === "dirty"
        ? "有修改"
        : saveState === "error"
          ? "保存失败"
          : "已保存";

  const appClassName = [
    "app-shell",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    settings?.theme === "dark" ? "theme-dark" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const appStyle = {
    "--editor-width": `${settings?.lineWidth ?? 880}px`,
    "--editor-font-family": settings?.fontFamily?.trim() || undefined,
    "--editor-font-size": `${settings?.fontSize ?? 16}px`,
    "--editor-line-height": settings?.lineHeight ?? 1.72
  } as React.CSSProperties;

  return (
    <main className={appClassName} style={appStyle}>
      <aside className="sidebar">
        {sidebarCollapsed ? (
          <div className="sidebar-rail">
            <button
              className="icon-button"
              title="展开侧边栏"
              aria-label="展开侧边栏"
              onClick={() => setSidebarCollapsed(false)}
              type="button"
            >
              <PanelLeftOpen size={18} />
            </button>
            <button className="icon-button primary-icon" title="新记录" aria-label="新记录" onClick={() => void handleCreate()} type="button">
              <Plus size={18} />
            </button>
            <button className="icon-button" title="隐藏窗口" aria-label="隐藏窗口" onClick={() => window.suiji.hideWindow()} type="button">
              <EyeOff size={18} />
            </button>
          </div>
        ) : (
          <>
        <div className="brand-row">
          <div>
            <h1>随记</h1>
            <p>{settings ? cnHotkey(settings.hotkey) : "Ctrl + Alt + J"} 呼出</p>
          </div>
          <div className="brand-actions">
            <button
              className="icon-button"
              title="收起侧边栏"
              aria-label="收起侧边栏"
              onClick={() => setSidebarCollapsed(true)}
              type="button"
            >
              <PanelLeftClose size={18} />
            </button>
            <button className="icon-button" title="隐藏窗口" aria-label="隐藏窗口" onClick={() => window.suiji.hideWindow()} type="button">
              <EyeOff size={18} />
            </button>
          </div>
        </div>

        <div className="search-box">
          <Search size={17} />
          <div className="search-box-body">
            <span className="search-box-label">检索</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" />
          </div>
        </div>

        <div className="sidebar-section-label">视图</div>
        <div className="view-switch" aria-label="记录视图">
          {[
            ["active", "记录", List],
            ["favorites", "收藏", Star],
            ["archive", "归档", Archive],
            ["trash", "回收站", Trash2],
            ["recent", "最近", Clock]
          ].map(([mode, label, Icon]) => (
            <button
              key={String(mode)}
              type="button"
              className={viewMode === mode ? "is-active" : ""}
              onClick={() => {
                const nextMode = mode as ViewMode;
                setViewMode(nextMode);
                const next = firstVisibleNote(notes, nextMode);
                if (next) setActiveId(next.id);
              }}
            >
              <Icon size={14} />
              {String(label)}
            </button>
          ))}
        </div>

        {allFolders.length > 0 ? (
          <div className="folder-filter" aria-label="文件夹筛选">
            <button
              type="button"
              className={selectedFolder ? "" : "is-active"}
              onClick={() => setSelectedFolder("")}
            >
              <Folder size={13} />
              全部文件夹
            </button>
            {allFolders.map((folder) => (
              <button
                key={folder}
                type="button"
                className={selectedFolder === folder ? "is-active" : ""}
                onClick={() => setSelectedFolder(folder)}
              >
                <Folder size={13} />
                {folder}
              </button>
            ))}
          </div>
        ) : null}

        {allTags.length > 0 ? (
          <div className="tag-filter" aria-label="标签筛选">
            <button
              type="button"
              className={selectedTag ? "" : "is-active"}
              onClick={() => setSelectedTag("")}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={selectedTag === tag ? "is-active" : ""}
                onClick={() => setSelectedTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <button className="new-note-button" type="button" onClick={handleCreate}>
          <Plus size={18} />
          新记录
        </button>

        {viewMode === "recent" ? (
          <div className="recent-timeline" aria-label="最近编辑时间线">
            {recentNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={note.id === activeId ? "is-active" : ""}
                onClick={() => void handleSelectNote(note.id)}
              >
                <span>{formatTime(note.updatedAt)}</span>
                <strong>
                  <HighlightedText text={note.title} keyword={searchKeyword} />
                </strong>
              </button>
            ))}
          </div>
        ) : null}

        <div className="sidebar-list-header">
          <span>{viewMode === "recent" ? "最近编辑" : "记录列表"}</span>
          <strong>{viewMode === "recent" ? recentNotes.length : filteredNotes.length}</strong>
        </div>

        <nav className="note-list">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className={note.id === activeId ? "note-item is-active" : "note-item"}
              role="button"
              tabIndex={0}
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLElement) || event.target.closest("button")) return;
                event.preventDefault();
              }}
              onClick={() => void handleSelectNote(note.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleSelectNote(note.id);
                }
              }}
            >
              <div className="note-item-header">
                <span className="note-title">
                  {note.pinnedAt ? <Pin size={13} className="note-pin-mark" /> : null}
                  <span className="note-title-text">
                    <HighlightedText text={note.title} keyword={searchKeyword} />
                  </span>
                </span>
                <div className="note-actions">
                  <button
                    type="button"
                    title={note.pinnedAt ? "取消置顶" : "置顶"}
                    aria-label={note.pinnedAt ? "取消置顶" : "置顶"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleTogglePin(note.id);
                    }}
                  >
                    {note.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  {note.trashedAt ? (
                    <>
                      <button
                        type="button"
                        title="恢复记录"
                        aria-label="恢复记录"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRestoreNote(note.id);
                        }}
                      >
                        <ArchiveRestore size={14} />
                      </button>
                      <button
                        type="button"
                        title="永久删除"
                        aria-label="永久删除"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handlePurgeNote(note.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        title={note.favoriteAt ? "取消收藏" : "收藏"}
                        aria-label={note.favoriteAt ? "取消收藏" : "收藏"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleFavorite(note.id);
                        }}
                      >
                        {note.favoriteAt ? <StarOff size={14} /> : <Star size={14} />}
                      </button>
                      <button
                        type="button"
                        title={note.archivedAt ? "取消归档" : "归档"}
                        aria-label={note.archivedAt ? "取消归档" : "归档"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleArchive(note.id);
                        }}
                      >
                        {note.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="移到回收站"
                    aria-label="移到回收站"
                    disabled={Boolean(note.trashedAt)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteNote(note.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {note.folder || note.tags.length > 0 ? (
                <div className="note-meta">
                  {note.folder ? (
                    <span className="note-folder">
                      <Folder size={12} />
                      {note.folder}
                    </span>
                  ) : null}
                  {note.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="note-tag">
                      <HighlightedText text={tag} keyword={searchKeyword} />
                    </span>
                  ))}
                </div>
              ) : null}
              <span className="note-excerpt">
                <HighlightedText text={note.excerpt || "空记录"} keyword={searchKeyword} />
              </span>
              <span className="note-time">{formatTime(note.updatedAt)}</span>
            </div>
          ))}
        </nav>
          </>
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-group">
            <input
              className="title-input"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
              placeholder="未命名记录"
            />
            <div className="meta-summary-row">
              <button
                type="button"
                className={metaEditorOpen ? "meta-summary is-open" : "meta-summary"}
                onClick={() => setMetaEditorOpen((current) => !current)}
              >
                {folderPreview ? <span className="meta-chip meta-folder-chip">文件夹 · {folderPreview}</span> : null}
                {metaTagsPreview.slice(0, 3).map((tag) => (
                  <span key={tag} className="meta-chip">
                    {tag}
                  </span>
                ))}
                {metaTagsPreview.length > 3 ? <span className="meta-chip">+{metaTagsPreview.length - 3}</span> : null}
                {!hasMetaInfo ? <span className="meta-summary-empty">添加标签和文件夹</span> : null}
                <span className="meta-summary-action">{metaEditorOpen ? "收起属性" : "编辑属性"}</span>
              </button>
            </div>
            {metaEditorOpen ? (
              <div className="meta-input-row">
                <input
                  className="tags-input"
                  value={tagsDraft}
                  onChange={(event) => {
                    setTagsDraft(event.target.value);
                    markDirty();
                  }}
                  placeholder="标签，用逗号分隔"
                />
                <input
                  className="folder-input"
                  value={folderDraft}
                  onChange={(event) => {
                    setFolderDraft(event.target.value);
                    markDirty();
                  }}
                  placeholder="文件夹"
                />
              </div>
            ) : null}
          </div>
          <div className="topbar-actions">
            <div className="topbar-statuses">
              <span className={`save-status ${saveState}`}>{statusText}</span>
              <span className="doc-stats">
                {editorStats.chars} 字 · 阅读 {editorStats.readingMinutes} 分钟
              </span>
            </div>
          </div>
        </header>

        {findOpen ? (
          <div className="find-panel">
            <div className="find-inputs">
              <input
                value={findQuery}
                autoFocus
                placeholder="查找"
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleFindNext(event.shiftKey ? -1 : 1);
                  }
                  if (event.key === "Escape") {
                    setFindOpen(false);
                    focusEditorSoon();
                  }
                }}
              />
              {replaceOpen ? (
                <input
                  value={replaceValue}
                  placeholder="替换为"
                  onChange={(event) => setReplaceValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleReplaceCurrent();
                    }
                  }}
                />
              ) : null}
            </div>
            <span className="find-count">
              {findQuery ? `${findMatches.length ? findIndex + 1 : 0}/${findMatches.length}` : "0/0"}
            </span>
            <button type="button" onClick={() => handleFindNext(-1)}>
              上一个
            </button>
            <button type="button" onClick={() => handleFindNext(1)}>
              下一个
            </button>
            <button type="button" onClick={() => setReplaceOpen((current) => !current)}>
              替换
            </button>
            {replaceOpen ? (
              <>
                <button type="button" onClick={handleReplaceCurrent}>
                  替换当前
                </button>
                <button type="button" onClick={handleReplaceAll}>
                  全部替换
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label="关闭查找"
              onClick={() => {
                setFindOpen(false);
                focusEditorSoon();
              }}
            >
              关闭
            </button>
          </div>
        ) : null}

        <div
          ref={editorWrapRef}
          className="editor-wrap"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              editor?.commands.focus("end");
            }
          }}
          onClick={() => editor?.commands.focus()}
        >
          <input
            ref={imageInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void handleInsertImage(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {editor ? (
            <FloatingMenu
              editor={editor}
              tippyOptions={{ duration: 120, placement: "left-start", maxWidth: "none", offset: [0, 8] }}
              shouldShow={({ editor }) => isEmptyParagraphSelection(editor) && !activeNote?.trashedAt}
            >
              <div className="block-insert-anchor">
                <button
                  type="button"
                  className={blockMenuOpen ? "block-insert-trigger is-open" : "block-insert-trigger"}
                  aria-label="插入块"
                  title="插入块"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setBlockMenuOpen((current) => !current);
                  }}
                >
                  <Plus size={15} />
                </button>
                {blockMenuOpen ? (
                  <div className="block-insert-menu" aria-label="块格式菜单">
                    {blockMenuCommands.map((command) => (
                      <button
                        key={command.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyBlockMenuCommand(command);
                        }}
                      >
                        <strong>{command.label}</strong>
                        <span>{command.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FloatingMenu>
          ) : null}
          {editor ? (
            <BubbleMenu
              editor={editor}
              tippyOptions={{ duration: 120, placement: "top", maxWidth: "none" }}
              shouldShow={({ editor }) => {
                const { empty } = editor.state.selection;
                return !empty && !activeNote?.trashedAt;
              }}
            >
              <div className="selection-toolbar" aria-label="文本格式工具">
                <ToolbarButton title="一级标题" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                  <Heading1 size={16} />
                </ToolbarButton>
                <ToolbarButton title="二级标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                  <Heading2 size={16} />
                </ToolbarButton>
                <span className="selection-toolbar-separator" />
                <ToolbarButton title="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
                  <Bold size={16} />
                </ToolbarButton>
                <ToolbarButton title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <Italic size={16} />
                </ToolbarButton>
                <ToolbarButton title="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                  <UnderlineIcon size={16} />
                </ToolbarButton>
                <ToolbarButton title="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
                  <Strikethrough size={16} />
                </ToolbarButton>
                <ToolbarButton title="高亮" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
                  <Highlighter size={16} />
                </ToolbarButton>
                <ToolbarButton title="链接" active={editor.isActive("link")} onClick={handleLink}>
                  <Link2 size={16} />
                </ToolbarButton>
                <span className="selection-toolbar-separator" />
                <ToolbarButton title="项目列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                  <List size={16} />
                </ToolbarButton>
                <ToolbarButton title="编号列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                  <ListOrdered size={16} />
                </ToolbarButton>
                <ToolbarButton title="任务列表" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
                  <CheckSquare size={16} />
                </ToolbarButton>
                <ToolbarButton title="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                  <Quote size={16} />
                </ToolbarButton>
                <ToolbarButton title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
                  <Code2 size={16} />
                </ToolbarButton>
              </div>
            </BubbleMenu>
          ) : null}
          {editor ? <EditorContent editor={editor} /> : null}
        </div>
        {outlineItems.length > 0 ? (
          <aside className={outlineCollapsed ? "outline-panel is-collapsed" : "outline-panel"} aria-label="大纲目录">
            <div className="outline-header">
              <strong>大纲</strong>
              <button
                type="button"
                className="outline-toggle"
                title={outlineCollapsed ? "展开大纲" : "收起大纲"}
                aria-label={outlineCollapsed ? "展开大纲" : "收起大纲"}
                aria-expanded={!outlineCollapsed}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOutlineCollapsed((current) => !current)}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            {!outlineCollapsed
              ? outlineItems.map((item, index) => (
                  <button
                    key={`${item.pos}-${index}`}
                    type="button"
                    className={`outline-level-${item.level}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => jumpToOutline(item)}
                  >
                    {item.text}
                  </button>
                ))
              : null}
          </aside>
        ) : null}
      </section>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-kicker">偏好与数据</span>
              <h2>设置</h2>
              <p className="modal-description">统一管理快捷键、隐私保护和本地数据目录。</p>
            </div>
            <label>
              <span>全局快捷键</span>
              <input
                value={hotkeyDraft}
                readOnly
                onKeyDown={(event) => void handleHotkeyRecord(event)}
                onFocus={() => setHotkeyStatus("按下新的快捷键组合")}
              />
              {hotkeyStatus ? <small className="setting-hint">{hotkeyStatus}</small> : null}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings?.startHidden ?? false}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, startHidden: event.target.checked } : current
                  )
                }
              />
              <span>启动后隐藏到托盘</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings?.launchAtLogin ?? false}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, launchAtLogin: event.target.checked } : current
                  )
                }
              />
              <span>开机自动启动</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings?.lockOnHide ?? true}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, lockOnHide: event.target.checked } : current
                  )
                }
              />
              <span>隐藏后重新打开时保护内容</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings?.theme === "dark"}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, theme: event.target.checked ? "dark" : "light" } : current
                  )
                }
              />
              <span>深色模式</span>
            </label>
            <label>
              <span>{settings?.hasPrivacyPin ? "更换隐私密码" : "设置隐私密码"}</span>
              <input
                type="password"
                value={privacyPinDraft}
                onChange={(event) => {
                  setPrivacyPinDraft(event.target.value);
                  setClearPrivacyPin(false);
                }}
                placeholder={settings?.hasPrivacyPin ? "留空则不修改" : "可选，留空则点击解锁"}
              />
            </label>
            {settings?.hasPrivacyPin ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={clearPrivacyPin}
                  onChange={(event) => {
                    setClearPrivacyPin(event.target.checked);
                    if (event.target.checked) setPrivacyPinDraft("");
                  }}
                />
                <span>移除隐私密码</span>
              </label>
            ) : null}
            <section className="data-tools" aria-label="数据管理">
              <h3>数据管理</h3>
              <div className="data-tool-grid">
                <button type="button" onClick={() => void handleBackupAllNotes()}>
                  <Download size={16} />
                  备份全部
                </button>
                <button type="button" onClick={() => void handleRestoreNotesBackup()}>
                  <Upload size={16} />
                  恢复备份
                </button>
                <button type="button" onClick={() => void handleImportMarkdown()}>
                  <Upload size={16} />
                  导入 MD
                </button>
                <button type="button" onClick={() => void handleOpenDataFolder()}>
                  <FolderOpen size={16} />
                  数据目录
                </button>
                <button type="button" onClick={() => void handleChangeDataFolder()}>
                  <Folder size={16} />
                  修改目录
                </button>
              </div>
              {dataActionStatus ? <p>{dataActionStatus}</p> : null}
            </section>
            <div className="modal-actions">
              <button type="button" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button type="button" className="primary" onClick={() => void handleSettingsSave()}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <div className="modal history-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-kicker">文稿回溯</span>
              <h2>版本历史</h2>
              <p className="modal-description">选择一个历史快照恢复，当前内容会先自动备份。</p>
            </div>
            {historyStatus ? <p className="history-status">{historyStatus}</p> : null}
            <div className="history-list">
              {historyEntries.map((entry) => (
                <div key={entry.fileName} className="history-item">
                  <div>
                    <strong>{formatTime(entry.createdAt)}</strong>
                    <span>{entry.prefix} · {Math.max(1, Math.round(entry.size / 1024))} KB</span>
                  </div>
                  <button type="button" onClick={() => void handleRestoreHistory(entry)}>
                    恢复
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setHistoryOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeConfirmDialog}>
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className={confirmDialog.tone === "danger" ? "confirm-icon danger" : "confirm-icon"}>
              {confirmDialog.icon === "history" ? <ArchiveRestore size={20} /> : <Trash2 size={20} />}
            </div>
            <div className="confirm-copy">
              <h2>{confirmDialog.title}</h2>
              <p>{confirmDialog.description}</p>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={closeConfirmDialog} disabled={confirmBusy}>
                取消
              </button>
              <button
                type="button"
                className={confirmDialog.tone === "danger" ? "danger-primary" : "primary"}
                onClick={() => void runConfirmDialog()}
                disabled={confirmBusy}
              >
                {confirmBusy ? "处理中..." : confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {privacyLocked ? (
        <div className="privacy-lock" role="dialog" aria-modal="true">
          <div className="privacy-panel">
            <Lock size={34} />
            <h2>内容已保护</h2>
            <p>窗口隐藏后已遮挡笔记内容，解锁后继续编辑。</p>
            {settings?.hasPrivacyPin ? (
              <input
                type="password"
                value={unlockPin}
                autoFocus
                placeholder="输入隐私密码"
                onChange={(event) => {
                  setUnlockPin(event.target.value);
                  setUnlockError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleUnlock();
                }}
              />
            ) : null}
            {unlockError ? <span className="privacy-error">{unlockError}</span> : null}
            <button type="button" onClick={() => void handleUnlock()}>
              解锁
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

