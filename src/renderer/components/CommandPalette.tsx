import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Terminal } from "lucide-react";

export type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  kind: "note" | "command";
  run: () => void;
};

type CommandPaletteProps = {
  items: CommandPaletteItem[];
  onClose: () => void;
};

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items.slice(0, 50);
    return items.filter((item) => item.label.toLowerCase().includes(keyword)).slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function pick(item: CommandPaletteItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="modal-backdrop command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索记录或输入命令..."
          aria-label="搜索记录或命令"
        />
        <div className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <p className="note-list-empty" role="status">
              没有匹配的记录或命令
            </p>
          ) : (
            filtered.map((item, index) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "command-palette-item is-active" : "command-palette-item"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(item)}
              >
                {item.kind === "note" ? <FileText size={14} /> : <Terminal size={14} />}
                <span className="command-palette-label">{item.label}</span>
                {item.hint ? <span className="command-palette-hint">{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
