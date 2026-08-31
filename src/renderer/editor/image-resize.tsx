import { useRef } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

function ResizableImageView({ node, updateAttributes }: NodeViewProps) {
  const width = typeof node.attrs.width === "number" ? node.attrs.width : null;
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  function onResizeStart(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { startX: event.clientX, startW: width ?? (event.currentTarget.parentElement?.querySelector("img")?.clientWidth || 300) };
    const onMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      const next = Math.max(80, dragRef.current.startW + (moveEvent.clientX - dragRef.current.startX));
      updateAttributes({ width: next });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <NodeViewWrapper className="image-block">
      <img
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) || ""}
        style={{ width: width ? `${width}px` : undefined }}
        draggable={false}
      />
      <span
        className="image-resize-handle"
        contentEditable={false}
        title="拖动调整宽度"
        onMouseDown={onResizeStart}
      />
    </NodeViewWrapper>
  );
}

export const ResizableImageExtension = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("width");
          const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {})
      }
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  }
});
