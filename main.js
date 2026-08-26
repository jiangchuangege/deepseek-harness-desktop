// deepseek-harness-desktop 主进程
// 职责:
//   1) 打开 DSH Web 界面(默认连接 DSH_WEB_URL 或 http://127.0.0.1:3080)
//   2) 自动拉起本地"工具调用补丁"代理(tool_proxy.py, 端口 8081)
//   3) 通过 IPC 提供插件注册表信息, 供窗口内"插件面板"使用
//   4) 支持从窗口触发"安装 GitHub 插件/技能"(dsh plugin add)

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeTheme, Tray } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DSH_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const PROXY_PORT = 8081;
const PROXY_UPSTREAM = process.env.HARNESS_PROXY_UPSTREAM || 'http://127.0.0.1:8080';
const PLUGINS_FILE = path.join(__dirname, 'config', 'plugins.json');

let mainWindow = null;
let petWindow = null;
let pluginWindow = null;
let chatWindow = null;
let tray = null;
let proxyProc = null;
let dshProc = null;

function readPlugins() {
  try {
    return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8'));
  } catch {
    return { plugins: [], skills: [], mcpServers: [] };
  }
}

// 启动工具调用补丁代理(本地模型需要它才能被 DSH 驱动)
function startProxy() {
  const pyscript = path.join(__dirname, 'scripts', 'qwen_tool_proxy.py');
  if (!fs.existsSync(pyscript)) { console.warn('[proxy] 未找到 qwen_tool_proxy.py, 跳过启动'); return; }

  let cmd = null;
  if (process.platform === 'win32') cmd = spawn('py', ['-u', pyscript, '--port', String(PROXY_PORT), '--upstream', PROXY_UPSTREAM], { cwd: path.join(__dirname, 'scripts') });
  else cmd = spawn('python3', ['-u', pyscript, '--port', String(PROXY_PORT), '--upstream', PROXY_UPSTREAM], { cwd: path.join(__dirname, 'scripts') });

  cmd.stdout.on('data', d => console.log('[proxy] ' + String(d).trim()));
  cmd.stderr.on('data', d => console.error('[proxy] ' + String(d).trim()));
  cmd.on('exit', code => console.error('[proxy] exited ' + code));
  proxyProc = cmd;
  console.log('[proxy] 启动 (端口 ' + PROXY_PORT + ' -> ' + PROXY_UPSTREAM + ')');
}

// 可选: 若 DSH 未运行, 则拉起 dsh web。默认关闭, 以免端口冲突。
function maybeStartDsh() {
  if (process.env.HARNESS_LAUNCH_DSH === '1') {
    console.log('[dsh] 尝试启动 dsh web ...');
    dshProc = spawn('dsh', ['web'], { shell: process.platform === 'win32' });
    dshProc.stdout.on('data', d => console.log('[dsh] ' + String(d).trim()));
    dshProc.stderr.on('data', d => console.error('[dsh] ' + String(d).trim()));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 940,
    title: 'DeepSeek Harness 桌面客户端',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(DSH_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 桌面宠物: 实体轻量小窗(不做透明, 避免 Windows 掉帧卡顿)
function createPetWindow() {
  if (petWindow) { petWindow.show(); petWindow.focus(); return; }
  petWindow = new BrowserWindow({
    width: 132, height: 134,
    backgroundColor: '#20222a',
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.on('closed', () => { petWindow = null; });
}

// 插件浏览器: 独立窗口
function createPluginWindow() {
  if (pluginWindow) { pluginWindow.focus(); return; }
  pluginWindow = new BrowserWindow({
    width: 760, height: 620,
    title: '插件浏览器',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  pluginWindow.loadFile(path.join(__dirname, 'plugins.html'));
  pluginWindow.on('closed', () => { pluginWindow = null; });
}

// 宠物聊天: 独立小窗
function createChatWindow() {
  if (chatWindow) { chatWindow.focus(); return; }
  chatWindow = new BrowserWindow({
    width: 340, height: 420, title: '小宠物 · 聊天',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  chatWindow.loadFile(path.join(__dirname, 'chat.html'));
  chatWindow.on('closed', () => { chatWindow = null; });
}

// 原生菜单: 插件浏览器 / 桌面宠物 / 模型列表检查
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '社区插件市场', accelerator: 'Ctrl+Shift+P', click: () => createPluginWindow() },
      { label: '桌面宠物', accelerator: 'Ctrl+Shift+T', click: () => createPetWindow() },
      { label: '检查补丁(模型列表)', click: () => shell.openExternal(`http://127.0.0.1:${PROXY_PORT}/v1/models`) },
      { type: 'separator' },
      { role: 'quit', label: '退出' }
    ]},
    { label: '视图', submenu: [ { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' } ] }
  ]));
  // 系统托盘: 提供常驻入口(社区插件市场 / 桌面宠物 / 退出)
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
    tray.setToolTip('DeepSeek Harness 桌面客户端');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '社区插件市场', click: () => createPluginWindow() },
      { label: '桌面宠物', click: () => createPetWindow() },
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
      { type: 'separator' },
      { role: 'quit', label: '退出' }
    ]));
    tray.on('click', () => createPluginWindow());
  } catch (e) { console.warn('[tray] 创建托盘失败: ' + e); }
}

