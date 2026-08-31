import Placeholder from "@tiptap/extension-placeholder";

// 占位符只挂在段落上：插入折叠块等块级内容后文档仍"无文字"，
// 若挂在块节点上会把「开始记录...」叠在块上
export const EditorPlaceholder = Placeholder.configure({
  placeholder: ({ node }) => (node.type.name === "paragraph" ? "开始记录..." : "")
});
