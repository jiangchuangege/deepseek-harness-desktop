// deepseek-harness-desktop 主进程
// 职责:
//   1) 打开 DSH Web 界面(默认连接 DSH_WEB_URL 或 http://127.0.0.1:3080)
//   2) 自动拉起本地"工具调用补丁"代理(tool_proxy.py, 端口 8081)
//   3) 通过 IPC 提供插件注册表信息, 供窗口内"插件面板"使用
//   4) 支持从窗口触发"安装 GitHub 插件/技能"(dsh plugin add)

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DSH_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const PROXY_PORT = 8081;
const PROXY_UPSTREAM = process.env.HARNESS_PROXY_UPSTREAM || 'http://127.0.0.1:8080';
const PLUGINS_FILE = path.join(__dirname, 'config', 'plugins.json');

let mainWindow = null;
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

function cleanup() {
  if (proxyProc) { proxyProc.kill(); }
  if (dshProc) { dshProc.kill(); }
}

app.whenReady().then(() => {
  startProxy();
  maybeStartDsh();
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => cleanup());

// ---- IPC: 给渲染进程的插件信息 & 安装动作 ----
ipcMain.handle('get-plugins', () => readPlugins());

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
