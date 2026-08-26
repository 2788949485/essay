import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { SaveState } from "../constants";

type TopBarProps = {
  /** 回收站笔记：标题与属性只读 */
  readOnly?: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  title: string;
  onTitleChange: (value: string) => void;
  folderPreview: string;
  metaTagsPreview: string[];
  hasMetaInfo: boolean;
  metaEditorOpen: boolean;
  onToggleMetaEditor: () => void;
  tagsDraft: string;
  onTagsChange: (value: string) => void;
  folderDraft: string;
  onFolderChange: (value: string) => void;
  saveState: SaveState;
  editorCharCount: number;
  readingMinutes: number;
};

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "已保存",
  dirty: "有修改",
  saving: "保存中",
  saved: "已保存",
  error: "保存失败"
};

export function TopBar(props: TopBarProps) {
  const {
    readOnly = false,
    sidebarCollapsed,
    onToggleSidebar,
    title,
    onTitleChange,
    folderPreview,
    metaTagsPreview,
    hasMetaInfo,
    metaEditorOpen,
    onToggleMetaEditor,
    tagsDraft,
    onTagsChange,
    folderDraft,
    onFolderChange,
    saveState,
    editorCharCount,
    readingMinutes
  } = props;

  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button
          className={
            sidebarCollapsed ? "icon-button workspace-nav-toggle is-collapsed" : "icon-button workspace-nav-toggle"
          }
          title={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
          aria-label={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
          onClick={onToggleSidebar}
          type="button"
        >
          <span className="workspace-nav-track" aria-hidden="true">
            <span className="workspace-nav-thumb" />
            <span className="workspace-nav-slot workspace-nav-slot-expand">
              <PanelLeftOpen size={15} />
            </span>
            <span className="workspace-nav-slot workspace-nav-slot-collapse">
              <PanelLeftClose size={15} />
            </span>
          </span>
        </button>
        <div className="title-group">
          <div className="workspace-crumb">
            {folderPreview || "未分类"} / {title.trim() || "未命名记录"}
          </div>
          <input
            className="title-input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="未命名记录"
            disabled={readOnly}
          />
          <div className="meta-summary-row">
            <button
              type="button"
              className={metaEditorOpen ? "meta-summary is-open" : "meta-summary"}
              onClick={onToggleMetaEditor}
              disabled={readOnly}
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
          {metaEditorOpen && !readOnly ? (
            <div className="meta-input-row">
              <input
                className="tags-input"
                value={tagsDraft}
                onChange={(event) => onTagsChange(event.target.value)}
                placeholder="标签，用逗号分隔"
              />
              <input
                className="folder-input"
                value={folderDraft}
                onChange={(event) => onFolderChange(event.target.value)}
                placeholder="文件夹"
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="topbar-actions">
        <div className="topbar-statuses">
          <span className={`save-status ${saveState}`}>{STATUS_TEXT[saveState]}</span>
          <span className="doc-stats">
            {editorCharCount} 字 · 阅读 {readingMinutes} 分钟
          </span>
        </div>
      </div>
    </header>
  );
}
