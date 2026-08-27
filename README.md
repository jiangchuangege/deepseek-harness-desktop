# DeepSeek Harness 桌面客户端

一个 **Electron 桌面客户端**,给 **DeepSeek Harness (DSH)** 的 Web 界面套上原生窗口,
并**集成插件/技能/MCP 市场**、**本地工具调用补丁**和**会动的 Live2D 桌面宠物**,开箱即用。

---

## 安装(直接下载 exe)

- 从 **[Release v1.1.0](https://github.com/jiangchuangege/deepseek-harness-desktop/releases/tag/v1.1.0)** 下载:
  - **`DeepSeek Harness 桌面客户端 Setup 1.1.0.exe`** —— 安装版,双击安装到开始菜单(推荐)
  - **`DeepSeek Harness 桌面客户端 1.1.0.exe`** —— 便携版,免安装,双击直接运行
- 普通用户无需 `npm install`、无需打包,下载即用。

> 下方「源码运行 / 自行打包」仅供想自己编译、改图标、改插件的人使用。

---

## 它能做什么

- 🪟 **原生桌面窗口**承载 DSH Web 界面(默认连接 `DSH_WEB_URL` 或 `http://127.0.0.1:3080`)。
- 🐾 **会动的 Live2D 桌面宠物**:一个**透明悬浮的二次元小角色**(自带眨眼/呼吸/点头等动作);
  可**拖拽(位置自动记忆)、点它弹菜单**(聊天/插件市场/启动服务/检查补丁/关闭),点它会有小动作。
  为省资源,**平时静止、鼠标碰到才动**;不满意可设 `PET_TRANSPARENT=0` 关闭透明。
- 🚀 **一键启动 DeepSeek Harness 服务**:文件菜单 / 宠物 / 托盘里都能**启动 / 检查 / 停止** DSH 服务(后台拉起 `dsh web --no-open`, 自动加载界面)。
- 🧭 **插件 / 技能 / MCP 市场**:窗口内搜索社区仓库(**每页 30 条、可翻页**),插件可**一键安装**(`dsh plugin add`, 带实时进度条与进度条);MCP 点【打开 GitHub 仓库】按仓库说明自行运行;内置「管理」页对已安装插件**启用/停用、删除**,并实时显示**补丁(8081)在线状态**。
- 🔌 **自带本地工具调用补丁**:启动时自动拉起 `scripts/qwen_tool_proxy.py`(端口 8081),把本地模型(如 Qwen 系列)原生的 `<tools>` 标签改写为标准 `tool_calls`,让 DSH 能驱动其操控电脑。
- 💬 **小宠物聊天**:本地模型在线时由**本地模型回答**,离线自动回退内置规则回复。
- ⚙️ **可选拉起 DSH**:设 `HARNESS_LAUNCH_DSH=1` 让客户端自动 `dsh web`(默认关闭,避免端口冲突)。

---

## 快速开始

### 环境要求
- Node.js **18+**(含 npm)
- Python **3**(用于工具调用补丁)
- 一台已运行/可启动的 **DeepSeek Harness**(默认连 `http://127.0.0.1:3080`,可通过环境变量覆盖)

### 运行
```bash
npm install      # 首次
npm start        # 启动桌面客户端
```
> 不想从源码跑就直接下载上面 Release 里的 exe 安装/运行。

> 客户端启动时会: ① 拉起本地工具调用补丁(8081);② 打开 DSH Web 界面窗口。
> 想让本地 Qwen 模型可操控电脑, 还需在 DSH 里把该模型 `baseURL` 指向 `http://127.0.0.1:8081/v1`。

### 打包为安装程序(.exe)
```bash
npm run dist     # 使用 electron-builder 生成 Windows 安装包/便携版(release/)
```

---

## 插件体系

- 注册表: `config/plugins.json` —— 分类列出 `patches`/`plugins`/`skills`/`mcpServers`,含启用开关。
- 查看: 客户端窗口内可通过 `window.harnessDesktop.getPlugins()` 读取(预加载脚本未开放 Node 权限,仅暴露安全接口)。
- 安装: 窗口内触发 `window.harnessDesktop.installPlugin({pkg})` 或命令行
  `dsh plugin --profile web add <包>`。
- 批处理: `scripts/install-plugins.ps1` 一键安装注册表里启用的第三方插件。

> 详见 [`docs/插件接入指南.md`](docs/插件接入指南.md) 与 [`docs/使用说明.md`](docs/使用说明.md)。

---

## 项目结构

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
│   ├── qwen_tool_proxy.py     # 本地工具调用补丁(把 <tools> 改写为标准 tool_calls)
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

## 相关项目
- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) —— 被包裹/驱动的 Harness

## 许可
MIT
