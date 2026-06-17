# 随记

随记是一个面向 Windows 的本地桌面笔记工具，主打全局快捷键呼出、富文本编辑、自动保存和本地数据可控。

它适合用来记录临时想法、整理日常资料、保存截图说明、维护结构化笔记，也支持将当前记录或整库内容导出为常见明文格式。

当前版本：`0.8.0`

## 功能概览

### 1. 快速记录

- 支持全局快捷键呼出窗口，默认是 `Ctrl + Alt + J`
- 支持隐藏到托盘、启动后隐藏到托盘、开机自启动
- 托盘菜单支持快速新建记录
- 可将剪贴板文本或图片快速保存为新记录

### 2. 富文本编辑

- 支持标题、小标题、正文、说明等文本类型
- 支持粗体、斜体、删除线、行内代码、高亮
- 支持引用、分隔线、有序列表、无序列表、任务列表
- 支持表格、图片、链接
- 支持字体、颜色、自定义颜色
- 支持“焦点”和“块”两种文本装饰样式
- 支持折叠块，并可导出为层级化 Markdown 列表结构
- 支持查找、替换、全文字数统计和阅读时间估算

### 3. 记录管理

- 支持标签与文件夹
- 支持置顶、收藏、归档、回收站
- 支持最近编辑时间线视图
- 支持按标题、正文、标签、文件夹进行全文检索
- 支持搜索语法：
  - `tag:标签名`
  - `folder:文件夹名`
  - `fav` / `favorite` / `收藏`
  - `archive` / `归档`
  - `trash` / `回收站`

### 4. 数据与安全

- 记录保存在本地 SQLite 数据库
- 内置 FTS5 全文索引，搜索速度更稳定
- 支持历史版本恢复
- 支持整库备份与恢复
- 支持修改数据目录，并迁移已有数据
- 支持隐藏窗口后自动锁定
- 支持设置隐私密码
- 外部链接通过系统浏览器打开

### 5. 导入与导出

- 当前记录支持导出为：
  - `PDF`
  - `HTML`
  - `Markdown`
  - `TXT`
  - `JSON`
- 支持批量导出：
  - `HTML`
  - `Markdown`
  - `TXT`
  - `JSON`
- 支持导入 Markdown 文件
- `Markdown` 和 `TXT` 导出正文会自动包含记录标题

## 运行环境

- Windows
- Node.js `22.12` 或更高版本
- npm

## 本地开发

```bash
npm install
npm run dev
```

默认开发模式会同时启动：

- Vite 渲染进程
- Electron 主进程 TypeScript 编译监听
- Electron 应用

## 打包

生成 Windows 安装包：

```bash
npm run dist
```

生成便携版：

```bash
npm run dist:portable
```

仅生成解包目录：

```bash
npm run dist:dir
```

打包产物默认输出到 `release/` 目录。

如果 Electron 或 electron-builder 下载较慢，可以在 PowerShell 中使用镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist
```

## 数据说明

应用默认使用本机用户数据目录保存数据，主要包括：

- SQLite 数据库
- 设置文件
- 本地备份

导出文件属于明文文件，保存到公共目录、同步盘或共享设备前，请先确认风险。

## 适合的使用场景

- 快速记录临时想法
- 保存带格式的工作笔记
- 维护带层级结构的折叠式文档
- 整理带标签、文件夹和归档状态的资料
- 通过 Markdown / HTML / TXT / JSON 做离线归档

## 项目结构

```text
src/main      Electron 主进程
src/renderer  React + TipTap 界面与编辑器
src/shared    主进程与渲染进程共享类型和转换逻辑
build         图标等打包资源
release       打包输出目录
```

## 版本记录

详见 [CHANGELOG.md](CHANGELOG.md)

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
