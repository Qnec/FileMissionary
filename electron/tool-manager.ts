import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolId, ToolStatus } from "./shared";

const execFileAsync = promisify(execFile);

type ToolDefinition = Omit<ToolStatus, "installed" | "executablePath" | "note"> & {
  executable: string;
  downloadUrl: string;
  archive?: "zip" | "installer";
  installedName?: string;
};

const definitions: Record<ToolId, ToolDefinition> = {
  "yt-dlp": {
    id: "yt-dlp",
    label: "yt-dlp",
    version: "latest release",
    executable: "yt-dlp",
    downloadUrl: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    license: "Unlicense",
    source: "https://github.com/yt-dlp/yt-dlp"
  },
  ffmpeg: {
    id: "ffmpeg",
    label: "FFmpeg (LGPL profile)",
    version: "release essentials",
    executable: "ffmpeg",
    downloadUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-lgpl.zip",
    archive: "zip",
    license: "LGPL-2.1-or-later (build-dependent)",
    source: "https://ffmpeg.org/",
    installedName: "ffmpeg.exe"
  },
  imagemagick: {
    id: "imagemagick",
    label: "ImageMagick",
    version: "7.1.2-35",
    executable: "magick",
    downloadUrl: "https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-35/ImageMagick-7.1.2-35-Q16-x64-dll.exe",
    archive: "installer",
    license: "ImageMagick License",
    source: "https://imagemagick.org/",
    installedName: "magick.exe"
  }
};

function toolsRoot(): string {
  const root = platform() === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "LocalFileMissionary", "tools")
    : join(homedir(), ".local", "share", "local-file-missionary", "tools");
  mkdirSync(root, { recursive: true });
  return root;
}

function executablePath(definition: ToolDefinition): string {
  const suffix = platform() === "win32" ? ".exe" : "";
  return join(toolsRoot(), definition.id, definition.installedName ?? `${definition.executable}${suffix}`);
}

function findFile(root: string, fileName: string): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return path;
    if (entry.isDirectory()) {
      const found = findFile(path, fileName);
      if (found) return found;
    }
  }
  return undefined;
}

export function getToolStatuses(): ToolStatus[] {
  return Object.values(definitions).map((definition) => {
    const path = executablePath(definition);
    return {
      ...definition,
      executablePath: path,
      installed: existsSync(path),
      note: definition.archive === "installer"
        ? "Downloads the official Windows installer and installs into this app's local tools directory."
        : definition.archive === "zip"
          ? "Downloads the Windows essentials archive and extracts only the executable into local tools."
          : "Downloads the official release executable into local tools."
    };
  });
}

export async function installTool(id: ToolId): Promise<ToolStatus> {
  const definition = definitions[id];
  const destination = executablePath(definition);
  const directory = join(toolsRoot(), definition.id);
  mkdirSync(directory, { recursive: true });
  const extension = definition.archive ? `.${definition.archive === "zip" ? "zip" : "exe"}` : ".download";
  const temporary = join(directory, `.download${extension}`);
  const response = await fetch(definition.downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${definition.label}: HTTP ${response.status}`);
  }
  try {
    await pipeline(response.body, createWriteStream(temporary));
    const digest = createHash("sha256").update(readFileSync(temporary)).digest("hex");
    if (definition.archive === "zip") {
      const extracted = join(directory, "extracted");
      rmSync(extracted, { recursive: true, force: true });
      mkdirSync(extracted, { recursive: true });
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive", "-LiteralPath", temporary, "-DestinationPath", extracted, "-Force"]);
      const found = findFile(extracted, definition.installedName!);
      if (!found) throw new Error(`The ${definition.label} archive did not contain ${definition.installedName}.`);
      renameSync(found, destination);
      rmSync(extracted, { recursive: true, force: true });
    } else if (definition.archive === "installer") {
      await execFileAsync(temporary, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/DIR=${directory}`], { windowsHide: true });
      const found = findFile(directory, definition.installedName!);
      if (!found) throw new Error(`The ${definition.label} installer did not produce ${definition.installedName}.`);
      if (found !== destination) renameSync(found, destination);
    } else {
      renameSync(temporary, destination);
    }
    console.info(`Installed ${definition.label}; downloaded SHA-256: ${digest}`);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return getToolStatuses().find((status) => status.id === id)!;
}
