import { EditorContent, FloatingMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plus } from "lucide-react";
import type { BlockMenuCommand } from "../constants";
import { isEmptyParagraphSelection } from "../utils/text";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

type EditorAreaProps = {
  editor: Editor | null;
  editorWrapRef: React.Ref<HTMLDivElement>;
  imageInputRef: React.Ref<HTMLInputElement>;
  trashed: boolean;
  blockMenuOpen: boolean;
  blockMenuCommands: BlockMenuCommand[];
  onToggleBlockMenu: () => void;
  onApplyBlockMenuCommand: (command: BlockMenuCommand) => void;
  onHoverBlock: (target: EventTarget | null) => void;
  onLeave: () => void;
  onFocusEnd: () => void;
  onFocus: () => void;
  onImageChosen: (file: File | undefined) => void;
};

/** 光标位于列表/任务项内部时隐藏悬浮 +，避免遮住任务复选框 */
function inListItemContext(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "taskItem" || name === "listItem") return true;
  }
  return false;
}

export function EditorArea(props: EditorAreaProps) {
  const {
    editor,
    editorWrapRef,
    imageInputRef,
    trashed,
    blockMenuOpen,
    blockMenuCommands,
    onToggleBlockMenu,
    onApplyBlockMenuCommand,
    onHoverBlock,
    onLeave,
    onFocusEnd,
    onFocus,
    onImageChosen
  } = props;

  return (
    <div
      ref={editorWrapRef}
      className="editor-wrap"
      onMouseMove={(event) => {
        if (event.buttons !== 0) return;
        onHoverBlock(event.target);
      }}
      onMouseLeave={onLeave}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onFocusEnd();
        }
      }}
      onClick={onFocus}
    >
      <input
        ref={imageInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          onImageChosen(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {editor ? (
        <FloatingMenu
          editor={editor}
          tippyOptions={{
            duration: 120,
            placement: "left-start",
            maxWidth: "none",
            offset: [0, 8],
            zIndex: 40000
          }}
          shouldShow={({ editor }) => isEmptyParagraphSelection(editor) && !trashed && !inListItemContext(editor)}
        >
          <div className="block-insert-anchor">
            <button
              type="button"
              className={blockMenuOpen ? "block-insert-trigger is-open" : "block-insert-trigger"}
              aria-label="插入块"
              title="插入块"
              onMouseDown={(event) => {
                event.preventDefault();
                onToggleBlockMenu();
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
                      onApplyBlockMenuCommand(command);
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
        <EditorErrorBoundary>
          <EditorContent editor={editor} />
        </EditorErrorBoundary>
      ) : null}
    </div>
  );
}
