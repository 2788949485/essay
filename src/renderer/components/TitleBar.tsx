import { useEffect, useRef, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";
import type { ExportFormat } from "../constants";
import type { BatchExportFormat } from "../../shared/types";

type TitleBarProps = {
  onCreateNote: () => void;
  onSave: () => void;
  onOpenHistory: () => void;
  onExportNote: (format: ExportFormat) => void;
  onBatchExport: (format: BatchExportFormat) => void;
  onOpenSettings: () => void;
  onHideWindow: () => void;
  onAbout: () => void;
  onQuit: () => void;
};

const NOTE_EXPORTS: Array<{ format: ExportFormat; label: string }> = [
  { format: "pdf", label: "导出 PDF" },
  { format: "html", label: "导出 HTML" },
  { format: "md", label: "导出 Markdown" },
  { format: "txt", label: "导出 TXT" },
  { format: "json", label: "导出 JSON" }
];

const BATCH_EXPORTS: Array<{ format: BatchExportFormat; label: string }> = [
  { format: "md", label: "批量导出 Markdown" },
  { format: "html", label: "批量导出 HTML" },
  { format: "txt", label: "批量导出 TXT" },
  { format: "json", label: "批量导出 JSON" }
];

export function TitleBar(props: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<"note" | "batch" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function act(fn: () => void) {
    return () => {
      setMenuOpen(false);
      setExpanded(null);
      fn();
    };
  }

  return (
    <div className="titlebar" ref={rootRef}>
      <div className="titlebar-leading">
        <span className="titlebar-brand" aria-hidden="true">
          <i className="titlebar-logo" />
          随记
        </span>
        <button
          type="button"
          className="icon-button titlebar-menu-trigger"
          title="菜单"
          aria-label="菜单"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <MenuIcon size={18} />
        </button>

        {menuOpen ? (
          <div className="titlebar-menu" role="menu" aria-label="应用菜单">
          <button type="button" role="menuitem" onClick={act(props.onCreateNote)}>
            新建记录
          </button>
          <button type="button" role="menuitem" onClick={act(props.onSave)}>
            保存
          </button>
          <button type="button" role="menuitem" onClick={act(props.onOpenHistory)}>
            版本历史
          </button>
          <button
            type="button"
            role="menuitem"
            aria-expanded={expanded === "note"}
            onClick={() => setExpanded((current) => (current === "note" ? null : "note"))}
          >
            导出当前记录
          </button>
          {expanded === "note" ? (
            <div className="titlebar-submenu">
              {NOTE_EXPORTS.map((item) => (
                <button key={item.format} type="button" role="menuitem" onClick={act(() => props.onExportNote(item.format))}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            aria-expanded={expanded === "batch"}
            onClick={() => setExpanded((current) => (current === "batch" ? null : "batch"))}
          >
            批量导出记录
          </button>
          {expanded === "batch" ? (
            <div className="titlebar-submenu">
              {BATCH_EXPORTS.map((item) => (
                <button key={item.format} type="button" role="menuitem" onClick={act(() => props.onBatchExport(item.format))}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="titlebar-menu-divider" />
          <button type="button" role="menuitem" onClick={act(props.onOpenSettings)}>
            设置
          </button>
          <button type="button" role="menuitem" onClick={act(props.onHideWindow)}>
            隐藏窗口
          </button>
          <button type="button" role="menuitem" onClick={act(props.onAbout)}>
            关于随记
          </button>
          <div className="titlebar-menu-divider" />
          <button type="button" role="menuitem" onClick={act(props.onQuit)}>
            退出
          </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