function cleanup() {
  if (proxyProc) { proxyProc.kill(); }
  if (dshProc) { dshProc.kill(); }
  if (petWindow) { petWindow.destroy(); }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  startProxy();
  maybeStartDsh();
  createWindow();
  createMenu();
  // 默认显示桌面宠物(通过菜单可隐藏/再开)
  createPetWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => cleanup());

// ---- IPC: 给渲染进程的插件信息 & 安装动作 ----
ipcMain.handle('get-plugins', () => readPlugins());

// 点击宠物 → 弹出原生功能菜单(原生、不卡、无黑框)
ipcMain.handle('show-pet-menu', () => {
  const mu = Menu.buildFromTemplate([
    { label: '💬 聊天', click: () => createChatWindow() },
    { label: '🧩 社区插件市场', click: () => createPluginWindow() },
    { label: '🛰️ 检查补丁', click: () => shell.openExternal(`http://127.0.0.1:${PROXY_PORT}/v1/models`) },
    { type: 'separator' },
    { label: '✖ 关闭宠物', click: () => { if (petWindow) { petWindow.close(); } } }
  ]);
  mu.popup();
});
// 宠物菜单: 打开社区插件市场 / 打开模型列表
ipcMain.handle('open-plugin-market', () => { createPluginWindow(); });
ipcMain.handle('open-proxy-external', () => { shell.openExternal(`http://127.0.0.1:${PROXY_PORT}/v1/models`); });
// 宠物拖拽
ipcMain.handle('get-pet-pos', () => (petWindow && !petWindow.isDestroyed()) ? petWindow.getPosition() : [0,0]);
ipcMain.handle('move-pet', (event, x, y) => { if (petWindow && !petWindow.isDestroyed()) petWindow.setPosition(Math.round(Number(x)), Math.round(Number(y))); });

ipcMain.handle('install-plugin', async (event, spec) => {
  // spec: { type: 'Plugin'|'Skill'|'MCP'|'Patch', pkg: 'xxxx' }
  if (!spec || !spec.pkg) return { ok: false, error: '缺少包名' };
  try {
    // 用 dsh plugin add 安装(需 dsh 在 PATH)
    await new Promise((resolve, reject) => {
      exec(`dsh plugin --profile web add ${spec.pkg}`, { shell: process.platform === 'win32' }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout);
      });
    });
    return { ok: true, message: `已安装: ${spec.pkg}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('open-proxy-check', async () => {
  // 让用户方便把浏览器指向模型列表确认代理在跑
  return { url: `http://127.0.0.1:${PROXY_PORT}/v1/models` };
});

ipcMain.handle('search-plugins', async (event, query) => {
  // 搜索 GitHub 上的社区插件仓库(主进程拉取, 避免渲染页 CORS)
  if (!query || !query.trim()) return { ok: false, error: '缺少关键词' };
  try {
    const q = `${query} deepseek-harness OR dsh plugin`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=12`;
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-market' } });
    if (!res.ok) return { ok: false, error: `GitHub 搜索失败 (HTTP ${res.status})` };
    const data = await res.json();
    return {
      ok: true,
      items: (data.items || []).map(it => ({ full_name: it.full_name, description: it.description, html_url: it.html_url }))
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
