import { contextBridge, ipcRenderer } from "electron";
import type { ProcessResult, ToolCommand, ToolId, ToolProgress, ToolStatus } from "./shared";

contextBridge.exposeInMainWorld("missionary", {
  listTools: (): Promise<ToolStatus[]> => ipcRenderer.invoke("tools:list"),
  installTool: (id: ToolId): Promise<ToolStatus> => ipcRenderer.invoke("tools:install", id),
  selectStorage: (): Promise<string | undefined> => ipcRenderer.invoke("storage:select"),
  selectFile: (): Promise<string | undefined> => ipcRenderer.invoke("file:select"),
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke("files:select"),
  getHardwareEncoders: (): Promise<string[]> => ipcRenderer.invoke("hardware:encoders"),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke("path:open", path),
  showPath: (path: string): Promise<void> => ipcRenderer.invoke("path:show", path),
  runTool: (command: ToolCommand): Promise<ProcessResult> => ipcRenderer.invoke("tools:run", command),
  onProgress: (callback: (progress: ToolProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ToolProgress) => callback(progress);
    ipcRenderer.on("tools:progress", listener);
    return () => ipcRenderer.removeListener("tools:progress", listener);
  }
});
