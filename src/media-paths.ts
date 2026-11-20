export function fileName(path: string): string {
  // Supporting both separators makes this helper work with Windows and POSIX paths.
  return path.split(/[\\/]/).pop() || "output";
}

export function replaceExtension(path: string, extension: string): string {
  // Remove only the final extension and keep the original directory unchanged.
  const name = fileName(path).replace(/\.[^.]+$/, "");
  const directory = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  return `${directory}${name}.${extension}`;
}

export function joinStoragePath(directory: string, file: string): string {
  if (!directory) return file;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  const trimmed = directory.replace(/[\\/]+$/, "");
  return `${trimmed}${separator}${file}`;
}