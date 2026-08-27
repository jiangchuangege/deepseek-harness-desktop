# DeepSeek Harness 桌面客户端

一个 **Electron 桌面客户端**,给 **DeepSeek Harness (DSH)** 的 Web 界面套上原生窗口,
并**集成一套插件/技能/MCP 注册表**与**本地工具调用补丁**,开箱即用。

---

## ⬇️ 直接下载已编译好的 exe(无需自己打包)

本仓库已在 **GitHub Releases** 发布现成的 `.exe`,**下载即用,无需 `npm install`、无需打包**:

- **安装包**(推荐):`DeepSeek.Harness.Setup.1.0.0.exe` —— 双击安装到开始菜单
- **便携版**(免安装):`DeepSeek.Harness.1.0.0.exe` —— 双击直接运行

👉 打开 **Releases 页面**:https://github.com/jiangchuangege/deepseek-harness-desktop/releases

> 下面「源码运行/打包」仅供想自行编译、改图标、改插件的人使用。普通用户直接下上面的 exe 即可。

---

## 它能做什么

- 🪟 **原生桌面窗口**承载 DSH Web 界面(默认连接 `DSH_WEB_URL` 或 `http://127.0.0.1:3080`)。
- 🧩 **插件注册表**:集中列出/启用/安装 **插件(Plugin) / 技能(Skill) / MCP 服务器 / 本地补丁**。
  支持从窗口内 `dsh plugin add <包>` 安装 **GitHub 上的 DSH 插件**。
- 🔌 **自带本地工具调用补丁**:启动客户端时会自动拉起 `scripts/qwen_tool_proxy.py`(端口 8081),
  把本地模型(如 Qwen 系列)原生的 `<tools>` 标签改写为标准 `tool_calls`,让 DSH 能驱动其操控电脑。
- 🐾 **桌面宠物**:一个透明置顶的小窗,显示个性图片,**会动、可拖拽(位置自动记忆)、点击说话气泡、单击弹菜单、双击可聊天**;聊天窗口在本地模型在线时由**本地模型回答**,离线自动回退内置回复。
- 🧭 **插件浏览器**:菜单(文件→插件浏览器,或 `Ctrl+Shift+P`)打开窗口,**浏览社区插件/技能/MCP 并一键安装**(调用 `dsh plugin add`,带实时进度条);内置「管理」页可对已部署的插件/MCP **启用/停用、删除**,并实时显示**补丁(8081)在线状态**。
- ⚙️ **可选拉起 DSH**:设置环境变量 `HARNESS_LAUNCH_DSH=1` 可让客户端自动 `dsh web`(默认关闭,避免端口冲突)。

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
├── main.js                    # Electron 主进程(开窗/启补丁/插件 IPC)
├── preload.js                 # 渲染进程安全桥(仅暴露最小接口)
├── package.json               # 依赖与打包配置
├── config/plugins.json        # 插件/技能/MCP/补丁 注册表(可扩展)
├── scripts/
│   ├── qwen_tool_proxy.py     # 本地工具调用补丁(把 <tools> 改写为标准 tool_calls)
│   └── install-plugins.ps1    # 一键安装启用的插件
├── assets/                    # 应用图标等资源
├── docs/
│   ├── 使用说明.md
│   └── 插件接入指南.md
├── 启动客户端.bat             # Windows 一键启动(npm install + npm start)
└── README.md
```

---

## 相关项目
- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) —— 被包裹/驱动的 Harness

## 许可
MIT
