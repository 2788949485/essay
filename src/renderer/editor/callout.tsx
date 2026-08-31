import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { AlertTriangle, Info, Lightbulb, OctagonAlert } from "lucide-react";

export const CALLOUT_TYPES = ["info", "tip", "warning", "danger"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const CALLOUT_META: Record<CalloutType, { label: string; Icon: typeof Info }> = {
  info: { label: "信息", Icon: Info },
  tip: { label: "提示", Icon: Lightbulb },
  warning: { label: "警告", Icon: AlertTriangle },
  danger: { label: "危险", Icon: OctagonAlert },
};

function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const rawType = (node.attrs.calloutType as string) in CALLOUT_META ? (node.attrs.calloutType as CalloutType) : "info";
  const { Icon } = CALLOUT_META[rawType];
  return (
    <NodeViewWrapper className={`callout callout-${rawType}`} data-callout={rawType}>
      <div className="callout-head" contentEditable={false}>
        <Icon size={16} className="callout-icon" />
        <select
          className="callout-type"
          value={rawType}
          aria-label="提示块类型"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ calloutType: event.target.value })}
        >
          {CALLOUT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CALLOUT_META[type].label}
            </option>
          ))}
        </select>
      </div>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}

export const CalloutExtension = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block*",
  defining: true,
  addAttributes() {
    return {
      calloutType: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-callout") || "info",
        renderHTML: (attributes) => ({ "data-callout": attributes.calloutType })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  }
});
