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
- 运行环境：Node.js 22.12+

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

从 `0.2.0` 起，主窗口会阻止非应用页面导航，外部链接统一通过系统浏览器打开；IPC 入口会校验记录 id、导出格式、设置项和外部 URL，避免渲染层参数直接进入文件路径或系统调用。

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

如果某个记录 JSON 损坏，启动时会把该文件移动到 `notes/corrupt/`，其余记录继续加载，避免单个坏文件阻塞整个应用。

从 `0.3.0` 起，设置面板提供数据管理入口：备份全部记录会导出一个包含应用版本、导出时间和记录数组的 JSON 文件；恢复备份会先把同 ID 的本地记录备份到 `backups/`，再导入备份文件中的合法记录；数据目录入口用于排查本地存储和手动备份。

从 `0.4.0` 起，记录支持 `tags` 字段。渲染层会把顶部标签输入框解析为去重后的标签数组，搜索会匹配标题、摘要、正文和标签，侧边栏会根据所有记录聚合标签筛选器。

HTML 导出不再直接信任记录中缓存的 `html` 字段，而是从 TipTap JSON 内容生成白名单 HTML。普通编辑保存的备份也改为按时间间隔生成，删除、置顶和恢复覆盖仍会立即保留本地备份。

从 `0.5.0` 起，记录模型增加 `folder`、`favoriteAt`、`archivedAt` 和 `trashedAt` 字段。删除操作改为移入回收站，只有永久删除才会移除本地 JSON 文件。侧边栏提供记录、收藏、归档、回收站和最近编辑视图；顶部时钟按钮会列出当前记录在 `backups/` 中的历史版本，并支持恢复到指定备份。

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
