// 渲染进程 <-> 主进程 的安全桥(不开放 Node 权限, 只暴露最小接口)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harnessDesktop', {
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  installPlugin: (spec) => ipcRenderer.invoke('install-plugin', spec),
  openProxyCheck: () => ipcRenderer.invoke('open-proxy-check'),
  searchPlugins: (query) => ipcRenderer.invoke('search-plugins', query),
  resizePet: (w, h) => ipcRenderer.invoke('resize-pet', w, h),
  openMarket: () => ipcRenderer.invoke('open-plugin-market'),
  openProxy: () => ipcRenderer.invoke('open-proxy-external')
});
