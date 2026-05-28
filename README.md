# 随记

随记是一个 Windows 桌面端快速记录工具。它支持全局快捷键呼出、富文本编辑、本地自动保存、托盘隐藏和导出。

当前版本：`0.5.1`

## 快速开始

```bash
npm install
npm run dev
```

开发环境需要 Node.js `22.12` 或更高版本。

默认快捷键：`Ctrl + Alt + J`

## 打包 exe

```bash
npm run dist
```

打包产物会生成到 `release/` 目录，默认生成 Windows 安装包 exe。`release/win-unpacked/随记.exe` 是解包后的可执行程序，需要和同目录文件一起使用。

应用、安装包和托盘图标来自根目录的 `精灵日报.svg`。打包前会自动运行 `npm run icons` 生成 `build/icon.ico`、`build/icon.png` 和 `build/tray.png`。

如果 Electron 或打包工具下载超时，可以在 PowerShell 中使用镜像后再打包：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist
```

## 主要功能

- 全局快捷键呼出或隐藏窗口
- 单实例运行，多次点击桌面图标只会唤起已有窗口和托盘
- 标题、加粗、斜体、下划线、删除线、高亮
- 项目符号列表、编号列表、任务列表、引用、代码块、分割线、链接
- `Ctrl + F` 查找，`Ctrl + H` 替换
- 插入本地图片
- 每 650ms 自动保存当前记录
- 本地多记录管理与搜索
- 记录置顶、删除和稳定切换
- 侧边栏可收起，保留快速新建和隐藏入口
- 导出 HTML、Markdown、TXT、JSON；HTML 使用带排版样式的单文件模板，HTML/Markdown/JSON 会保留插入的图片，TXT 只导出文字
- 托盘运行，关闭窗口时默认隐藏
- 隐藏窗口后可自动遮挡内容，可设置隐私密码
- 笔记保存采用临时文件原子替换，修改和删除前会保留本地备份
- 导出前提示明文风险，并清理默认文件名中的不安全字符
- 外部链接通过系统浏览器打开，应用窗口会阻止意外跳转
- 自动保存采用串行队列，减少快速编辑和切换记录时的状态覆盖风险
- 支持在设置中备份全部记录、恢复备份和打开本地数据目录
- 支持为记录添加标签，并按标签筛选
- 支持文件夹、收藏、归档、回收站和最近编辑时间线
- 支持从当前记录的版本历史中恢复到旧备份
- 支持修改数据目录，并可复制现有记录、备份和设置
- HTML 导出从编辑器结构生成白名单 HTML，减少导出内容注入风险
- 构建时按 React、编辑器、图标和通用依赖拆包，降低主入口体积

## 版本记录

详见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

本项目基于 MIT License 开源，详见 [LICENSE](LICENSE)。
