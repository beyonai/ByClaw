// ByClaw 桌面端 preload：向渲染进程暴露本地 Agent 状态桥（M4 扩展点）
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("byclawDesktop", {
  version: "0.1.0",
  apiTarget: process.env.BYCLAW_BE_BASE_URL || "",
  // M4: 本地 Agent sidecar 状态/控制将通过 ipcRenderer 注入这里
  agent: {
    online: false,
  },
});
