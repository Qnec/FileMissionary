import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolId, ToolStatus } from "./shared";

const execFileAsync = promisify(execFile);

// Metadata needed to find and install each supported tool.
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

export function isExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform() === "win32") return true;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function candidateDirectories(): string[] {
  const dirs = new Set<string>();

  // macOS GUI apps often launch with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
  // Explicitly check standard package manager and user binary directories.
  if (platform() === "darwin") {
    dirs.add("/opt/homebrew/bin");
    dirs.add("/opt/homebrew/sbin");
    dirs.add("/usr/local/bin");
    dirs.add("/opt/local/bin");
    dirs.add(join(homedir(), ".local", "bin"));
    dirs.add(join(homedir(), "bin"));
    dirs.add("/usr/bin");
    dirs.add("/bin");
  } else if (platform() === "linux") {
    dirs.add(join(homedir(), ".local", "bin"));
    dirs.add(join(homedir(), "bin"));
    dirs.add("/usr/local/bin");
    dirs.add("/usr/bin");
    dirs.add("/bin");
  }

  const envPath = process.env.PATH ?? "";
  const pathSep = platform() === "win32" ? ";" : ":";
  for (const part of envPath.split(pathSep)) {
    const trimmed = part.trim();
    if (trimmed) dirs.add(trimmed);
  }

  return Array.from(dirs);
}

function candidateBinaryNames(definition: ToolDefinition): string[] {
  const isWin = platform() === "win32";
  if (definition.id === "imagemagick") {
    return isWin ? ["magick.exe", "convert.exe"] : ["magick", "convert"];
  }
  if (isWin) {
    return [definition.installedName ?? `${definition.executable}.exe`];
  }
  return [definition.executable];
}

export function findSystemExecutable(definition: ToolDefinition): string | undefined {
  const names = candidateBinaryNames(definition);
  const dirs = candidateDirectories();
  for (const dir of dirs) {
    for (const name of names) {
      const fullPath = join(dir, name);
      if (isExecutable(fullPath)) {
        return fullPath;
      }
    }
  }
  return undefined;
}

export function localExecutablePath(definition: ToolDefinition): string {
  const isWin = platform() === "win32";
  const fileName = isWin
    ? (definition.installedName ?? `${definition.executable}.exe`)
    : definition.executable;
  return join(toolsRoot(), definition.id, fileName);
}

export interface ResolvedExecutable {
  path: string;
  source: "local" | "system";
}

export function resolveExecutable(definition: ToolDefinition): ResolvedExecutable | undefined {
  const localPath = localExecutablePath(definition);
  if (isExecutable(localPath)) {
    return { path: localPath, source: "local" };
  }

  const systemPath = findSystemExecutable(definition);
  if (systemPath) {
    return { path: systemPath, source: "system" };
  }

  return undefined;
}

function findFile(root: string, fileName: string): string | undefined {
  // Archives and installers can place the executable in a nested folder.
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
  // Re-check the file system each time so the UI stays up to date.
  return Object.values(definitions).map((definition) => {
    const resolved = resolveExecutable(definition);
    const installed = resolved !== undefined;
    const path = resolved ? resolved.path : localExecutablePath(definition);

    let note: string;
    if (resolved?.source === "system") {
      note = `Detected on device at ${resolved.path}`;
    } else if (resolved?.source === "local") {
      note = "Installed locally in application tools directory.";
    } else if (platform() === "darwin") {
      note = `Not found on device. Install via Homebrew ('brew install ${definition.id === "yt-dlp" ? "yt-dlp" : definition.id}') or download manually.`;
    } else {
      note = definition.archive === "installer"
        ? "Downloads the official Windows installer and installs into this app's local tools directory."
        : definition.archive === "zip"
          ? "Downloads the Windows essentials archive and extracts only the executable into local tools."
          : "Downloads the official release executable into local tools.";
    }

    return {
      ...definition,
      executablePath: path,
      installed,
      note
    };
  });
}

export async function installTool(id: ToolId): Promise<ToolStatus> {
  const definition = definitions[id];
  const existing = resolveExecutable(definition);
  if (existing) {
    return getToolStatuses().find((status) => status.id === id)!;
  }

  const destination = localExecutablePath(definition);
  const directory = join(toolsRoot(), definition.id);
  mkdirSync(directory, { recursive: true });

  if (platform() === "darwin") {
    if (id === "yt-dlp") {
      const temporary = join(directory, ".download");
      const response = await fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos");
      if (!response.ok || !response.body) {
        throw new Error(`Could not download ${definition.label}: HTTP ${response.status}`);
      }
      try {
        await pipeline(response.body, createWriteStream(temporary));
        const digest = createHash("sha256").update(readFileSync(temporary)).digest("hex");
        renameSync(temporary, destination);
        chmodSync(destination, 0o755);
        console.info(`Installed ${definition.label}; downloaded SHA-256: ${digest}`);
      } finally {
        if (existsSync(temporary)) rmSync(temporary, { force: true });
      }
      return getToolStatuses().find((status) => status.id === id)!;
    }

    if (id === "imagemagick") {
      throw new Error(
        "ImageMagick cannot be auto-installed via Windows installer on macOS. Please run: 'brew install imagemagick'."
      );
    }

    if (id === "ffmpeg") {
      throw new Error(
        "FFmpeg requires a native macOS build. Please install it with: 'brew install ffmpeg'."
      );
    }
  }

  const extension = definition.archive ? `.${definition.archive === "zip" ? "zip" : "exe"}` : ".download";
  const temporary = join(directory, `.download${extension}`);
  // Download to a temporary file so an interrupted install is not mistaken for
  // a working executable.
  const response = await fetch(definition.downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${definition.label}: HTTP ${response.status}`);
  }
  try {
    await pipeline(response.body, createWriteStream(temporary));
    const digest = createHash("sha256").update(readFileSync(temporary)).digest("hex");
    if (definition.archive === "zip") {
      // Extract only the executable that the application needs.
      const extracted = join(directory, "extracted");
      rmSync(extracted, { recursive: true, force: true });
      mkdirSync(extracted, { recursive: true });
      if (platform() === "win32") {
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive", "-LiteralPath", temporary, "-DestinationPath", extracted, "-Force"]);
      } else {
        await execFileAsync("/usr/bin/unzip", ["-q", temporary, "-d", extracted]);
      }
      const targetName = platform() === "win32" ? definition.installedName! : definition.executable;
      const found = findFile(extracted, targetName);
      if (!found) throw new Error(`The ${definition.label} archive did not contain ${targetName}.`);
      renameSync(found, destination);
      if (platform() !== "win32") chmodSync(destination, 0o755);
      rmSync(extracted, { recursive: true, force: true });
    } else if (definition.archive === "installer") {
      // Run the installer silently into the app's local tools directory.
      if (platform() !== "win32") {
        throw new Error(`Cannot run Windows installer for ${definition.label} on ${platform()}.`);
      }
      await execFileAsync(temporary, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/DIR=${directory}`], { windowsHide: true });
      const found = findFile(directory, definition.installedName!);
      if (!found) throw new Error(`The ${definition.label} installer did not produce ${definition.installedName}.`);
      if (found !== destination) renameSync(found, destination);
    } else {
      renameSync(temporary, destination);
      if (platform() !== "win32") chmodSync(destination, 0o755);
    }
    console.info(`Installed ${definition.label}; downloaded SHA-256: ${digest}`);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return getToolStatuses().find((status) => status.id === id)!;
}
