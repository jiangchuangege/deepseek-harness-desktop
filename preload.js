// 渲染进程 <-> 主进程 的安全桥(不开放 Node 权限, 只暴露最小接口)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessDesktop', {
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  installPlugin: (spec) => ipcRenderer.invoke('install-plugin', spec),
  openProxyCheck: () => ipcRenderer.invoke('open-proxy-check'),
  searchPlugins: (query, page) => ipcRenderer.invoke('search-plugins', query, page),
  openPetMenu: () => ipcRenderer.invoke('show-pet-menu'),
  openMarket: () => ipcRenderer.invoke('open-plugin-market'),
  openProxy: () => ipcRenderer.invoke('open-proxy-external'),
  startDrag: () => ipcRenderer.send('start-drag'),
  stopDrag: () => ipcRenderer.send('stop-drag'),
  getManaged: () => ipcRenderer.invoke('get-managed'),
  toggleManaged: (spec) => ipcRenderer.invoke('toggle-managed', spec),
  deleteManaged: (spec) => ipcRenderer.invoke('delete-managed', spec),
  checkProxy: () => ipcRenderer.invoke('check-proxy'),
  chatSend: (text) => ipcRenderer.invoke('chat-send', text),
  startDsh: () => ipcRenderer.invoke('start-dsh'),
  stopDsh: () => ipcRenderer.invoke('stop-dsh'),
  dshStatus: () => ipcRenderer.invoke('dsh-status'),
  showNotice: (opts) => ipcRenderer.invoke('show-notice', opts),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (_e, data) => cb(data))
});
