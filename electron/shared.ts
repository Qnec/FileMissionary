// These types are shared by the Electron main process and the React renderer.
export type ToolId = "yt-dlp" | "ffmpeg" | "imagemagick";

// Information shown for each optional command-line tool.
export interface ToolStatus {
  id: ToolId;
  label: string;
  version: string;
  installed: boolean;
  executablePath: string;
  license: string;
  source: string;
  note: string;
}

// A command sent from the renderer to the main process.
export interface ToolCommand {
  tool: ToolId;
  args: string[];
  cwd?: string;
}

// Progress text and an optional percentage reported by a running tool.
export interface ToolProgress {
  percent: number | null;
  message: string;
}

// The final result returned after a command exits.
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  outputPath?: string;
}
