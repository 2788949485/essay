import { Search } from "lucide-react";

type FindPanelProps = {
  findInputRef: React.Ref<HTMLInputElement>;
  findQuery: string;
  onFindQueryChange: (value: string) => void;
  replaceOpen: boolean;
  replaceValue: string;
  onReplaceValueChange: (value: string) => void;
  matchCount: number;
  findIndex: number;
  onFindNext: (direction: 1 | -1) => void;
  onReplaceCurrent: () => void;
  onReplaceAll: () => void;
  onToggleReplace: () => void;
  onClose: () => void;
};

export function FindPanel(props: FindPanelProps) {
  const {
    findInputRef,
    findQuery,
    onFindQueryChange,
    replaceOpen,
    replaceValue,
    onReplaceValueChange,
    matchCount,
    findIndex,
    onFindNext,
    onReplaceCurrent,
    onReplaceAll,
    onToggleReplace,
    onClose
  } = props;

  return (
    <div className="find-panel">
      <div className="find-panel-fields">
        <span className="find-search-chip" aria-hidden="true">
          <Search size={14} />
        </span>
        <div className="find-inputs">
          <input
            ref={findInputRef}
            value={findQuery}
            autoFocus
            placeholder="查找"
            onChange={(event) => onFindQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onFindNext(event.shiftKey ? -1 : 1);
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              }
            }}
          />
          {replaceOpen ? (
            <input
              value={replaceValue}
              placeholder="替换为"
              onChange={(event) => onReplaceValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onReplaceCurrent();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onClose();
                }
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="find-panel-actions">
        <span className="find-count">{findQuery ? `${matchCount ? findIndex + 1 : 0}/${matchCount}` : "0/0"}</span>
        <div className="find-action-group">
          <button type="button" onClick={() => onFindNext(-1)}>
            上一个
          </button>
          <button type="button" onClick={() => onFindNext(1)}>
            下一个
          </button>
        </div>
        <button type="button" className={replaceOpen ? "is-active" : undefined} onClick={onToggleReplace}>
          替换
        </button>
        {replaceOpen ? (
          <div className="find-action-group">
            <button type="button" onClick={onReplaceCurrent}>
              替换当前
            </button>
            <button type="button" onClick={onReplaceAll}>
              全部替换
            </button>
          </div>
        ) : null}
        <button type="button" className="find-close-button" aria-label="关闭查找" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
