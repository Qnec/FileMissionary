import { describe, expect, it } from "vitest";
import { fileName, replaceExtension } from "./media-paths";

describe("media path helpers", () => {
  it("extracts file names from Windows and POSIX paths", () => {
    expect(fileName("C:\\media\\wallpaper.png")).toBe("wallpaper.png");
    expect(fileName("/media/wallpaper.png")).toBe("wallpaper.png");
  });

  it("replaces only the final extension and preserves the directory", () => {
    expect(replaceExtension("C:\\media\\clip.source.mp4", "mp3")).toBe("C:\\media\\clip.source.mp3");
    expect(replaceExtension("/media/wallpaper.png", "jpg")).toBe("/media/wallpaper.jpg");
  });

  it("uses a safe fallback for an empty path", () => {
    expect(fileName("")).toBe("output");
  });
});
