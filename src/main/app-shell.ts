import type { MenuItemConstructorOptions } from "electron";
import type { AppSettings, BatchExportFormat, ExportPayload, NoteRecord } from "../shared/types.js";

type MenuChannel =
  | "menu:new-note"
  | "menu:save"
  | "menu:history"
  | "menu:settings"
  | "menu:find"
  | "menu:replace"
  | "menu:export-note"
  | "menu:batch-export"
  | "notes:reload";

type ShellCallbacks = {
  appQuit: () => void;
  hideWindow: () => void;
  onAbout: () => void;
  onClipboardNote: () => Promise<NoteRecord>;
  sendMenu: (channel: MenuChannel, payload?: ExportPayload["format"] | BatchExportFormat | string) => void;
  showWindow: () => void;
};

export function buildApplicationMenuTemplate(callbacks: ShellCallbacks): MenuItemConstructorOptions[] {
  const exportNoteMenu: MenuItemConstructorOptions[] = [
    { label: "导出 PDF", click: () => callbacks.sendMenu("menu:export-note", "pdf") },
    { label: "导出 HTML", click: () => callbacks.sendMenu("menu:export-note", "html") },
    { label: "导出 Markdown", click: () => callbacks.sendMenu("menu:export-note", "md") },
    { label: "导出 TXT", click: () => callbacks.sendMenu("menu:export-note", "txt") },
    { label: "导出 JSON", click: () => callbacks.sendMenu("menu:export-note", "json") }
  ];

  const batchExportMenu: MenuItemConstructorOptions[] = [
    { label: "批量导出 Markdown", click: () => callbacks.sendMenu("menu:batch-export", "md") },
    { label: "批量导出 HTML", click: () => callbacks.sendMenu("menu:batch-export", "html") },
    { label: "批量导出 TXT", click: () => callbacks.sendMenu("menu:batch-export", "txt") },
    { label: "批量导出 JSON", click: () => callbacks.sendMenu("menu:batch-export", "json") }
  ];

  return [
    {
      label: "文件",
      submenu: [
        {
          label: "新建记录",
          accelerator: "CommandOrControl+N",
          click: () => callbacks.sendMenu("menu:new-note")
        },
        {
          label: "保存",
          accelerator: "CommandOrControl+S",
          click: () => callbacks.sendMenu("menu:save")
        },
        {
          label: "版本历史",
          click: () => callbacks.sendMenu("menu:history")
        },
        {
          label: "导出当前记录",
          submenu: exportNoteMenu
        },
        {
          label: "批量导出记录",
          submenu: batchExportMenu
        },
        {
          label: "设置",
          click: () => callbacks.sendMenu("menu:settings")
        },
        { type: "separator" },
        {
          label: "隐藏窗口",
          // 不绑定 Escape：Esc 是界面里的取消/关闭键（弹窗、查找面板），隐藏走侧栏按钮或全局热键
          click: callbacks.hideWindow
        },
        {
          label: "退出",
          accelerator: "CommandOrControl+Q",
          click: callbacks.appQuit
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        {
          label: "查找",
          accelerator: "CommandOrControl+F",
          click: () => callbacks.sendMenu("menu:find")
        },
        {
          label: "替换",
          accelerator: "CommandOrControl+H",
          click: () => callbacks.sendMenu("menu:replace")
        },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于随记",
          click: callbacks.onAbout
        }
      ]
    }
  ];
}

export function buildTrayMenuTemplate(settings: AppSettings, callbacks: ShellCallbacks): MenuItemConstructorOptions[] {
  return [
    { label: "显示随记", click: callbacks.showWindow },
    {
      label: "快速新建",
      click: () => {
        callbacks.showWindow();
        callbacks.sendMenu("menu:new-note");
      }
    },
    {
      label: "保存剪贴板为记录",
      click: async () => {
        const note = await callbacks.onClipboardNote();
        callbacks.showWindow();
        callbacks.sendMenu("notes:reload", note.id);
      }
    },
    { type: "separator" },
    {
      label: `快捷键：${settings.hotkey.replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ")}`,
      enabled: false
    },
    { type: "separator" },
    {
      label: "退出",
      click: callbacks.appQuit
    }
  ];
}
