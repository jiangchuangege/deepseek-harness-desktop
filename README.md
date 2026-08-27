<div align="center">

# 🐳 DeepSeek Harness 桌面客户端

**给 DeepSeek Harness (DSH) 的 Web 界面套上原生窗口**

集成 · **插件 / 技能 / MCP 市场** · **本地工具调用补丁** · **会动的 Live2D 桌面宠物**

[![Release v1.1.0](https://img.shields.io/badge/Release-v1.1.0-blue)](https://github.com/jiangchuangege/deepseek-harness-desktop/releases/tag/v1.1.0)
[![License MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31+-8f7bff)](https://www.electronjs.org/)

</div>

---

## ⬇️ 安装

直接从 **[Release v1.1.0](https://github.com/jiangchuangege/deepseek-harness-desktop/releases/tag/v1.1.0)** 下载,普通用户**无需 npm install、无需打包**:

| 版本 | 文件 | 说明 |
|-----|------|------|
| 🏠 安装版 | `DeepSeek.Harness.Setup.1.1.0.exe` | 双击装到开始菜单(**推荐**) |
| 🚀 便携版 | `DeepSeek.Harness.1.1.0.exe` | 免安装,双击直接运行 |

> 🔧 下方的「源码运行 / 自行打包」仅供想自己编译、改图标、改插件的人使用。

---

## ✨ 它能做什么

| 功能 | 说明 |
|------|------|
| 🪟 **原生桌面窗口** | 承载 DSH Web 界面(默认连 `http://127.0.0.1:3080`,可用 `DSH_WEB_URL` 覆盖) |
| 🐾 **会动的 Live2D 宠物** | 透明悬浮的二次元小角色,自带眨眼/呼吸/点头;可拖拽(位置自动记忆)、点它弹菜单、点它有小动作 |
| 🚀 **一键启动 DSH 服务** | 文件菜单 / 宠物 / 托盘都可**启动 / 检查 / 停止** DSH 服务(后台 `dsh web --no-open`) |
| 🧭 **插件 / 技能 / MCP 市场** | 搜索社区仓库(每页 30 条可翻页);插件**一键安装带进度条**;MCP 打开 GitHub 仓库;「管理」页可启用/停用/删除,并显示**补丁(8081)在线状态** |
| 🔌 **本地工具调用补丁** | 自动拉起 `scripts/qwen_tool_proxy.py`(端口 8081),把本地模型原生的 `<tools>` 改写为标准 `tool_calls`,让 DSH 能驱动其操控电脑 |
| 💬 **小宠物聊天** | 本地模型在线时由**本地模型回答**,离线自动回退内置规则回复 |
| ⚙️ **可选自动拉起 DSH** | 设 `HARNESS_LAUNCH_DSH=1` 客户端自动 `dsh web`(默认关闭) |

---

## 🚀 快速开始(源码)

### 🛠️ 环境要求
- Node.js **18+**(含 npm)
- Python **3**(用于工具调用补丁)
- 一台已运行/可启动的 **DeepSeek Harness**(默认连 `http://127.0.0.1:3080`)

### ▶️ 运行
```bash
npm install      # 首次
npm start        # 启动桌面客户端(自动先打包 Live2D)
```
> 💡 不想从源码跑,直接下载上面 Release 里的 exe 即可。

启动时客户端会:
1. 自动拉起本地工具调用补丁(`scripts/qwen_tool_proxy.py`,端口 8081);
2. 打开 DSH Web 界面窗口(默认 `http://127.0.0.1:3080`)。

> 📌 想让本地 Qwen 模型可操控电脑,需在 DSH 里把该模型 `baseURL` 指向 `http://127.0.0.1:8081/v1`(详见 [`docs/使用说明.md`](docs/使用说明.md))。

### 📦 打包为安装程序
```bash
npm run dist     # electron-builder 生成 Windows 安装包/便携版(release/)
```

---

## 🧩 插件体系

- **注册表**:`config/plugins.json` —— 分类列出 `patches` / `plugins` / `skills` / `mcpServers`,含启用开关。
- **查看**:窗口内 `window.harnessDesktop.getPlugins()` 读取(预加载脚本只暴露安全接口)。
- **安装**:窗口内「插件 / 技能 / MCP 市场」点【一键安装】,或命令行 `dsh plugin --profile web add <包>`。
- **批处理**:`scripts/install-plugins.ps1` 一键安装注册表里启用的第三方插件。

> 📖 详见 [`docs/插件接入指南.md`](docs/插件接入指南.md) 与 [`docs/使用说明.md`](docs/使用说明.md)。

---

## 📂 项目结构

```
deepseek-harness-desktop/
├── main.js                    # Electron 主进程(开窗/启补丁/服务管理/插件 IPC)
├── preload.js                 # 渲染进程安全桥(仅暴露最小接口)
├── package.json               # 依赖与打包配置(predist 自动打包 Live2D)
├── pet.html                   # 桌面宠物(透明 Live2D 渲染)
├── chat.html                  # 小宠物聊天窗口
├── plugins.html               # 插件/技能/MCP 市场(三 Tab + 分页)
├── notice.html                # 自研提示(Toast)窗口
├── config/plugins.json        # 插件/技能/MCP/补丁 注册表(可扩展)
├── scripts/
│   ├── qwen_tool_proxy.py     # 本地工具调用补丁(<tools> → 标准 tool_calls)
│   ├── pet-live2d-entry.js    # Live2D 渲染入口(esbuild 打包为 assets/pet-live2d.js)
│   └── install-plugins.ps1    # 一键安装启用的插件
├── assets/
│   ├── icon.png               # 应用图标
│   ├── live2dcubismcore.min.js# Live2D Cubism 核心(官方 SDK)
│   ├── pet-live2d.js          # pixi.js v6 + pixi-live2d-display 打包产物
│   └── live2d/haru/           # Haru 模型(moc3/纹理/动作/表情)
├── docs/
│   ├── 使用说明.md
│   └── 插件接入指南.md
└── README.md
```

---

## 🔗 相关项目
- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) —— 被包裹/驱动的 Harness

## 📄 许可
MIT
