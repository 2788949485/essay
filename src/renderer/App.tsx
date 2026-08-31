import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { CodeBlockExtension } from "./editor/code-block";
import { common, createLowlight } from "lowlight";
import { SafeAutolink } from "./safe-link";
import { MathExtensions } from "./math-extension";
import { removeNoteMetadata, type NoteMetadataKind } from "../shared/note-metadata";
import type { AppSettings, BackupEntry, BatchExportFormat, NoteRecord } from "../shared/types";
import {
  DEFAULT_APP_SETTINGS,
  FONT_PRESETS,
  FORMAT_COLORS,
  type BlockMenuCommand,
  type ConfirmDialogState,
  type ExportFormat,
  type FindMatch,
  type FontPresetId,
  type LeftPaneMode,
  type LinkDialogState,
  type OutlineItem,
  type SaveState,
  type ViewMode
} from "./constants";
import {
  buildPlainTextBlocks,
  collectOpenTasks,
  describeRestoreFailures,
  extractOutline,
  formatHotkeyEvent,
  getContentPlainText,
  getCurrentFontPresetId,
  isEmptyParagraphSelection,
  normalizeFolderInput,
  normalizeLinkUrl,
  parseSearchSyntax,
  parseTagsInput,
  settingsPayload,
  sortNotes,
  splitPastedMath,
  toggleTaskAtIndex,
  type OpenTask
} from "./utils/text";
import { BlockFormatExtension, getCurrentBlockFormat } from "./editor/block-format";
import { CollapsibleBlockExtensions } from "./editor/collapsible-block";
import { FindHighlightExtension, clearFindHighlights, setFindHighlights } from "./editor/find-highlight";
import { findInteractiveEditorBlock } from "./editor/interactive-blocks";
import { NoteLinkSuggestionExtension } from "./editor/note-link-suggestion";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { FindPanel } from "./components/FindPanel";
import { FormatPanel } from "./components/FormatPanel";
import { EditorArea } from "./components/EditorArea";
import { SettingsModal } from "./components/SettingsModal";
import { CommandPalette, type CommandPaletteItem } from "./components/CommandPalette";
import { ConfirmDialog, HistoryModal, LinkDialog, PrivacyLock, PromptDialog } from "./components/Modals";

type ActiveEditor = NonNullable<ReturnType<typeof useEditor>>;

const lowlight = createLowlight(common);

