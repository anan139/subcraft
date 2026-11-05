// 预加载：向渲染进程暴露安全的 IPC 与后端地址
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const portArg = process.argv.find((a) => a.startsWith('--subcraft-port='))
const port = portArg ? portArg.split('=')[1] : '47653'
const tokenArg = process.argv.find((a) => a.startsWith('--subcraft-token='))
const token = tokenArg ? tokenArg.split('=')[1] : ''

contextBridge.exposeInMainWorld('subcraft', {
  apiBase: `http://127.0.0.1:${port}`,
  wsBase: `ws://127.0.0.1:${port}`,
  token,
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  selectDirDialog: () => ipcRenderer.invoke('dialog:selectDir'),
  saveFileDialog: (defaultName, ext) => ipcRenderer.invoke('dialog:saveFile', defaultName, ext),
  // 拖拽导入：Electron 32+ 移除了 File.path，需经 preload 的 webUtils 换取磁盘路径
  getPathForFile: (file) => webUtils.getPathForFile(file),
})
