import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getToolStatuses, installTool } from "./tool-manager";
import type { ProcessResult, ToolCommand, ToolProgress } from "./shared";

let window: BrowserWindow | undefined;
const execFileAsync = promisify(execFile);

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 850,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, "..", "dist-renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("tools:list", () => getToolStatuses());
ipcMain.handle("tools:install", async (_event, id) => installTool(id));
ipcMain.handle("storage:select", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle("file:select", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"] });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.handle("files:select", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("hardware:encoders", async () => {
  const ffmpeg = getToolStatuses().find((tool) => tool.id === "ffmpeg");
  if (!ffmpeg?.installed || !existsSync(ffmpeg.executablePath)) return [];
  const result = await execFileAsync(ffmpeg.executablePath, ["-hide_banner", "-encoders"]);
  const encoders = ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"];
  return encoders.filter((encoder) => result.stdout.includes(encoder));
});
ipcMain.handle("path:open", async (_event, path: string) => {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
});
ipcMain.handle("path:show", (_event, path: string) => shell.showItemInFolder(path));
ipcMain.handle("tools:run", async (_event, command: ToolCommand) => {
  const status = getToolStatuses().find((tool) => tool.id === command.tool);
  if (!status || !status.installed || !existsSync(status.executablePath)) {
    throw new Error(`${command.tool} is not installed.`);
  }
  if (command.cwd && (!existsSync(command.cwd) || !statSync(command.cwd).isDirectory())) {
    throw new Error("The selected output directory is not valid.");
  }
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(status.executablePath, command.args, {
      cwd: command.cwd,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const report = (message: string) => {
      const match = message.match(/(\d+(?:\.\d+)?)%/);
      const progress: ToolProgress = { percent: match ? Number(match[1]) : null, message: message.trim() };
      _event.sender.send("tools:progress", progress);
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); stderr += text; report(text); });
    child.on("error", reject);
    child.on("close", (code) => {
      const outputPath = command.tool === "yt-dlp"
        ? stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop()
        : undefined;
      resolve({ code: code ?? -1, stdout, stderr, outputPath });
    });
  });
});
