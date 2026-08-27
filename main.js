// deepseek-harness-desktop 主进程
// 职责:
//   1) 打开 DSH Web 界面(默认连接 DSH_WEB_URL 或 http://127.0.0.1:3080)
//   2) 自动拉起本地"工具调用补丁"代理(tool_proxy.py, 端口 8081)
//   3) 通过 IPC 提供插件注册表信息, 供窗口内"插件面板"使用
//   4) 支持从窗口触发"安装 GitHub 插件/技能"(dsh plugin add)

const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, Tray, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DSH_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const PROXY_PORT = 8081;
const PROXY_UPSTREAM = process.env.HARNESS_PROXY_UPSTREAM || 'http://127.0.0.1:8080';
const PLUGINS_FILE = path.join(__dirname, 'config', 'plugins.json');
// 桌面宠物窗口尺寸(可在此整体调整大小)
const PET_W = 116, PET_H = 116;

// 单实例: 避免重复启动导致补丁端口(8081)冲突
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

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
// 受管注册(管理页数据源): 已部署插件 + MCP 的启用开关
// 存到用户数据目录(app.getPath('userData')), 避免便携版 temp 目录每次清空导致丢失
const REG_DIR = app.getPath('userData');
const MCP_FILE = path.join(REG_DIR, 'mcp-enabled.json');
const PLG_FILE = path.join(REG_DIR, 'plugins-enabled.json');
const PET_POS_FILE = path.join(REG_DIR, 'pet-pos.json');
function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function writeJson(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch {} }
function recordPlugin(pkg) {
  if (!pkg) return;
  const arr = readJson(PLG_FILE, []);
  if (!arr.some(x => x.name === pkg)) arr.push({ name: pkg, enabled: true, addedAt: new Date().toISOString() });
  writeJson(PLG_FILE, arr);
}
// 查询补丁代理(8081)的可用模型列表; 失败返回 null
async function getProxyModels() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data || []).map(m => m.id || m);
  } catch { return null; }
  finally { clearTimeout(timer); }
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
  cmd.on('error', e => console.error('[proxy] 启动失败(找不到 py/python?): ' + e));
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
    dshProc.on('error', e => console.error('[dsh] 启动失败(找不到 dsh?): ' + e));
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
function defaultPetPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return [wa.x + wa.width - 220, wa.y + wa.height - 220];
}
function savePetPos() {
  if (!petWindow || petWindow.isDestroyed()) return;
  try { fs.writeFileSync(PET_POS_FILE, JSON.stringify(petWindow.getPosition())); } catch {}
}
function createPetWindow() {
  if (petWindow) { petWindow.show(); petWindow.focus(); return; }
  petWindow = new BrowserWindow({
    width: PET_W, height: PET_H,
    backgroundColor: '#20222a',
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  // 恢复上次位置(并夹回屏幕内, 防止显示器变更后宠物跑到屏幕外)
  const saved = readJson(PET_POS_FILE, null);
  if (Array.isArray(saved) && saved.length === 2 && Number.isFinite(saved[0]) && Number.isFinite(saved[1])) {
    const wa = screen.getDisplayNearestPoint({ x: saved[0], y: saved[1] }).workArea;
    const x = Math.min(Math.max(saved[0], wa.x), wa.x + wa.width - PET_W);
    const y = Math.min(Math.max(saved[1], wa.y), wa.y + wa.height - PET_H);
    petWindow.setPosition(Math.round(x), Math.round(y));
  } else {
    const [dx, dy] = defaultPetPos();
    petWindow.setPosition(dx, dy);
  }
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.on('close', () => savePetPos());   // close 时窗口尚未销毁, 可读取位置
  petWindow.on('closed', () => { petWindow = null; });
}

// 插件浏览器: 独立窗口
function createPluginWindow() {
  if (pluginWindow) { pluginWindow.focus(); return; }
  pluginWindow = new BrowserWindow({
    width: 880, height: 700,
    title: '插件浏览器',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  pluginWindow.loadFile(path.join(__dirname, 'plugins.html'));
  // 窗口内 target=_blank / window.open 的仓库外链: 在客户端内开一个原生窗口加载, 不跳系统浏览器
  pluginWindow.webContents.setWindowOpenHandler(({ url }) => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1000, height: 720,
      title: '社区仓库',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    }
  }));
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
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
  if (proxyProc) { proxyProc.kill(); }
  if (dshProc) { dshProc.kill(); }
  savePetPos();
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
// 宠物拖拽(主进程轮询鼠标, 流畅; 夹在屏幕工作区内, 防止拖出屏幕后收不到 mouseup)
let dragInterval = null;
ipcMain.on('start-drag', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const cur = screen.getCursorScreenPoint();
  const [wx, wy] = petWindow.getPosition();
  const offX = cur.x - wx, offY = cur.y - wy;
  if (dragInterval) clearInterval(dragInterval);
  dragInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) { clearInterval(dragInterval); dragInterval = null; return; }
    const c = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(c).workArea;
    const w = petWindow.getBounds();
    const nx = Math.min(Math.max(c.x - offX, wa.x), wa.x + wa.width - w.width);
    const ny = Math.min(Math.max(c.y - offY, wa.y), wa.y + wa.height - w.height);
    petWindow.setPosition(Math.round(nx), Math.round(ny));
  }, 16);
});
ipcMain.on('stop-drag', () => {
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
  savePetPos();   // 拖完记住位置, 下次启动还原
});

