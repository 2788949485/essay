import {
  Archive,
  ArchiveRestore,
  Clock,
  EyeOff,
  Folder,
  FolderOpen,
  List,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings as SettingsIcon,
  Star,
  StarOff,
  Square,
  Trash2,
  X
} from "lucide-react";
import type { NoteRecord } from "../../shared/types";
import type { LeftPaneMode, OutlineItem, ViewMode } from "../constants";
import { HighlightedText, keepEditorFocus } from "./common";
import { formatTime, type OpenTask } from "../utils/text";

type SidebarProps = {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  onCollapseSidebar: () => void;
  leftPaneMode: LeftPaneMode;
  onLeftPaneModeChange: (mode: LeftPaneMode) => void;
  title: string;
  activeNote: NoteRecord | null;
  editorCharCount: number;
  outlineItems: OutlineItem[];
  onJumpToOutline: (item: OutlineItem) => void;
  onOpenFind: () => void;
  onCreateNote: () => void;
  onHideWindow: () => void;
  onOpenSettings: () => void;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  allFolders: string[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  onRemoveFolder: (folder: string) => void;
  allTags: string[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRenameTag: (tag: string) => void;
  openTasks: OpenTask[];
  onOpenTaskNote: (id: string) => void;
  onToggleTask: (task: OpenTask) => void;
  filteredNotes: NoteRecord[];
  activeId: string;
  searchKeyword: string;
  onSelectNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onRestoreNote: (id: string) => void;
  onPurgeNote: (id: string) => void;
};

const VIEW_MODES: Array<[ViewMode, string, typeof List]> = [
  ["active", "记录", List],
  ["tasks", "待办", ListTodo],
  ["favorites", "收藏", Star],
  ["archive", "归档", Archive],
  ["trash", "回收站", Trash2],
  ["recent", "最近", Clock]
];

export function Sidebar(props: SidebarProps) {
  const {
    sidebarCollapsed,
    onExpandSidebar,
    onCollapseSidebar,
    leftPaneMode,
    onLeftPaneModeChange,
    title,
    activeNote,
    editorCharCount,
    outlineItems,
    onJumpToOutline,
    onOpenFind,
    onCreateNote,
    onHideWindow,
    onOpenSettings,
    alwaysOnTop,
    onToggleAlwaysOnTop,
    query,
    onQueryChange,
    viewMode,
    onViewModeChange,
    allFolders,
    selectedFolder,
    onSelectFolder,
    onRemoveFolder,
    allTags,
    selectedTag,
    onSelectTag,
    onRemoveTag,
    onRenameTag,
    openTasks,
    onOpenTaskNote,
    onToggleTask,
    filteredNotes,
    activeId,
    searchKeyword,
    onSelectNote,
    onTogglePin,
    onToggleFavorite,
    onToggleArchive,
    onDeleteNote,
    onRestoreNote,
    onPurgeNote
  } = props;

  if (sidebarCollapsed) {
    return (
      <aside className="sidebar">
        <div className="sidebar-rail">
          <button
            className="icon-button"
            title="展开侧边栏"
            aria-label="展开侧边栏"
            onClick={onExpandSidebar}
            type="button"
          >
            <PanelLeftOpen size={18} />
          </button>
          <button
            className={leftPaneMode === "document" ? "icon-button is-active" : "icon-button"}
            title="文档目录"
            aria-label="文档目录"
            onClick={() => onLeftPaneModeChange("document")}
            type="button"
          >
            <List size={18} />
          </button>
          <button
            className={leftPaneMode === "files" ? "icon-button is-active" : "icon-button"}
            title="文档列表"
            aria-label="文档列表"
            onClick={() => onLeftPaneModeChange("files")}
            type="button"
          >
            <FolderOpen size={18} />
          </button>
          <button
            className="icon-button primary-icon"
            title="新记录"
            aria-label="新记录"
            onClick={onCreateNote}
            type="button"
          >
            <Plus size={18} />
          </button>
          <button className="icon-button" title="设置" aria-label="设置" onClick={onOpenSettings} type="button">
            <SettingsIcon size={18} />
          </button>
                    <button
            className={alwaysOnTop ? "icon-button is-active" : "icon-button"}
            title={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
            aria-label={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
            onClick={onToggleAlwaysOnTop}
            type="button"
          >
            <Pin size={18} />
          </button>
          <button className="icon-button" title="隐藏窗口" aria-label="隐藏窗口" onClick={onHideWindow} type="button">
            <EyeOff size={18} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="brand-row compact">
        <div className="workspace-badge">
          <strong>我的空间</strong>
          <span>{leftPaneMode === "document" ? "文档目录" : "文档列表"}</span>
        </div>
        <div className="brand-actions">
          <button className="icon-button" title="设置" aria-label="设置" onClick={onOpenSettings} type="button">
            <SettingsIcon size={18} />
          </button>
          <button
            className="icon-button"
            title="收起侧边栏"
            aria-label="收起侧边栏"
            onClick={onCollapseSidebar}
            type="button"
          >
            <PanelLeftClose size={18} />
          </button>
                    <button
            className={alwaysOnTop ? "icon-button is-active" : "icon-button"}
            title={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
            aria-label={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
            onClick={onToggleAlwaysOnTop}
            type="button"
          >
            <Pin size={18} />
          </button>
          <button className="icon-button" title="隐藏窗口" aria-label="隐藏窗口" onClick={onHideWindow} type="button">
            <EyeOff size={18} />
          </button>
        </div>
      </div>

      <div className="sidebar-body">
        {leftPaneMode === "document" ? (
          <>
            <div className="sidebar-summary-card">
              <span>当前文档</span>
              <strong>{title.trim() || activeNote?.title || "未命名记录"}</strong>
              <p>
                {editorCharCount} 字 · {outlineItems.length} 个标题
              </p>
            </div>

            <div className="sidebar-quick-actions">
              <button type="button" className="sidebar-chip is-active">
                <List size={14} />
                目录
              </button>
              <button type="button" className="icon-button" title="查找" aria-label="查找" onClick={onOpenFind}>
                <Search size={16} />
              </button>
              <button type="button" className="icon-button" title="新记录" aria-label="新记录" onClick={onCreateNote}>
                <Plus size={16} />
              </button>
            </div>

            <div className="sidebar-list-header">
              <span>目录</span>
              <strong>{outlineItems.length}</strong>
            </div>

            {outlineItems.length > 0 ? (
              <nav className="document-outline-list" aria-label="当前文档目录">
                {outlineItems.map((item, index) => (
                  <button
                    key={`${item.pos}-${index}`}
                    type="button"
                    className={`outline-link outline-level-${item.level}`}
                    onMouseDown={keepEditorFocus}
                    onClick={() => onJumpToOutline(item)}
                  >
                    {item.text}
                  </button>
                ))}
              </nav>
            ) : (
              <div className="document-outline-empty">
                <strong>目录</strong>
                <p>使用标题创建目录。</p>
              </div>
            )}
          </>
        ) : (
          <>
            <button className="new-note-button" type="button" onClick={onCreateNote}>
              <Plus size={18} />
              新记录
            </button>

            <div className="search-box">
              <Search size={17} />
              <div className="search-box-body">
                <span className="search-box-label">检索</span>
                <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索记录" />
              </div>
              {query ? (
                <button
                  type="button"
                  className="search-box-clear"
                  aria-label="清除搜索"
                  title="清除搜索"
                  onClick={() => onQueryChange("")}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className="view-switch" aria-label="记录视图">
              {VIEW_MODES.map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  className={viewMode === mode ? "is-active" : ""}
                  onClick={() => onViewModeChange(mode)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {allFolders.length > 0 ? (
              <div className="folder-filter" aria-label="文件夹筛选">
                <button type="button" className={selectedFolder ? "" : "is-active"} onClick={() => onSelectFolder("")}>
                  <Folder size={13} />
                  全部文件夹
                </button>
                {allFolders.map((folder) => (
                  <div className="metadata-filter-item" key={folder}>
                    <button
                      type="button"
                      className={selectedFolder === folder ? "is-active" : ""}
                      onClick={() => onSelectFolder(folder)}
                    >
                      <Folder size={13} />
                      {folder}
                    </button>
                    <button
                      type="button"
                      className="metadata-filter-remove"
                      aria-label={`删除文件夹 ${folder}`}
                      title={`删除文件夹 ${folder}`}
                      onClick={() => onRemoveFolder(folder)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {allTags.length > 0 ? (
              <div className="tag-filter" aria-label="标签筛选">
                <button type="button" className={selectedTag ? "" : "is-active"} onClick={() => onSelectTag("")}>
                  全部
                </button>
                {allTags.map((tag) => (
                  <div className="metadata-filter-item" key={tag}>
                    <button
                      type="button"
                      className={selectedTag === tag ? "is-active" : ""}
                      onClick={() => onSelectTag(tag)}
                    >
                      {tag}
                    </button>
                    <button
                      type="button"
                      className="metadata-filter-remove"
                      aria-label={`重命名标签 ${tag}`}
                      title={`重命名标签 ${tag}`}
                      onClick={() => onRenameTag(tag)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="metadata-filter-remove"
                      aria-label={`删除标签 ${tag}`}
                      title={`删除标签 ${tag}`}
                      onClick={() => onRemoveTag(tag)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="sidebar-list-header">
              <span>{viewMode === "recent" ? "最近编辑" : viewMode === "tasks" ? "未完成的待办" : "记录列表"}</span>
              <strong>{viewMode === "tasks" ? openTasks.length : filteredNotes.length}</strong>
            </div>

            {viewMode === "tasks" ? (
              <nav className="note-list" aria-label="待办汇总">
                {openTasks.length === 0 ? (
                  <p className="note-list-empty" role="status">
                    没有未完成的待办事项
                  </p>
                ) : (
                  openTasks.map((task, index) => (
                    <div
                      key={`${task.noteId}-${index}`}
                      className="note-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenTaskNote(task.noteId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenTaskNote(task.noteId);
                        }
                      }}
                    >
                      <div className="note-item-header">
                        <span className="note-title">
                          <button
                            type="button"
                            className="task-toggle"
                            aria-label={`完成待办：${task.text || "未命名待办"}`}
                            title="标记完成"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleTask(task);
                            }}
                          >
                            <Square size={15} />
                          </button>
                          <span className="note-title-text">{task.text || "未命名待办"}</span>
                        </span>
                      </div>
                      <span className="note-excerpt">{task.noteTitle}</span>
                      <span className="note-time">{formatTime(task.updatedAt)}</span>
                    </div>
                  ))
                )}
              </nav>
            ) : (
            <nav className="note-list">
              {filteredNotes.length === 0 ? (
                <p className="note-list-empty" role="status">
                  {query || selectedFolder || selectedTag ? "没有匹配的记录" : "这里还没有记录"}
                </p>
              ) : (
                filteredNotes.map((note) => (
                  <div
                    key={note.id}
                    className={note.id === activeId ? "note-item is-active" : "note-item"}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(event) => {
                      if (!(event.target instanceof HTMLElement) || event.target.closest("button")) return;
                      event.preventDefault();
                    }}
                    onClick={() => onSelectNote(note.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectNote(note.id);
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
                            onTogglePin(note.id);
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
                                onRestoreNote(note.id);
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
                                onPurgeNote(note.id);
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
                                onToggleFavorite(note.id);
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
                                onToggleArchive(note.id);
                              }}
                            >
                              {note.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                            </button>
                          </>
                        )}
                        {!note.trashedAt ? (
                          <button
                            type="button"
                            title="移到回收站"
                            aria-label="移到回收站"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteNote(note.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
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
                ))
              )}
            </nav>
            )}
          </>
        )}
      </div>

      <div
        className={leftPaneMode === "files" ? "sidebar-mode-switch is-files" : "sidebar-mode-switch"}
        aria-label="左侧内容切换"
      >
        <span className="sidebar-mode-thumb" aria-hidden="true" />
        <button
          type="button"
          className={leftPaneMode === "document" ? "sidebar-mode-button is-active" : "sidebar-mode-button"}
          onClick={() => onLeftPaneModeChange("document")}
        >
          <List size={16} />
          文档
        </button>
        <button
          type="button"
          className={leftPaneMode === "files" ? "sidebar-mode-button is-active" : "sidebar-mode-button"}
          onClick={() => onLeftPaneModeChange("files")}
        >
          <FolderOpen size={16} />
          文件
        </button>
      </div>
    </aside>
  );
}
