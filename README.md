# 随记

随记是一个 Windows 桌面端本地笔记工具，支持全局快捷键呼出、富文本编辑、自动保存、托盘运行、备份恢复和批量导入导出。

当前版本：`0.7.3`

## 快速开始

```bash
npm install
npm run dev
```

开发环境需要 Node.js `22.12` 或更高版本。默认快捷键：`Ctrl + Alt + J`。

## 打包 exe

```bash
npm run dist
```

打包产物会生成到 `release/` 目录，默认生成 Windows 安装包。

如果 Electron 或打包工具下载超时，可以在 PowerShell 中使用镜像后再打包：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist
```

## 主要功能

- 全局快捷键呼出/隐藏窗口，支持快捷键录制和冲突检测。
- 托盘运行、托盘快速新建、托盘保存剪贴板文本或图片为记录。
- 开机自动启动、启动后静默托盘。
- 富文本编辑：标题、加粗、斜体、下划线、删除线、高亮、列表、任务列表、引用、代码块、分割线、链接和图片。
- 图片粘贴，支持截图或剪贴板图片直接进入编辑器。
- 标签、文件夹、收藏、归档、回收站、最近编辑时间线。
- 全文搜索高亮，支持 `tag:`、`folder:`、`fav`、`archive`、`trash` 搜索语法。
- 笔记使用本地 SQLite 数据库保存，并通过 FTS5 提供全文检索索引。
- 字数统计、阅读时间、大纲目录和标题跳转。
- 主题、字体、行宽设置和深色模式。
- 当前记录导出 HTML、Markdown、TXT、JSON。
- Markdown 导入和全库批量导出 HTML、Markdown、TXT、JSON。
- 备份/恢复整库，可修改数据目录并迁移现有数据。
- 当前记录版本历史恢复，基于本地 `backups/` 文件。
- 隐藏窗口后可自动遮挡内容，并可设置隐私密码。
- 外部链接通过系统浏览器打开，导出前提示明文风险。

## 版本记录

详见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

本项目基于 MIT License 开源，详见 [LICENSE](LICENSE)。