// 各视图按各自的语义时间排序：回收站按删除时间、收藏按收藏时间、归档按归档时间、最近按编辑时间
const VIEW_TIME_FIELD: Partial<Record<ViewMode, "trashedAt" | "favoriteAt" | "archivedAt" | "updatedAt">> = {
  trash: "trashedAt",
  favorites: "favoriteAt",
  archive: "archivedAt",
  recent: "updatedAt"
};

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
  const [isFloatingToolViewport, setIsFloatingToolViewport] = useState(() => window.innerWidth < 1280);
  const [isCompactViewport, setIsCompactViewport] = useState(() => window.innerWidth < 980);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 980);
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>("document");
  const [formatPanelExpanded, setFormatPanelExpanded] = useState(() => window.innerWidth >= 1280);
  const [privacyLocked, setPrivacyLocked] = useState(false);
  const [currentPrivacyPinDraft, setCurrentPrivacyPinDraft] = useState("");
  const [privacyPinDraft, setPrivacyPinDraft] = useState("");
  const [clearPrivacyPin, setClearPrivacyPin] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
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
  const [editorText, setEditorText] = useState("");
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [tableToolbarVisible, setTableToolbarVisible] = useState(false);
  const [metaEditorOpen, setMetaEditorOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tagRename, setTagRename] = useState<{ from: string; draft: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const currentBlockRef = useRef<HTMLElement | null>(null);
  const outlineTimerRef = useRef<number | null>(null);
  const settingsSnapshotRef = useRef<AppSettings | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const editorUiSigRef = useRef("");
  const [, setEditorUiTick] = useState(0);
  const activeIdRef = useRef("");
  const notesRef = useRef<NoteRecord[]>([]);
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
        heading: { levels: [1, 2, 3] },
        // 代码块交给 CodeBlockLowlight 以获得语法高亮
        codeBlock: false
      }),
      CodeBlockExtension.configure({ lowlight, defaultLanguage: null }),
      BlockFormatExtension,
      FindHighlightExtension,
      ...CollapsibleBlockExtensions,
      ...MathExtensions,
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: false
      }),
      SafeAutolink,
      Image.configure({
        inline: false,
        allowBase64: true
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({
        types: ["heading", "paragraph"]
      }),
      Placeholder.configure({
        placeholder: "开始记录..."
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Highlight,
      Typography,
      NoteLinkSuggestionExtension.configure({
        getNotes: () => notesRef.current.filter((note) => !note.trashedAt)
      })
    ],
    content: activeNote?.content,
    editable: true,
    autofocus: "end",
    // 关闭 tiptap 默认的"每次 transaction 重渲染"：拖选时每秒几十个 transaction
    // 会导致整个 App 重渲染、选区闪烁。UI 状态改为按签名变化才刷新（见 refreshEditorUi）
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "editor-surface",
        spellcheck: "false"
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const href = (target?.closest("a[href]") as HTMLAnchorElement | null)?.getAttribute("href") ?? "";
        if (!href) return false;
        event.preventDefault();
        // 笔记互链：suiji-note://<id> 直接在应用内跳转
        if (href.startsWith("suiji-note://")) {
          const id = decodeURIComponent(href.slice("suiji-note://".length));
          if (notesRef.current.some((note) => note.id === id)) void handleSelectNote(id);
          return true;
        }
        void window.suiji.openExternalLink(href);
        return true;
      },
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;
        // 图片文件优先走落盘通道，必须在 tiptap 默认 HTML 解析之前拦截，
        // 否则 Chromium 会把剪贴板图片以 data: URI 内联进文档
        const imageFile = Array.from(clipboardData.files).find((item) => item.type.startsWith("image/"));
        if (imageFile) {
          event.preventDefault();
          void handleInsertImage(imageFile);
          return true;
        }
        const text = clipboardData.getData("text/plain") ?? "";
        const html = clipboardData.getData("text/html") ?? "";
        const segments = splitPastedMath(text);
        if (segments) {
          event.preventDefault();
          const segNodes = segments.map((segment) => view.state.schema.nodeFromJSON(segment));
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(segNodes), 0, 0)).scrollIntoView());
          return true;
        }
        // 剪贴板不是富文本(PDF、纯文本源):按语义合并视觉换行,避免一段被拆成多段
        const isRichHtml =
          /<\/?(?:h[1-6]|ul|ol|li|table|tr|td|th|b|strong|i|em|u|a\b|img|blockquote|span|font)\b/i.test(html);
        if (text && !isRichHtml) {
          const blocks = buildPlainTextBlocks(text);
          if (blocks.length) {
            event.preventDefault();
            const blockNodes = blocks.map((block) => view.state.schema.nodeFromJSON(block));
            view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(blockNodes), 1, 1)).scrollIntoView());
            return true;
          }
        }
        return false;
      }
    },
    onTransaction: ({ editor }) => {
      // 覆盖选区移动、文档修改、storedMarks（空选区切换加粗等）全部 UI 相关变化
      refreshEditorUi(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      setTableToolbarVisible(editor.isActive("table") && !activeNote?.trashedAt);
      if (!isEmptyParagraphSelection(editor) || activeNote?.trashedAt) {
        setBlockMenuOpen(false);
      }
      window.requestAnimationFrame(syncCurrentEditorBlock);
    },
    onUpdate: ({ editor }) => {
      markDirty();
      setTableToolbarVisible(editor.isActive("table") && !activeNote?.trashedAt);
      if (!isEmptyParagraphSelection(editor) || activeNote?.trashedAt) {
        setBlockMenuOpen(false);
      }
      if (outlineTimerRef.current) window.clearTimeout(outlineTimerRef.current);
      outlineTimerRef.current = window.setTimeout(() => {
        setEditorText(getContentPlainText(editor.getJSON()));
        setOutlineItems(extractOutline(editor));
        outlineTimerRef.current = null;
      }, 250);
      window.requestAnimationFrame(syncCurrentEditorBlock);
    }
  });

  const currentBlockFormat = getCurrentBlockFormat(editor);
  const currentFontPresetId = getCurrentFontPresetId(settings?.fontFamily);
  const currentColorValue =
    currentBlockFormat.customColor ||
    FORMAT_COLORS.find((color) => color.id === currentBlockFormat.colorToken)?.swatch ||
    "#316ee8";

  function syncInteractiveBlockElement(element: HTMLElement | null) {
    if (!element) return;
    const active = element === hoveredBlockRef.current || element === currentBlockRef.current;
    element.classList.toggle("editor-interactive-block", active);
    element.classList.toggle("is-hovered-block", element === hoveredBlockRef.current);
    element.classList.toggle("is-current-block", element === currentBlockRef.current);
  }

  function setHoveredEditorBlock(next: HTMLElement | null) {
    const previous = hoveredBlockRef.current;
    if (previous === next) return;
    hoveredBlockRef.current = next;
    if (next) next.classList.add("editor-interactive-block");
    syncInteractiveBlockElement(previous);
    syncInteractiveBlockElement(next);
  }

  function setCurrentEditorBlock(next: HTMLElement | null) {
    const previous = currentBlockRef.current;
    if (previous === next) return;
    currentBlockRef.current = next;
    if (next) next.classList.add("editor-interactive-block");
    syncInteractiveBlockElement(previous);
    syncInteractiveBlockElement(next);
  }

  // 汇总会影响 UI（格式按钮高亮、块格式面板）的编辑器状态签名，变化才触发重渲染
  function refreshEditorUi(instance: ActiveEditor) {
    const format = getCurrentBlockFormat(instance);
    const signature = [
      instance.isActive("bold"),
      instance.isActive("italic"),
      instance.isActive("underline"),
      instance.isActive("strike"),
      instance.isActive("highlight"),
      instance.isActive("link"),
      instance.isActive("bulletList"),
      instance.isActive("orderedList"),
      instance.isActive("taskList"),
      instance.isActive("codeBlock"),
      instance.isActive("collapsibleBlock"),
      instance.isActive({ textAlign: "left" }),
      instance.isActive({ textAlign: "center" }),
      instance.isActive({ textAlign: "right" }),
      instance.isActive("heading", { level: 1 }),
      instance.isActive("heading", { level: 2 }),
      instance.isActive("heading", { level: 3 }),
      instance.isActive("paragraph"),
      format.textRole,
      format.focusMode,
      format.cardMode,
      format.colorToken,
      format.customColor
    ].join("|");
    if (signature !== editorUiSigRef.current) {
      editorUiSigRef.current = signature;
      setEditorUiTick((tick) => tick + 1);
    }
  }

  function syncCurrentEditorBlock() {
    if (!editor) return;
    const root = editor.view.dom as HTMLElement | null;
    const anchorNode = editor.view.domAtPos(editor.state.selection.from).node;
    const next = findInteractiveEditorBlock(anchorNode, root);
    setCurrentEditorBlock(next);
  }

  function updateHoveredEditorBlock(target: EventTarget | null) {
    if (!editor) return;
    if (target instanceof HTMLElement && target.closest(".block-insert-anchor, .block-insert-menu, .table-toolbar")) {
      setHoveredEditorBlock(null);
      return;
    }
    const root = editor.view.dom as HTMLElement | null;
    const next = target instanceof globalThis.Node ? findInteractiveEditorBlock(target, root) : null;
    setHoveredEditorBlock(next);
  }

  function applyBlockFormat(attributes: Partial<ReturnType<typeof getCurrentBlockFormat>>) {
    if (!editor || activeNote?.trashedAt) return;
    editor.chain().focus().run();
    editor.commands.updateAttributes("paragraph", attributes);
    editor.commands.updateAttributes("heading", attributes);
  }

  function setTextPreset(preset: "heading-1" | "heading-2" | "heading-3" | "body" | "caption") {
    if (!editor || activeNote?.trashedAt) return;
    if (preset === "heading-1") {
      editor.chain().focus().setHeading({ level: 1 }).run();
      applyBlockFormat({ textRole: "body" });
      return;
    }
    if (preset === "heading-2") {
      editor.chain().focus().setHeading({ level: 2 }).run();
      applyBlockFormat({ textRole: "body" });
      return;
    }
    if (preset === "heading-3") {
      editor.chain().focus().setHeading({ level: 3 }).run();
      applyBlockFormat({ textRole: "body" });
      return;
    }
    editor.chain().focus().setParagraph().run();
    applyBlockFormat({ textRole: preset === "caption" ? "caption" : "body" });
  }

  async function applyFontPreset(presetId: FontPresetId) {
    const preset = FONT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    if (settingsOpen) {
      setSettings((current) => (current ? { ...current, fontFamily: preset.family } : current));
      return;
    }
    // 只提交字体设置：不带热键/隐私 PIN 草稿，避免把设置弹窗里未保存的内容一并落盘
    const base = settings ?? DEFAULT_APP_SETTINGS;
    try {
      const next = await window.suiji.updateSettings(
        settingsPayload({ ...base, fontFamily: preset.family }, base.hotkey)
      );
      setSettings(next);
      setHotkeyDraft(next.hotkey);
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "保存字体设置失败");
    }
  }

  function handleCustomColorChange(event: React.ChangeEvent<HTMLInputElement>) {
    applyBlockFormat({ colorToken: "default", customColor: event.target.value });
  }

  function insertCollapsibleBlock() {
    if (!editor || activeNote?.trashedAt) return;
    const { selection } = editor.state;
    const selectedNode = selection.$from.nodeAfter;
    const insertPos = selectedNode?.type.name === "collapsibleBlock" ? selection.to : selection.from;

    // 标题是文档内的真实节点：插入块后直接把光标落进标题（块起始 +1 进块、再 +1 进标题内容）
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, {
        type: "collapsibleBlock",
        attrs: { open: false },
        content: [{ type: "collapsibleTitle" }, { type: "collapsibleBody" }]
      })
      .setTextSelection(insertPos + 2)
      .run();
  }

  function insertMathBlock() {
    if (!editor || activeNote?.trashedAt) return;
    const { from, to } = editor.state.selection;
    const selectedLatex = editor.state.doc.textBetween(from, to, "\n").trim();
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent({ type: "mathBlock", attrs: { latex: selectedLatex, editOnCreate: true } })
      .run();
  }

  const loadNotes = useCallback(async () => {
    const loadedSettings = await window.suiji.getSettings();
    setSettings(loadedSettings);
    setHotkeyDraft(loadedSettings.hotkey);
    if (loadedSettings.storageEncrypted && !loadedSettings.storageUnlocked) {
      setNotes([]);
      setActiveId("");
      setPrivacyLocked(true);
      return;
    }

    const loadedNotes = await window.suiji.listNotes();
    let nextNotes = loadedNotes;
    if (nextNotes.length === 0) {
      const created = await window.suiji.createNote();
      nextNotes = [created];
    }
    setNotes(nextNotes);
    setActiveId((current) => current || nextNotes[0]?.id || "");
    setPrivacyLocked(false);
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
    function syncResponsiveLayout() {
      const floatingTools = window.innerWidth < 1280;
      const compact = window.innerWidth < 980;
      setIsFloatingToolViewport(floatingTools);
      setIsCompactViewport(compact);
      if (compact) {
        setSidebarCollapsed(true);
      }
      if (floatingTools) {
        setFormatPanelExpanded(false);
      } else {
        setFormatPanelExpanded(true);
      }
    }

    window.addEventListener("resize", syncResponsiveLayout);
    return () => window.removeEventListener("resize", syncResponsiveLayout);
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!linkDialog) return;
    window.setTimeout(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }, 0);
  }, [linkDialog]);

  useEffect(() => {
    if (!editor) return;
    window.requestAnimationFrame(syncCurrentEditorBlock);
  }, [activeNote?.id, editor]);

  useEffect(() => {
    return () => {
      setHoveredEditorBlock(null);
      setCurrentEditorBlock(null);
    };
  }, []);

  useEffect(() => {
    if (!editor || !activeNote) return;
    setTitle(activeNote.title);
    setTagsDraft(activeNote.tags.join(", "));
    setFolderDraft(activeNote.folder);
    setMetaEditorOpen(false);
    editor.commands.setContent(activeNote.content, false);
    setEditorText(getContentPlainText(activeNote.content));
    setOutlineItems(extractOutline(editor));
    setTableToolbarVisible(editor.isActive("table") && !activeNote.trashedAt);
    refreshEditorUi(editor);
    window.setTimeout(() => editor.commands.focus("end"), 0);
    revisionRef.current = 0;
    setSaveState("saved");
  }, [activeNote?.id, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!activeNote?.trashedAt);
    setTableToolbarVisible(editor.isActive("table") && !activeNote?.trashedAt);
  }, [activeNote?.trashedAt, editor]);

  // 关键词变化：重算匹配并自动定位到第一个
  useEffect(() => {
    if (!findOpen) return;
    const matches = findText();
    if (matches.length > 0) selectFindMatch(matches, 0);
  }, [findQuery, findOpen]);

  // 文档变化：只刷新匹配位置，不移动选区（避免抢走用户正在输入的光标）
  useEffect(() => {
    if (!findOpen) return;
    findText();
  }, [editor?.state.doc]);

  // 同步全部匹配的高亮装饰
  useEffect(() => {
    if (!editor) return;
    if (findOpen && findQuery) {
      setFindHighlights(editor, findMatches, findIndex);
    } else {
      clearFindHighlights(editor);
    }
  }, [editor, findMatches, findIndex, findOpen, findQuery]);

  const handleCreateRef = useRef(handleCreate);
  useEffect(() => {
    handleCreateRef.current = handleCreate;
  });

  useEffect(() => {
    return window.suiji.onNewNote(() => {
      void handleCreateRef.current();
    });
  }, []);

  useEffect(() => {
    const dispose = window.suiji.onNotesReload((id) => {
      void (async () => {
        const loaded = await window.suiji.listNotes();
        setNotes(loaded);
        if (id) {
          setActiveId(id);
          return;
        }
        // 外部变更（如恢复备份）后当前笔记可能已不存在，回退到第一篇
        setActiveId((current) => {
          if (loaded.some((note) => note.id === current)) return current;
          return loaded[0]?.id || "";
        });
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

  function openFindPanel(withReplace: boolean) {
    setFindOpen(true);
    setReplaceOpen(withReplace && !activeNote?.trashedAt);
    // 面板已打开时 autoFocus 不会再次生效，手动聚焦
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  }

  function closeFindPanel() {
    setFindOpen(false);
    focusEditorSoon();
  }

  useEffect(() => {
    const disposeFind = window.suiji.onOpenFind(() => openFindPanel(false));
    const disposeReplace = window.suiji.onOpenReplace(() => openFindPanel(true));
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
        openFindPanel(false);
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        openFindPanel(true);
      }
      if (event.key === "e" && event.shiftKey) {
        event.preventDefault();
        insertMathBlock();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Esc 按层级关闭最上层弹窗
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (tagRename) {
        setTagRename(null);
        return;
      }
      if (confirmDialog) {
        if (!confirmBusy) setConfirmDialog(null);
        return;
      }
      if (linkDialog) {
        closeLinkDialog();
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      if (settingsOpen) {
        closeSettings();
        return;
      }
      if (findOpen) {
        closeFindPanel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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

  const saveActive = useCallback(
    async (options?: { skipClean?: boolean }) => {
      if (!editor || !activeNote) return;
      // 回收站笔记是只读的，任何对它的保存都是错误路径
      if (activeNote.trashedAt) return activeNote;
      if (options?.skipClean && saveStateRef.current !== "dirty") {
        return activeNote;
      }
      // 守卫：自加载以来没有任何编辑（正文未改且标题/标签/文件夹未变）时不写库，
      // 避免视图切换等路径上的误触发把 updatedAt 刷新成当前时间
      if (
        revisionRef.current === 0 &&
        title === activeNote.title &&
        parseTagsInput(tagsDraft).join(",") === activeNote.tags.join(",") &&
        normalizeFolderInput(folderDraft) === activeNote.folder
      ) {
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
        plainText: getContentPlainText(editor.getJSON())
      };

      const saveTask = saveQueueRef.current.then(async () => {
        if (activeIdRef.current === snapshot.id) {
          setSaveState("saving");
        }

        try {
          const saved = await window.suiji.saveNote(snapshot);
          // 原位替换，避免自动保存 updatedAt 变化导致编辑中的笔记在列表里跳位
          setNotes((current) => current.map((note) => (note.id === saved.id ? saved : note)));
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
    },
    [activeNote, editor, folderDraft, tagsDraft, title]
  );

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
            openSettings();
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
  const editorDisabled = Boolean(activeNote?.trashedAt);

  const filteredNotes = useMemo(() => {
    const keyword = searchSyntax.text;
    const timeField = VIEW_TIME_FIELD[viewMode];
    const source = timeField
      ? [...notes].sort((a, b) => Date.parse(b[timeField] ?? "") - Date.parse(a[timeField] ?? ""))
      : notes;
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
      const matchesKeyword = !keyword || localMatchesKeyword || Boolean(ftsMatchedIdSet?.has(note.id));
      return matchesTag && matchesFolder && matchesKeyword;
    });
  }, [ftsMatchedIdSet, notes, searchSyntax, selectedFolder, selectedTag, viewMode]);

  const allTags = useMemo(() => {
    return Array.from(new Set(notes.filter((note) => !note.trashedAt).flatMap((note) => note.tags))).sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
  }, [notes]);

  const allFolders = useMemo(() => {
    return Array.from(new Set(notes.filter((note) => !note.trashedAt && note.folder).map((note) => note.folder))).sort(
      (a, b) => a.localeCompare(b, "zh-CN")
    );
  }, [notes]);

  const openTasks = useMemo(() => collectOpenTasks(notes), [notes]);

  function focusEditorSoon() {
    window.setTimeout(() => editor?.commands.focus("end"), 0);
  }

  function focusEditorSelectionSoon(selection: number | { from: number; to: number }) {
    window.setTimeout(() => {
      editor?.chain().focus().setTextSelection(selection).run();
    }, 0);
  }

  function firstVisibleNote(source: NoteRecord[], mode = viewMode) {
    // 与 filteredNotes 一致：有语义时间的视图按该时间排序，其余用服务端排序（置顶优先）
    const timeField = VIEW_TIME_FIELD[mode];
    const ordered = timeField
      ? [...source].sort((a, b) => Date.parse(b[timeField] ?? "") - Date.parse(a[timeField] ?? ""))
      : sortNotes(source);
    return ordered.find((note) => {
      if (mode === "trash") return Boolean(note.trashedAt);
      if (note.trashedAt) return false;
      if (mode === "favorites") return Boolean(note.favoriteAt);
      if (mode === "archive") return Boolean(note.archivedAt);
      if (mode === "active" || mode === "tasks") return !note.archivedAt;
      return true;
    });
  }

  async function reloadNotes(selectMode = viewMode) {
    const loaded = await window.suiji.listNotes();
    setNotes(loaded);
    const stillVisible = firstVisibleNote(
      loaded.filter((note) => note.id === activeId),
      selectMode
    );
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
    // 不抢占焦点：用户可以继续按 Enter 或修改关键词
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to));
    editor.view.dispatch(tr);
    setFindIndex(safeIndex);
    revealEditorPosition(match.from);
  }

  function handleFindNext(direction: 1 | -1 = 1) {
    const matches = findText();
    if (matches.length === 0) return;
    selectFindMatch(matches, findIndex + direction);
  }

  function handleReplaceCurrent() {
    if (!editor || activeNote?.trashedAt || findMatches.length === 0) return;
    const match = findMatches[findIndex];
    editor.view.dispatch(editor.state.tr.insertText(replaceValue, match.from, match.to));
    markDirty();
    window.setTimeout(() => {
      const matches = findText();
      selectFindMatch(matches, Math.min(findIndex, Math.max(matches.length - 1, 0)));
    }, 0);
  }

  function handleReplaceAll() {
    if (!editor || activeNote?.trashedAt || !findQuery) return;
    const matches = findText();
    if (matches.length === 0) return;
    const tr = editor.state.tr;
    [...matches].reverse().forEach((match) => {
      tr.insertText(replaceValue, match.from, match.to);
    });
    editor.view.dispatch(tr);
    markDirty();
    setFindMatches([]);
    setFindIndex(0);
  }

  function revealEditorPosition(targetPos: number) {
    if (!editor) return;
    window.requestAnimationFrame(() => {
      const wrap = editorWrapRef.current;
      if (!wrap) return;
      const boundedPos = Math.min(Math.max(targetPos, 1), editor.state.doc.content.size);
      const coords = editor.view.coordsAtPos(boundedPos);
      const wrapRect = wrap.getBoundingClientRect();
      const contentTop = coords.top - wrapRect.top + wrap.scrollTop;
      const contentBottom = coords.bottom - wrapRect.top + wrap.scrollTop;
      const visibleTop = wrap.scrollTop + 56;
      const visibleBottom = wrap.scrollTop + wrap.clientHeight - 72;
      if (contentTop >= visibleTop && contentBottom <= visibleBottom) return;
      const nextTop = Math.max(0, contentTop - Math.max(88, wrap.clientHeight * 0.22));
      wrap.scrollTo({ top: nextTop, behavior: "smooth" });
    });
  }

  async function handleInsertImage(file: File | undefined) {
    if (!editor || !file) return;
    if (!file.type.startsWith("image/")) return;
    // 图片落盘到 attachments/，文档里只存 asset 引用，避免 base64 撑爆文档和数据库
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const src = await window.suiji.saveImageAsset({ base64: window.btoa(binary), ext });
    editor.chain().focus().setImage({ src, alt: file.name }).run();
    markDirty();
  }

  function runTableCommand(command: () => boolean) {
    if (!editor || activeNote?.trashedAt) return;
    command();
    setTableToolbarVisible(editor.isActive("table") && !activeNote?.trashedAt);
    focusEditorSoon();
  }

  async function handleCreate() {
    await saveActive({ skipClean: true });
    const created = await window.suiji.createNote();
    const note = selectedFolder ? await window.suiji.saveNote({ ...created, folder: selectedFolder }) : created;
    setNotes((current) => sortNotes([note, ...current]));
    setActiveId(note.id);
    setViewMode("active");
    focusEditorSoon();
  }

  async function handleSelectNote(id: string) {
    if (id === activeId) {
      if (isCompactViewport) setSidebarCollapsed(true);
      focusEditorSoon();
      return;
    }
    await saveActive({ skipClean: true });
    setActiveId(id);
    if (isCompactViewport) setSidebarCollapsed(true);
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

  function handleRemoveMetadata(kind: NoteMetadataKind, value: string) {
    const affectedCount = notes.filter((note) =>
      kind === "tag" ? note.tags.includes(value) : note.folder === value
    ).length;
    const label = kind === "tag" ? "标签" : "文件夹";
    setConfirmDialog({
      title: `删除${label}`,
      description: `「${value}」已用于 ${affectedCount} 篇记录。确认后会从这些记录中移除，无法自动恢复。`,
      confirmLabel: `删除${label}`,
      tone: "danger",
      icon: "trash",
      onConfirm: async () => {
        await saveActive({ skipClean: true });
        const currentNotes = await window.suiji.listNotes();
        for (const note of currentNotes) {
          if (kind === "tag" ? !note.tags.includes(value) : note.folder !== value) continue;
          await window.suiji.saveNote(removeNoteMetadata(note, kind, value));
        }
        const loaded = await reloadNotes();
        const nextActive = loaded.find((note) => note.id === activeIdRef.current);
        if (nextActive) {
          setTagsDraft(nextActive.tags.join(", "));
          setFolderDraft(nextActive.folder);
        }
        if (kind === "tag") setSelectedTag((current) => (current === value ? "" : current));
        else setSelectedFolder((current) => (current === value ? "" : current));
      }
    });
  }

  async function applyTagRename() {
    if (!tagRename) return;
    const from = tagRename.from;
    const to = tagRename.draft.trim();
    setTagRename(null);
    if (!to || to === from) return;
    await saveActive({ skipClean: true });
    await window.suiji.renameTag(from, to);
    const loaded = await reloadNotes();
    const nextActive = loaded.find((note) => note.id === activeIdRef.current);
    if (nextActive) setTagsDraft(nextActive.tags.join(", "));
    setSelectedTag((current) => (current === from ? to : current));
  }

  async function toggleTheme() {
    const base = settings ?? DEFAULT_APP_SETTINGS;
    const next = await window.suiji.updateSettings(
      settingsPayload({ ...base, theme: base.theme === "dark" ? "light" : "dark" }, base.hotkey)
    );
    setSettings(next);
  }

  function handleOpenTaskNote(id: string) {
    setViewMode("active");
    void handleSelectNote(id);
  }

  // 待办汇总视图里直接勾掉任务：改 JSON 后走正常保存通道，当前打开的笔记同步编辑器
  async function handleToggleTask(task: OpenTask) {
    const note = notesRef.current.find((item) => item.id === task.noteId);
    if (!note) return;
    const content = toggleTaskAtIndex(note.content, task.taskIndex);
    const saved = await window.suiji.saveNote({ ...note, content, plainText: getContentPlainText(content) });
    setNotes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    if (activeIdRef.current === saved.id && editor) {
      editor.commands.setContent(saved.content, false);
      setEditorText(getContentPlainText(saved.content));
      setOutlineItems(extractOutline(editor));
    }
  }

  const paletteItems = useMemo<CommandPaletteItem[]>(() => {
    const commands: CommandPaletteItem[] = [
      { id: "new", kind: "command", label: "新建记录", run: () => void handleCreate() },
      { id: "find", kind: "command", label: "文档内查找", run: () => openFindPanel(false) },
      { id: "theme", kind: "command", label: settings?.theme === "dark" ? "切换到浅色模式" : "切换到深色模式", run: () => void toggleTheme() },
      { id: "history", kind: "command", label: "当前记录的历史版本", run: () => void handleOpenHistory() },
      { id: "settings", kind: "command", label: "打开设置", run: () => openSettings() }
    ];
    const views: CommandPaletteItem[] = (
      [
        ["active", "视图：记录"],
        ["tasks", "视图：待办"],
        ["favorites", "视图：收藏"],
        ["archive", "视图：归档"],
        ["trash", "视图：回收站"],
        ["recent", "视图：最近"]
      ] as Array<[ViewMode, string]>
    ).map(([mode, label]) => ({
      id: `view-${mode}`,
      kind: "command",
      label,
      run: () => {
        setViewMode(mode);
        if (mode !== "tasks") {
          const next = firstVisibleNote(notesRef.current, mode);
          if (next) setActiveId(next.id);
        }
      }
    }));
    const noteItems: CommandPaletteItem[] = notes
      .filter((note) => !note.trashedAt)
      .map((note) => ({
        id: note.id,
        kind: "note",
        label: note.title || "未命名记录",
        hint: note.excerpt.slice(0, 40),
        run: () => void handleSelectNote(note.id)
      }));
    return [...commands, ...views, ...noteItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, settings?.theme]);

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
        plainText: getContentPlainText(editor.getJSON())
      },
      format,
      currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
    });
  }

  async function handleBatchExport(format: BatchExportFormat) {
    setDataActionStatus("正在批量导出...");
    await saveActive({ skipClean: true });
    const result = await window.suiji.batchExportNotes({
      format,
      currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
    });
    setDataActionStatus(
      typeof result === "string"
        ? `加密导出已保存：${result}`
        : result
          ? `已导出 ${result.count} 条：${result.directory}`
          : "已取消批量导出"
    );
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

  const hotkeyTestSeqRef = useRef(0);

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
    // 连续按键时只接受最后一次检测结果，避免乱序返回覆盖
    const seq = ++hotkeyTestSeqRef.current;
    const available = await window.suiji.testHotkey(next);
    if (seq !== hotkeyTestSeqRef.current) return;
    setHotkeyStatus(available ? "快捷键可用" : "快捷键可能已被占用，建议更换");
  }

  function jumpToOutline(item: OutlineItem) {
    if (!editor) return;
    const targetPos = Math.min(item.pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
    revealEditorPosition(targetPos);
  }

  function openSettings() {
    settingsSnapshotRef.current = settingsRef.current;
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (settingsSaving) return;
    // 未保存而关闭：回滚弹窗内即时预览的更改
    if (settingsSnapshotRef.current) {
      setSettings(settingsSnapshotRef.current);
      settingsSnapshotRef.current = null;
    }
    setSettingsOpen(false);
    setCurrentPrivacyPinDraft("");
    setPrivacyPinDraft("");
    setClearPrivacyPin(false);
    setHotkeyStatus("");
    setHotkeyDraft(settings?.hotkey ?? "");
  }

  async function handleSettingsSave() {
    if (settingsSaving) return;
    const currentSettings = settings ?? DEFAULT_APP_SETTINGS;
    const payload = settingsPayload(currentSettings, hotkeyDraft);
    const rewritesLocalData =
      payload.encryptLocalData !== currentSettings.storageEncrypted ||
      payload.backupHistoryEnabled !== currentSettings.backupHistoryEnabled ||
      payload.backupHistoryLimit !== currentSettings.backupHistoryLimit ||
      Boolean(privacyPinDraft.trim()) ||
      clearPrivacyPin;
    try {
      setSettingsSaving(true);
      setDataActionStatus(rewritesLocalData ? "正在重写本地数据，请稍候..." : "正在保存设置...");
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const next = await window.suiji.updateSettings({
        ...payload,
        currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined,
        privacyPin: privacyPinDraft.trim() || undefined,
        clearPrivacyPin
      });
      setSettings(next);
      setHotkeyDraft(next.hotkey);
      setHotkeyStatus("");
      setCurrentPrivacyPinDraft("");
      setPrivacyPinDraft("");
      setClearPrivacyPin(false);
      setDataActionStatus("");
      settingsSnapshotRef.current = null;
      setSettingsOpen(false);
      if (next.storageEncrypted && !next.storageUnlocked) {
        setPrivacyLocked(true);
      }
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleBackupAllNotes() {
    try {
      setDataActionStatus("正在备份...");
      await saveActive({ skipClean: true });
      const filePath = await window.suiji.backupAllNotes({
        encrypted: false,
        currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
      });
      setDataActionStatus(filePath ? `备份已保存：${filePath}` : "已取消备份");
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "备份失败");
    }
  }

  async function handleEncryptedBackupAllNotes() {
    try {
      setDataActionStatus("正在导出加密备份...");
      await saveActive({ skipClean: true });
      const filePath = await window.suiji.backupAllNotes({
        encrypted: true,
        currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
      });
      setDataActionStatus(filePath ? `加密备份已保存：${filePath}` : "已取消加密备份");
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "加密备份失败");
    }
  }

  async function reloadNotesAfterExternalImport(preferredId?: string) {
    const loadedNotes = await window.suiji.listNotes();
    let nextNotes = loadedNotes;
    if (nextNotes.length === 0) {
      const created = await window.suiji.createNote();
      nextNotes = [created];
    }
    const nextActive =
      (preferredId ? nextNotes.find((note) => note.id === preferredId) : null) ??
      nextNotes.find((note) => note.id === activeId) ??
      nextNotes[0];
    setNotes(nextNotes);
    setActiveId(nextActive?.id || "");
    if (nextActive && editor) {
      setTitle(nextActive.title);
      setTagsDraft(nextActive.tags.join(", "));
      setFolderDraft(nextActive.folder);
      editor.commands.setContent(nextActive.content, false);
      setEditorText(getContentPlainText(nextActive.content));
      setOutlineItems(extractOutline(editor));
      revisionRef.current = 0;
      setSaveState("saved");
    }
  }

  async function handleRestoreNotesBackup() {
    try {
      setDataActionStatus("正在恢复...");
      await saveActive({ skipClean: true });
      const result = await window.suiji.restoreNotesBackup({
        currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
      });
      if (!result) {
        setDataActionStatus("已取消恢复");
        return;
      }
      await reloadNotesAfterExternalImport();
      setDataActionStatus(
        `恢复完成：导入 ${result.imported}/${result.total} 条，跳过 ${result.skipped} 条${describeRestoreFailures(result.failures)}`
      );
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "恢复失败");
    }
  }

  async function handleImportEncryptedExport() {
    try {
      setDataActionStatus("正在导入加密导出...");
      await saveActive({ skipClean: true });
      const result = await window.suiji.importEncryptedExport({
        currentPrivacyPin: currentPrivacyPinDraft.trim() || undefined
      });
      if (!result) {
        setDataActionStatus("已取消导入加密导出");
        return;
      }
      await reloadNotesAfterExternalImport();
      setDataActionStatus(
        `导入完成：${result.kind === "note-export" ? "单篇" : "批量"}加密导出，导入 ${result.imported}/${result.total} 条，跳过 ${result.skipped} 条${describeRestoreFailures(result.failures)}`
      );
    } catch (error) {
      setDataActionStatus(error instanceof Error ? error.message : "导入加密导出失败");
    }
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

    const loadedSettings = await window.suiji.getSettings();
    setSettings(loadedSettings);
    setHotkeyDraft(loadedSettings.hotkey);
    if (loadedSettings.storageEncrypted && !loadedSettings.storageUnlocked) {
      setNotes([]);
      setActiveId("");
      setPrivacyLocked(true);
      setViewMode("active");
      setSelectedFolder("");
      setSelectedTag("");
      setDataActionStatus(`数据目录已切换：${dataPath}`);
      return;
    }

    const loaded = await reloadNotes("active");
    if (loaded.length === 0) {
      const created = await window.suiji.createNote();
      setNotes([created]);
      setActiveId(created.id);
    }
    setViewMode("active");
    setSelectedFolder("");
    setSelectedTag("");
    setDataActionStatus(`数据目录已切换：${dataPath}`);
  }

  async function handleOpenHistory() {
    if (!activeNote) return;
    if (!settings?.backupHistoryEnabled) {
      setHistoryStatus("历史版本已关闭");
      setHistoryEntries([]);
      setHistoryOpen(true);
      return;
    }
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
          setEditorText(getContentPlainText(restored.content));
          setOutlineItems(extractOutline(editor));
        }
        revisionRef.current = 0;
        setSaveState("saved");
        setHistoryOpen(false);
      }
    });
  }

  async function handleUnlock() {
    if (unlockBusy) return;
    if (!settings?.hasPrivacyPin) {
      setPrivacyLocked(false);
      setUnlockError("");
      focusEditorSoon();
      return;
    }

    try {
      setUnlockBusy(true);
      setUnlockError("");
      const ok = await window.suiji.verifyPrivacyPin(unlockPin);
      if (!ok) {
        setUnlockError("密码不正确");
        return;
      }
      if (settings.storageEncrypted && !settings.storageUnlocked) {
        await loadNotes();
      } else {
        setSettings((current) => (current ? { ...current, storageUnlocked: true } : current));
      }
      setPrivacyLocked(false);
      setUnlockPin("");
      focusEditorSoon();
    } catch (error) {
      const message =
        error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "") : "";
      setUnlockError(message || "解锁失败，请稍后重试");
    } finally {
      setUnlockBusy(false);
    }
  }

  function handleLink() {
    if (!editor) return;

    const current = editor.getAttributes("link").href as string | undefined;
    const { from, to, empty } = editor.state.selection;
    setLinkDraft(current || "https://");
    setLinkDialog({ from, to, empty, hasActiveLink: Boolean(current) });
  }

  function closeLinkDialog() {
    const selection = linkDialog
      ? linkDialog.empty
        ? linkDialog.from
        : { from: linkDialog.from, to: linkDialog.to }
      : null;
    setLinkDialog(null);
    setLinkDraft("");
    if (selection !== null) {
      focusEditorSelectionSoon(selection);
      return;
    }
    focusEditorSoon();
  }

  function applyLinkDialog() {
    if (!editor || !linkDialog) return;

    const normalizedUrl = normalizeLinkUrl(linkDraft);
    if (!normalizedUrl) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: linkDialog.from, to: linkDialog.to })
        .extendMarkRange("link")
        .unsetLink()
        .run();
      closeLinkDialog();
      return;
    }

    if (linkDialog.empty && !linkDialog.hasActiveLink) {
      editor
        .chain()
        .focus()
        .setTextSelection(linkDialog.from)
        .insertContent({
          type: "text",
          text: normalizedUrl,
          marks: [{ type: "link", attrs: { href: normalizedUrl } }]
        })
        .run();
      closeLinkDialog();
      return;
    }

    const selection = linkDialog.empty ? linkDialog.from : { from: linkDialog.from, to: linkDialog.to };
    editor.chain().focus().setTextSelection(selection).extendMarkRange("link").setLink({ href: normalizedUrl }).run();
    closeLinkDialog();
  }

  function removeLinkFromDialog() {
    if (!editor || !linkDialog) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: linkDialog.from, to: linkDialog.to })
      .extendMarkRange("link")
      .unsetLink()
      .run();
    closeLinkDialog();
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
      id: "collapsible-block",
      label: "折叠块",
      hint: "可连续嵌套层级",
      run: () => insertCollapsibleBlock()
    },
    {
      id: "math-block",
      label: "公式",
      hint: "LaTeX 实时预览",
      run: () => insertMathBlock()
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
      id: "table",
      label: "表格",
      hint: "3 x 3 表格",
      run: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
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

  const appClassName = [
    "app-shell",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    settings?.theme === "dark" ? "theme-dark" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const appStyle = {
    "--editor-width": `${settings?.lineWidth ?? 1120}px`,
    "--editor-font-family": settings?.fontFamily?.trim() || undefined,
    "--editor-font-size": `${settings?.fontSize ?? 16}px`,
    "--editor-line-height": settings?.lineHeight ?? 1.72
  } as React.CSSProperties;

  return (
    <main className={appClassName} style={appStyle}>
      <Sidebar
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        onCollapseSidebar={() => setSidebarCollapsed(true)}
        leftPaneMode={leftPaneMode}
        onLeftPaneModeChange={setLeftPaneMode}
        title={title}
        activeNote={activeNote}
        editorCharCount={editorStats.chars}
        outlineItems={outlineItems}
        onJumpToOutline={jumpToOutline}
        onOpenFind={() => openFindPanel(false)}
        onCreateNote={() => void handleCreate()}
        onHideWindow={() => void window.suiji.hideWindow()}
        onOpenSettings={openSettings}
        query={query}
        onQueryChange={setQuery}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          void (async () => {
            // 先落盘当前未保存的修改，再切换，避免 650ms 防抖窗口内丢内容
            await saveActive({ skipClean: true });
            setViewMode(mode);
            // 待办视图不跳转文档，保持当前编辑上下文
            if (mode === "tasks") return;
            const next = firstVisibleNote(notes, mode);
            if (next) setActiveId(next.id);
          })();
        }}
        allFolders={allFolders}
        selectedFolder={selectedFolder}
        onSelectFolder={setSelectedFolder}
        onRemoveFolder={(folder) => handleRemoveMetadata("folder", folder)}
        allTags={allTags}
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        onRemoveTag={(tag) => handleRemoveMetadata("tag", tag)}
        onRenameTag={(tag) => setTagRename({ from: tag, draft: tag })}
        openTasks={openTasks}
        onOpenTaskNote={handleOpenTaskNote}
        onToggleTask={(task) => void handleToggleTask(task)}
        filteredNotes={filteredNotes}
        activeId={activeId}
        searchKeyword={searchKeyword}
        onSelectNote={(id) => void handleSelectNote(id)}
        onTogglePin={(id) => void handleTogglePin(id)}
        onToggleFavorite={(id) => void handleToggleFavorite(id)}
        onToggleArchive={(id) => void handleToggleArchive(id)}
        onDeleteNote={(id) => void handleDeleteNote(id)}
        onRestoreNote={(id) => void handleRestoreNote(id)}
        onPurgeNote={(id) => void handlePurgeNote(id)}
      />

      <section className="workspace">
        <TopBar
          readOnly={editorDisabled}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          title={title}
          onTitleChange={(value) => {
            setTitle(value);
            markDirty();
          }}
          folderPreview={folderPreview}
          metaTagsPreview={metaTagsPreview}
          hasMetaInfo={hasMetaInfo}
          metaEditorOpen={metaEditorOpen}
          onToggleMetaEditor={() => setMetaEditorOpen((current) => !current)}
          tagsDraft={tagsDraft}
          onTagsChange={(value) => {
            setTagsDraft(value);
            markDirty();
          }}
          folderDraft={folderDraft}
          onFolderChange={(value) => {
            setFolderDraft(value);
            markDirty();
          }}
          saveState={saveState}
          editorCharCount={editorStats.chars}
          readingMinutes={editorStats.readingMinutes}
        />

        <div className="document-stage">
          <div className="editor-column">
            {findOpen ? (
              <FindPanel
                readOnly={editorDisabled}
                findInputRef={findInputRef}
                findQuery={findQuery}
                onFindQueryChange={setFindQuery}
                replaceOpen={replaceOpen}
                replaceValue={replaceValue}
                onReplaceValueChange={setReplaceValue}
                matchCount={findMatches.length}
                findIndex={findIndex}
                onFindNext={handleFindNext}
                onReplaceCurrent={handleReplaceCurrent}
                onReplaceAll={handleReplaceAll}
                onToggleReplace={() => setReplaceOpen((current) => !current)}
                onClose={closeFindPanel}
              />
            ) : null}
            <EditorArea
              editor={editor}
              editorWrapRef={editorWrapRef}
              imageInputRef={imageInputRef}
              trashed={Boolean(activeNote?.trashedAt)}
              blockMenuOpen={blockMenuOpen}
              blockMenuCommands={blockMenuCommands}
              onToggleBlockMenu={() => setBlockMenuOpen((current) => !current)}
              onApplyBlockMenuCommand={applyBlockMenuCommand}
              onHoverBlock={updateHoveredEditorBlock}
              onLeave={() => setHoveredEditorBlock(null)}
              onFocusEnd={() => editor?.commands.focus("end")}
              onFocus={() => editor?.commands.focus()}
              onImageChosen={(file) => void handleInsertImage(file)}
            />
          </div>

          <FormatPanel
            editor={editor}
            editorDisabled={editorDisabled}
            currentBlockFormat={currentBlockFormat}
            currentColorValue={currentColorValue}
            currentFontPresetId={currentFontPresetId}
            settingsReady={Boolean(settings)}
            isFloatingToolViewport={isFloatingToolViewport}
            formatPanelExpanded={formatPanelExpanded}
            onSetTextPreset={setTextPreset}
            onApplyBlockFormat={applyBlockFormat}
            onCustomColorChange={handleCustomColorChange}
            customColorInputRef={customColorInputRef}
            onFontPreset={(id) => void applyFontPreset(id)}
            onInsertCollapsibleBlock={insertCollapsibleBlock}
            onInsertMathBlock={insertMathBlock}
            onEditLink={handleLink}
            tableToolbarVisible={tableToolbarVisible}
            onRunTableCommand={runTableCommand}
          />
        </div>

        {isFloatingToolViewport ? (
          <div className="tool-rail" aria-label="右侧工具">
            <button
              type="button"
              className={formatPanelExpanded ? "tool-rail-button is-active" : "tool-rail-button"}
              aria-label={formatPanelExpanded ? "收起格式面板" : "展开格式面板"}
              onClick={() => setFormatPanelExpanded((current) => !current)}
            >
              Aa
            </button>
          </div>
        ) : null}
      </section>

      {paletteOpen ? <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} /> : null}

      {tagRename ? (
        <PromptDialog
          title="重命名标签"
          description={`把「${tagRename.from}」改成新名字；如果新名字已存在，两个标签会合并。`}
          value={tagRename.draft}
          confirmLabel="重命名"
          onChange={(value) => setTagRename((current) => (current ? { ...current, draft: value } : current))}
          onConfirm={() => void applyTagRename()}
          onClose={() => setTagRename(null)}
        />
      ) : null}

      {linkDialog ? (
        <LinkDialog
          dialog={linkDialog}
          linkDraft={linkDraft}
          linkInputRef={linkInputRef}
          onDraftChange={setLinkDraft}
          onApply={applyLinkDialog}
          onRemove={removeLinkFromDialog}
          onClose={closeLinkDialog}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          settingsSaving={settingsSaving}
          hotkeyDraft={hotkeyDraft}
          hotkeyStatus={hotkeyStatus}
          onHotkeyRecord={(event) => void handleHotkeyRecord(event)}
          onHotkeyFocus={() => setHotkeyStatus("按下新的快捷键组合")}
          onSettingsChange={(updater) => setSettings((current) => (current ? updater(current) : current))}
          currentPrivacyPinDraft={currentPrivacyPinDraft}
          onCurrentPrivacyPinChange={setCurrentPrivacyPinDraft}
          privacyPinDraft={privacyPinDraft}
          onPrivacyPinChange={(value) => {
            setPrivacyPinDraft(value);
            setClearPrivacyPin(false);
          }}
          clearPrivacyPin={clearPrivacyPin}
          onClearPrivacyPinChange={(checked) => {
            setClearPrivacyPin(checked);
            if (checked) setPrivacyPinDraft("");
          }}
          dataActionStatus={dataActionStatus}
          onBackupAll={() => void handleBackupAllNotes()}
          onEncryptedBackup={() => void handleEncryptedBackupAllNotes()}
          onRestoreBackup={() => void handleRestoreNotesBackup()}
          onImportEncrypted={() => void handleImportEncryptedExport()}
          onImportMarkdown={() => void handleImportMarkdown()}
          onOpenDataFolder={() => void handleOpenDataFolder()}
          onChangeDataFolder={() => void handleChangeDataFolder()}
          onClose={closeSettings}
          onSave={() => void handleSettingsSave()}
        />
      ) : null}

      {historyOpen ? (
        <HistoryModal
          entries={historyEntries}
          status={historyStatus}
          onRestore={(entry) => void handleRestoreHistory(entry)}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {confirmDialog ? (
        <ConfirmDialog
          dialog={confirmDialog}
          busy={confirmBusy}
          onClose={closeConfirmDialog}
          onConfirm={() => void runConfirmDialog()}
        />
      ) : null}

      {privacyLocked ? (
        <PrivacyLock
          hasPrivacyPin={Boolean(settings?.hasPrivacyPin)}
          unlockPin={unlockPin}
          unlockError={unlockError}
          unlockBusy={unlockBusy}
          onUnlockPinChange={(value) => {
            setUnlockPin(value);
            setUnlockError("");
          }}
          onUnlock={() => void handleUnlock()}
        />
      ) : null}
    </main>
  );
}
