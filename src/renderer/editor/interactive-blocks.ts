const EDITOR_INTERACTIVE_BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "UL", "OL", "TABLE", "HR", "IMG"]);

/** 从事件目标向上找到编辑器里的顶级可交互块（段落、表格、折叠块等） */
export function findInteractiveEditorBlock(target: globalThis.Node | null, root: HTMLElement | null) {
  if (!target || !root) return null;

  let element = target instanceof HTMLElement ? target : target.parentElement;
  while (element && element !== root) {
    if (element.classList.contains("collapsible-block")) return element;
    if (element.classList.contains("tableWrapper") && element.parentElement === root) return element;
    if ((element.tagName === "TD" || element.tagName === "TH") && root.contains(element)) {
      return element.closest("table");
    }
    if (element.parentElement === root && EDITOR_INTERACTIVE_BLOCK_TAGS.has(element.tagName)) {
      return element;
    }
    element = element.parentElement;
  }

  return null;
}
