import type { ProcessResult, ToolCommand, ToolId, ToolProgress, ToolStatus } from "../electron/shared";

declare global {
  interface Window {
    missionary: {
      listTools(): Promise<ToolStatus[]>;
      installTool(id: ToolId): Promise<ToolStatus>;
      selectStorage(): Promise<string | undefined>;
      selectFile(): Promise<string | undefined>;
      selectFiles(): Promise<string[]>;
      getHardwareEncoders(): Promise<string[]>;
      openPath(path: string): Promise<void>;
      showPath(path: string): Promise<void>;
      runTool(command: ToolCommand): Promise<ProcessResult>;
      onProgress(callback: (progress: ToolProgress) => void): () => void;
    };
  }
}

export {};
