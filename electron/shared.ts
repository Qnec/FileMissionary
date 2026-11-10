export type ToolId = "yt-dlp" | "ffmpeg" | "imagemagick";

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

export interface ToolCommand {
  tool: ToolId;
  args: string[];
  cwd?: string;
}

export interface ToolProgress {
  percent: number | null;
  message: string;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  outputPath?: string;
}
