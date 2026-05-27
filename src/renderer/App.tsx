import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
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
  Bold,
  CheckSquare,
  Code2,
  Download,
  EyeOff,
  FileSearch,
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
  Save,
  Search,
  Settings,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2
} from "lucide-react";
import type { AppSettings, NoteRecord } from "../shared/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ExportFormat = "html" | "json" | "txt" | "md";

type FindMatch = {
  from: number;
  to: number;
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

function sortNotes(notes: NoteRecord[]) {
  return [...notes].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
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
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const activeNote = useMemo(() => notes.find((note) => note.id === activeId) ?? null, [activeId, notes]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: true
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
      }
    },
    onUpdate: () => setSaveState("dirty")
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
    if (!editor || !activeNote) return;
    setTitle(activeNote.title);
    editor.commands.setContent(activeNote.content, false);
    window.setTimeout(() => editor.commands.focus("end"), 0);
    setSaveState("saved");
  }, [activeNote?.id, editor]);

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

  const saveActive = useCallback(async (options?: { skipClean?: boolean }) => {
    if (!editor || !activeNote) return;
    if (options?.skipClean && saveState !== "dirty") {
      return activeNote;
    }
    setSaveState("saving");
    try {
      const plainText = editor.getText();
      const saved = await window.suiji.saveNote({
        ...activeNote,
        title,
        content: editor.getJSON(),
        html: editor.getHTML(),
        plainText
      });
      setNotes((current) => sortNotes([saved, ...current.filter((note) => note.id !== saved.id)]));
      setSaveState("saved");
      return saved;
    } catch {
      setSaveState("error");
      return null;
    }
  }, [activeNote, editor, saveState, title]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => {
      void saveActive();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [saveActive, saveState]);

  const filteredNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const source = sortNotes(notes);
    if (!keyword) return source;
    return source.filter((note) => {
      return (
        note.title.toLowerCase().includes(keyword) ||
        note.excerpt.toLowerCase().includes(keyword) ||
        note.plainText.toLowerCase().includes(keyword)
      );
    });
  }, [notes, query]);

  function focusEditorSoon() {
    window.setTimeout(() => editor?.commands.focus("end"), 0);
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
    setSaveState("dirty");
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
    setSaveState("dirty");
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
    setSaveState("dirty");
  }

  async function handleCreate() {
    await saveActive({ skipClean: true });
    const note = await window.suiji.createNote();
    setNotes((current) => sortNotes([note, ...current]));
    setActiveId(note.id);
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
    const ok = window.confirm(`删除「${note.title}」？`);
    if (!ok) return;

    await window.suiji.deleteNote(id);
    let nextNotes = sortNotes(notes.filter((item) => item.id !== id));
    if (nextNotes.length === 0) {
      const created = await window.suiji.createNote();
      nextNotes = [created];
    }
    setNotes(nextNotes);
    if (activeId === id) {
      setActiveId(nextNotes[0]?.id || "");
    }
  }

  async function handleTogglePin(id: string) {
    await saveActive({ skipClean: true });
    const updated = await window.suiji.togglePinNote(id);
    setNotes((current) => sortNotes([updated, ...current.filter((note) => note.id !== updated.id)]));
  }

  async function handleExport(format: ExportFormat) {
    setExportOpen(false);
    await saveActive({ skipClean: true });
    if (!activeNote || !editor) return;
    await window.suiji.exportNote({
      note: {
        ...activeNote,
        title,
        content: editor.getJSON(),
        html: editor.getHTML(),
        plainText: editor.getText()
      },
      format
    });
  }

  async function handleSettingsSave() {
    const next = await window.suiji.updateSettings({
      hotkey: hotkeyDraft.trim() || "CommandOrControl+Alt+J",
      startHidden: settings?.startHidden ?? false,
      lockOnHide: settings?.lockOnHide ?? true,
      privacyPin: privacyPinDraft.trim() || undefined,
      clearPrivacyPin
    });
    setSettings(next);
    setHotkeyDraft(next.hotkey);
    setPrivacyPinDraft("");
    setClearPrivacyPin(false);
    setSettingsOpen(false);
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

  const statusText =
    saveState === "saving"
      ? "保存中"
      : saveState === "dirty"
        ? "有修改"
        : saveState === "error"
          ? "保存失败"
          : "已保存";

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" />
        </div>

        <button className="new-note-button" type="button" onClick={handleCreate}>
          <Plus size={18} />
          新记录
        </button>

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
                  {note.title}
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
                  <button
                    type="button"
                    title="删除记录"
                    aria-label="删除记录"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteNote(note.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <span className="note-excerpt">{note.excerpt || "空记录"}</span>
              <span className="note-time">{formatTime(note.updatedAt)}</span>
            </div>
          ))}
        </nav>
          </>
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <input
            className="title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveState("dirty");
            }}
            placeholder="未命名记录"
          />
          <div className="topbar-actions">
            <span className={`save-status ${saveState}`}>{statusText}</span>
            <button className="icon-button" title="立即保存" aria-label="立即保存" onClick={() => void saveActive()}>
              <Save size={18} />
            </button>
            <button className="icon-button" title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={18} />
            </button>
          </div>
        </header>

        <div className="toolbar">
          <div className="toolbar-tools" aria-label="编辑工具">
            <ToolbarButton title="撤销" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
              <Undo2 size={17} />
            </ToolbarButton>
            <ToolbarButton title="重做" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
              <Redo2 size={17} />
            </ToolbarButton>
            <span className="toolbar-separator" />
            <ToolbarButton
              title="一级标题"
              active={editor?.isActive("heading", { level: 1 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <Heading1 size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="二级标题"
              active={editor?.isActive("heading", { level: 2 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 size={17} />
            </ToolbarButton>
            <ToolbarButton title="加粗" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
              <Bold size={17} />
            </ToolbarButton>
            <ToolbarButton title="斜体" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <Italic size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="下划线"
              active={editor?.isActive("underline")}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon size={17} />
            </ToolbarButton>
            <ToolbarButton title="删除线" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}>
              <Strikethrough size={17} />
            </ToolbarButton>
            <ToolbarButton title="高亮" active={editor?.isActive("highlight")} onClick={() => editor?.chain().focus().toggleHighlight().run()}>
              <Highlighter size={17} />
            </ToolbarButton>
            <span className="toolbar-separator" />
            <ToolbarButton
              title="项目符号列表"
              active={editor?.isActive("bulletList")}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              <List size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="编号列表"
              active={editor?.isActive("orderedList")}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="任务列表"
              active={editor?.isActive("taskList")}
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
            >
              <CheckSquare size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="引用"
              active={editor?.isActive("blockquote")}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            >
              <Quote size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="代码块"
              active={editor?.isActive("codeBlock")}
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            >
              <Code2 size={17} />
            </ToolbarButton>
            <ToolbarButton title="分割线" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
              <Minus size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="链接"
              active={editor?.isActive("link")}
              onClick={handleLink}
            >
              <Link2 size={17} />
            </ToolbarButton>
            <ToolbarButton
              title="查找和替换"
              active={findOpen}
              onClick={() => {
                setFindOpen((current) => !current);
                setReplaceOpen(false);
              }}
            >
              <FileSearch size={17} />
            </ToolbarButton>
            <ToolbarButton title="插入图片" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus size={17} />
            </ToolbarButton>
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
          </div>
          <div
            className="export-menu-wrap"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setExportOpen(false);
              }
            }}
          >
            <button
              className={exportOpen ? "export-button is-open" : "export-button"}
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen((current) => !current)}
            >
              <span>导出</span>
              <Download size={17} />
            </button>
            {exportOpen ? (
              <div className="export-menu" role="menu">
                {[
                  ["html", "HTML"],
                  ["md", "MD"],
                  ["txt", "TXT"],
                  ["json", "JSON"]
                ].map(([format, label]) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void handleExport(format as ExportFormat)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

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
          className="editor-wrap"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              editor?.commands.focus("end");
            }
          }}
          onClick={() => editor?.commands.focus()}
        >
          {editor ? <EditorContent editor={editor} /> : null}
        </div>
      </section>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <h2>设置</h2>
            <label>
              <span>全局快捷键</span>
              <input value={hotkeyDraft} onChange={(event) => setHotkeyDraft(event.target.value)} />
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
                checked={settings?.lockOnHide ?? true}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, lockOnHide: event.target.checked } : current
                  )
                }
              />
              <span>隐藏后重新打开时保护内容</span>
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