ipcMain.handle('install-plugin', async (event, spec) => {
  // spec: { pkg: 'xxxx' }  —— 用 spawn 流式返回进度(进度条)
  if (!spec || !spec.pkg) return { ok: false, error: '缺少包名' };
  return new Promise((resolve) => {
    const send = (obj) => { try { event.sender.send('install-progress', obj); } catch {} };
    const child = spawn('dsh', ['plugin', '--profile', 'web', 'add', spec.pkg], { shell: process.platform === 'win32' });
    const timer = setTimeout(() => { try { child.kill(); } catch {} send({ pkg: spec.pkg, done: true, code: -2, line: '安装超时(可能不是有效的 npm 包)' }); resolve({ ok: false, error: '安装超时(可能不是有效的 npm 包)' }); }, 90000);
    child.stdout.on('data', d => String(d).split(/\r?\n/).forEach(l => l.trim() && send({ pkg: spec.pkg, line: l })));
    child.stderr.on('data', d => String(d).split(/\r?\n/).forEach(l => l.trim() && send({ pkg: spec.pkg, line: l })));
    child.on('error', e => { clearTimeout(timer); send({ pkg: spec.pkg, done: true, code: -1 }); resolve({ ok: false, error: String(e) }); });
    child.on('close', code => {
      clearTimeout(timer);
      send({ pkg: spec.pkg, done: true, code });
      if (code === 0) { recordPlugin(spec.pkg); resolve({ ok: true, message: `已安装: ${spec.pkg}` }); }
      else resolve({ ok: false, error: `安装失败(退出码 ${code})` });
    });
  });
});
// 管理页: 读取已安装插件(受管注册, 安装成功时记录)及启用状态
ipcMain.handle('get-managed', () => ({
  mcp: readJson(MCP_FILE, []),
  plugins: readJson(PLG_FILE, [])
}));
// 管理页: 启动/停止 某个插件或 MCP(切换启用状态)
ipcMain.handle('toggle-managed', (event, spec) => {
  if (!spec || !spec.name) return { ok: false, error: '缺少名称' };
  const file = spec.kind === 'mcp' ? MCP_FILE : PLG_FILE;
  const arr = readJson(file, []);
  const item = arr.find(x => x.name === spec.name);
  const target = (spec.enabled === undefined || spec.enabled === null) ? !(item ? item.enabled : true) : !!spec.enabled;
  if (item) item.enabled = target;
  else arr.push({ name: spec.name, enabled: target });
  writeJson(file, arr);
  return { ok: true, name: spec.name, enabled: target };
});
// 管理页: 删除某个已部署项
ipcMain.handle('delete-managed', (event, spec) => {
  if (!spec || !spec.name) return { ok: false, error: '缺少名称' };
  const file = spec.kind === 'mcp' ? MCP_FILE : PLG_FILE;
  const arr = readJson(file, []);
  writeJson(file, arr.filter(x => x.name !== spec.name));
  return { ok: true, name: spec.name };
});

// 补丁代理健康检查: 返回可用模型列表(供窗口显示在线状态)
ipcMain.handle('check-proxy', async () => {
  const models = await getProxyModels();
  return models
    ? { ok: true, models, url: `http://127.0.0.1:${PROXY_PORT}/v1/models` }
    : { ok: false, url: `http://127.0.0.1:${PROXY_PORT}/v1/models` };
});

// 宠物聊天: 走本地补丁代理(8081)的 chat/completions, 让宠物真的用本地模型回答;
// 代理/上游不可用时返回 ok:false, 由渲染层回退到内置规则回复。
ipcMain.handle('chat-send', async (event, text) => {
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg) return { ok: false, reply: '' };
  try {
    // 先取一个上游可用模型名(避免某些 OpenAI 兼容服务拒绝未知 model)
    let model = 'local';
    const models = await getProxyModels();
    if (Array.isArray(models) && models.length) model = models[0];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是桌面上的一只活泼可爱的小宠物,名字叫"小H"。回答简短亲切,控制在20字以内,可以带颜文字。' },
          { role: 'user', content: msg }
        ],
        stream: false,
        max_tokens: 120
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reply: '', error: `HTTP ${res.status}` };
    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return (reply && String(reply).trim()) ? { ok: true, reply: String(reply).trim() } : { ok: false, reply: '', error: '空回复' };
  } catch (e) {
    return { ok: false, reply: '', error: String(e && e.message ? e.message : e) };
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
    // 用关键词在【仓库名/描述】里精确搜, 而不是拼一大堆泛词做 OR 搜(否则每次都是同样的最大页数且结果不相关)
    const q = `${query} in:name,description`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=30`;
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-market' } });
    if (!res.ok) return { ok: false, error: `GitHub 搜索失败 (HTTP ${res.status})` };
    const data = await res.json();
    return {
      ok: true,
      total: data.total_count || 0,
      items: (data.items || []).map(it => ({ full_name: it.full_name, description: it.description, html_url: it.html_url }))
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
