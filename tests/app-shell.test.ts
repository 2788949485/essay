import { describe, expect, it, vi } from "vitest";
import { buildApplicationMenuTemplate, buildTrayMenuTemplate } from "../src/main/app-shell";
import { DEFAULT_SETTINGS } from "../src/main/security";

function callbacks() {
  return {
    appQuit: vi.fn(),
    hideWindow: vi.fn(),
    onAbout: vi.fn(),
    onClipboardNote: vi.fn(async () => ({ id: "note-1" })),
    sendMenu: vi.fn(),
    showWindow: vi.fn()
  };
}

describe("app shell templates", () => {
  it("应用菜单包含导出和设置入口", () => {
    const template = buildApplicationMenuTemplate(callbacks());
    const fileMenu = template[0];
    expect(fileMenu.label).toBe("文件");
    expect(fileMenu.submenu).toBeTruthy();
    const labels = (fileMenu.submenu as Array<{ label?: string }>).map((item) => item.label).filter(Boolean);
    expect(labels).toContain("导出当前记录");
    expect(labels).toContain("批量导出记录");
    expect(labels).toContain("设置");
  });

  it("托盘菜单包含快捷键展示和剪贴板入口", () => {
    const template = buildTrayMenuTemplate(
      {
        ...DEFAULT_SETTINGS,
        hasPrivacyPin: false,
        storageUnlocked: true
      },
      callbacks()
    );
    const labels = template.map((item) => item.label).filter(Boolean);
    expect(labels).toContain("保存剪贴板为记录");
    expect(labels).toContain("快捷键：Ctrl + Alt + J");
  });
});
