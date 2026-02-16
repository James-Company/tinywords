const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: "darwin",
  isElectron: true,
});
