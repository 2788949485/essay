# 随记开发文档

## 目标

随记是一个轻量桌面记录工具，面向“想到就记”的使用场景。用户通过全局快捷键呼出窗口，像文档编辑器一样记录内容，应用自动保存到本地。

## 技术选型

- 桌面运行时：Electron
- 渲染层：React + Vite + TypeScript
- 富文本编辑器：TipTap，底层是 ProseMirror
- 图标：lucide-react
- 打包：electron-builder
- 存储：Electron `userData` 目录下的 JSON 文件

选择 Electron 的原因是它对 Windows 全局快捷键、托盘、窗口生命周期和 exe 打包支持成熟。当前版本先用 JSON 文件存储，降低安装和分发复杂度；当记录量、全文检索、标签体系变复杂时，可以在主进程存储层替换为 SQLite。

## 工程结构

```text
.
├─ src
│  ├─ main
│  │  ├─ main.ts       # Electron 主进程、窗口、托盘、快捷键、文件读写
│  │  └─ preload.ts    # 安全暴露 IPC API 给渲染层
│  ├─ renderer
│  │  ├─ App.tsx       # 主界面和编辑器逻辑
│  │  ├─ main.tsx      # React 入口
│  │  └─ styles.css    # 应用样式
│  └─ shared
│     └─ types.ts      # 主进程和渲染层共享类型
├─ docs
│  └─ DEVELOPMENT.md
├─ package.json
├─ tsconfig.json
├─ tsconfig.main.json
└─ vite.config.ts
```

## 核心设计

### 主进程职责

`src/main/main.ts` 负责：

- 创建主窗口
- 注册默认快捷键 `CommandOrControl+Alt+J`
- 创建系统托盘菜单
- 关闭窗口时隐藏到托盘
- 管理本地记录文件
- 处理导出文件对话框
- 读写应用设置

主进程只通过 IPC 暴露有限能力，渲染层不能直接访问 Node API。

### 单实例

主进程启动时调用 `app.requestSingleInstanceLock()`。如果已有实例运行，新进程会退出，并通过 `second-instance` 事件显示已有窗口，避免用户多次点击桌面图标导致多个托盘图标。

### 隐私保护

设置中提供“隐藏后重新打开时保护内容”和可选隐私密码。窗口隐藏、关闭到托盘或最小化时，主进程发送 `privacy:lock` 给渲染层，渲染层显示遮罩。隐私密码只在主进程校验，渲染层只知道是否已设置密码。

隐私密码目前用于界面遮挡，不加密本地 JSON 文件。如果需要磁盘级保护，下一步应实现基于用户密码派生密钥的本地加密存储。

### 渲染层职责

`src/renderer/App.tsx` 负责：

- 展示记录列表
- 搜索记录
- 创建、删除、切换记录
- TipTap 编辑器工具栏
- 查找/替换面板，`Ctrl + F` 打开查找，`Ctrl + H` 打开替换
- 图片插入，图片以 data URL 内嵌到记录 JSON 中
- 自动保存状态展示
- 导出入口
- 快捷键设置入口

编辑器内容保存为三种形态：

- `content`：TipTap JSON，用于无损恢复编辑状态
- `html`：用于 HTML 导出，可保留插入图片的 data URL，并通过主进程导出为带样式的单文件阅读模板
- `plainText`：用于搜索、摘要和 TXT 导出

Markdown 导出由 `src/shared/markdown.ts` 从 TipTap JSON 转换生成，覆盖标题、段落、列表、任务列表、引用、代码块、链接、图片和常见文字样式。插入的本地图片会以 data URL 写入 Markdown 图片语法，便于单文件携带；TXT 导出只保留文字内容。

### 存储格式

每条记录保存为一个 JSON 文件：

```json
{
  "id": "uuid",
  "title": "记录标题",
  "excerpt": "摘要",
  "pinnedAt": null,
  "content": {},
  "html": "<p>内容</p>",
  "plainText": "内容",
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

记录列表排序规则：

1. 已置顶记录优先，按 `pinnedAt` 倒序。
2. 未置顶记录按 `updatedAt` 倒序。
3. 切换记录前会保存当前记录，但保存不会强行重选旧记录。

Windows 上默认数据目录通常位于：

```text
%APPDATA%\suiji
```

实际路径由 Electron `app.getPath("userData")` 决定。

保存时采用临时文件写入后 rename 的原子替换方式。修改和删除前会把旧记录复制到：

```text
%APPDATA%\suiji\backups
```

备份默认保留最近 80 份，避免无限增长。

## 开发命令

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run build
```

`npm run build` 会先从 `精灵日报.svg` 生成 Windows 图标资源：

```text
build/icon.ico
build/icon.png
build/tray.png
```

打包 Windows exe：

```bash
npm run dist
```

默认打包安装版 exe。`release/win-unpacked/随记.exe` 是解包目录中的可执行程序，不能单独脱离目录运行。

国内网络如果无法从 GitHub 下载 Electron 或 NSIS 相关二进制，可以临时设置镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist
```

## 后续迭代建议

1. 增加标签、收藏和置顶。
2. 增加 Markdown 导入导出。
3. 用 SQLite + FTS5 替换 JSON 文件，实现更强全文搜索。
4. 增加云同步层，保持本地优先。
5. 增加自动启动和快捷键冲突提示。
