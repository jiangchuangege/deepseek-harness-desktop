# Qwen Harness 桌面客户端(Qwen Harness Desktop)

一个 **Electron 桌面客户端**,给 **DeepSeek Harness (DSH)** 的 Web 界面套上原生窗口,
并**集成一套插件/技能/MCP 注册表**与**本地工具调用补丁**,开箱即用。

---

## 它能做什么

- 🪟 **原生桌面窗口**承载 DSH Web 界面(默认连接 `DSH_WEB_URL` 或 `http://127.0.0.1:3080`)。
- 🧩 **插件注册表**:集中列出/启用/安装 **插件(Plugin) / 技能(Skill) / MCP 服务器 / 本地补丁**。
  支持从窗口内 `dsh plugin add <包>` 安装 **GitHub 上的 DSH 插件**。
- 🔌 **自带工具调用补丁**:启动客户端时会自动拉起 `scripts/qwen_tool_proxy.py`(端口 8081),
  让本地 Qwen2.5-Coder 等模型能被 DSH 驱动、真正操控电脑。
- ⚙️ **可选拉起 DSH**:设置环境变量 `QWEN_LAUNCH_DSH=1` 可让客户端自动 `dsh web`(默认关闭,避免端口冲突)。

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
Windows 也可直接双击 **`启动客户端.bat`**(自动 npm install 并 npm start)。

> 客户端启动时会: ① 拉起工具调用补丁(8081);② 打开 DSH Web 界面窗口。
> 想让本地 Qwen 模型可操控电脑, 还需在 DSH 里把该模型 `baseURL` 指向 `http://127.0.0.1:8081/v1`
> (见仓库根目录 `config/settings-dsh-example.yaml`)。

### 打包为安装程序(.exe)
```bash
npm run dist     # 使用 electron-builder 生成 Windows 安装包(release/)
```
> 需要联网下载 Electron/打包器; 生成的是 Win x64 NSIS 安装程序。

---

## 插件体系

- 注册表: `config/plugins.json` —— 分类列出 `patches`/`plugins`/`skills`/`mcpServers`,含启用开关。
- 查看: 客户端窗口内可通过 `window.qwenDesktop.getPlugins()` 读取(预加载脚本未开放 Node 权限,仅暴露安全接口)。
- 安装: 窗口内触发 `window.qwenDesktop.installPlugin({pkg})` 或命令行
  `dsh plugin --profile web add <包>`。
- 批处理: `scripts/install-plugins.ps1` 一键安装注册表里启用的第三方插件。

> 详见 [`docs/插件接入指南.md`](docs/插件接入指南.md) 与 [`docs/使用说明.md`](docs/使用说明.md)。

---

## 项目结构

```
qwen-harness-desktop/
├── main.js                    # Electron 主进程(开窗/启补丁/插件 IPC)
├── preload.js                 # 渲染进程安全桥(仅暴露最小接口)
├── package.json               # 依赖与打包配置
├── config/plugins.json        # 插件/技能/MCP/补丁 注册表(可扩展)
├── scripts/
│   ├── qwen_tool_proxy.py     # 工具调用补丁(本仓库核心, 从根目录复制)
│   └── install-plugins.ps1    # 一键安装启用的插件
├── assets/                    # 图标等资源
├── docs/
│   ├── 使用说明.md
│   └── 插件接入指南.md
├── 启动客户端.bat             # Windows 一键启动(npm install + npm start)
└── README.md
```

---

## 相关项目
- [Qwen2.5-Coder 工具调用补丁](../)  —— 本客户端集成的补丁本体(仓库根目录)
- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) —— 被包裹/驱动的 Harness

## 许可
MIT
