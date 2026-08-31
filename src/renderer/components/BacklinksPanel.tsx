import { Link2, TextSearch } from "lucide-react";

export type BacklinkItem = {
  id: string;
  title: string;
  kind: "linked" | "unlinked";
};

type BacklinksPanelProps = {
  items: BacklinkItem[];
  onJump: (id: string) => void;
};

export function BacklinksPanel({ items, onJump }: BacklinksPanelProps) {
  if (items.length === 0) return null;
  return (
    <div className="backlinks-panel">
      <strong className="backlinks-title">反向链接 · {items.length}</strong>
      <div className="backlinks-list">
        {items.map((item) => (
          <button key={`${item.kind}-${item.id}`} type="button" className="backlinks-item" onClick={() => onJump(item.id)}>
            {item.kind === "linked" ? <Link2 size={14} /> : <TextSearch size={14} />}
            <span>{item.title}</span>
            <em>{item.kind === "linked" ? "链接" : "提及"}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
