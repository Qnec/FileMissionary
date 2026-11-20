import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToolId, ToolProgress, ToolStatus } from "../electron/shared";
import { fileName, replaceExtension } from "./media-paths";
import "./style.css";

type View = "download" | "convert";
type DownloadFormat = "mp4" | "mp3";
type ConversionKind = "video" | "image";

function App() {
  // The renderer owns all UI state; file-system and tool actions go through
  // the context-isolated `window.missionary` preload API.
  const [view, setView] = useState<View>("download");
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [storage, setStorage] = useState("");
  const [message, setMessage] = useState("Ready");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>(() => (localStorage.getItem("download-format") as DownloadFormat) || "mp4");
  const [quality, setQuality] = useState(() => localStorage.getItem("download-quality") || "best");
  const [metadata, setMetadata] = useState<{ title?: string; duration?: number; thumbnail?: string }>();
  const [inputs, setInputs] = useState<string[]>([]);
  const [conversionKind, setConversionKind] = useState<ConversionKind>("video");
  const [conversionFormat, setConversionFormat] = useState("mp4");
  const [hardwareEncoder, setHardwareEncoder] = useState("auto");
  const [hardwareEncoders, setHardwareEncoders] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [lastOutput, setLastOutput] = useState("");
  const [busy, setBusy] = useState(false);

  // Refresh the installed-tool list and discover FFmpeg hardware encoders.
  const refresh = async () => {
    const nextTools = await window.missionary.listTools();
    setTools(nextTools);

    if (nextTools.some((tool) => tool.id === "ffmpeg" && tool.installed)) {
      setHardwareEncoders(await window.missionary.getHardwareEncoders());
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Subscribe to progress events emitted by the Electron main process.
  useEffect(
    () =>
      window.missionary.onProgress((update: ToolProgress) => {
        setProgress(update.percent);
        setProgressMessage(update.message);
      }),
    []
  );

  // Persist the user's download choices so the next launch restores them.
  useEffect(() => {
    localStorage.setItem("download-format", downloadFormat);
    localStorage.setItem("download-quality", quality);
  }, [downloadFormat, quality]);

  // A tool is usable only after the main process reports it as installed.
  const toolReady = (id: ToolId) =>
    tools.some((tool) => tool.id === id && tool.installed);

  // Convert seconds from yt-dlp metadata into a user-friendly M:SS label.
  const durationLabel = useMemo(
    () =>
      metadata?.duration
        ? `${Math.floor(metadata.duration / 60)}:${String(
            metadata.duration % 60
          ).padStart(2, "0")}`
        : "",
    [metadata]
  );

  // Install one missing local dependency, then refresh the tool list.
  async function install(id: ToolId) {
    setBusy(true);
    setError("");
    setMessage(`Installing ${id}...`);

    try { await window.missionary.installTool(id); await refresh(); setMessage(`${id} is ready.`); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Installation failed.");
      setMessage("Installation failed.");
    } finally {
      setBusy(false);
    }
  }

  // Ask yt-dlp for metadata only; this powers the optional link preview.
  async function inspectUrl() {
    if (!url.trim()) return;
    if (!toolReady("yt-dlp")) {
      setError("Install yt-dlp before inspecting a link.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("Reading video details...");

    try {
      const result = await window.missionary.runTool({
        tool: "yt-dlp",
        args: [
          "--dump-single-json",
          "--skip-download",
          "--no-playlist",
          url
        ]
      });

      // yt-dlp may print informational lines, so select the JSON object line.
      if (result.code !== 0) throw new Error(result.stderr || "yt-dlp could not read this link.");

      const jsonLine = result.stdout
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith("{"));
      if (!jsonLine) throw new Error("The link did not return video details.");

      const details = JSON.parse(jsonLine) as {
        title?: string;
        duration?: number;
        thumbnail?: string;
      };
      setMetadata(details);
      setMessage("Video details loaded.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not inspect the link."
      );
      setMessage("Inspection failed.");
    } finally {
      setBusy(false);
    }
  }

  // Download the requested URL into the selected folder using yt-dlp.
  async function download() {
    if (!storage) {
      setError("Choose an output folder first.");
      return;
    }
    if (!url.trim()) {
      setError("Paste a video link first.");
      return;
    }
    if (!toolReady("yt-dlp")) {
      setError("Install yt-dlp to download media.");
      return;
    }
    if (downloadFormat === "mp4" && !toolReady("ffmpeg")) {
      setError("Install FFmpeg to merge MP4 video and audio.");
      return;
    }

    setBusy(true);
    setError("");
    setProgress(0);
    setMessage("Downloading...");

    try {
      // MP3 uses the best audio stream; MP4 selects compatible video/audio
      // streams and optionally limits video height to the chosen quality.
      const format = downloadFormat === "mp3"
        ? "bestaudio/best"
        : quality === "best"
          ? "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best"
          : `bestvideo[ext=mp4][vcodec^=avc1][height<=${quality}]+bestaudio[ext=m4a][acodec^=mp4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a][height<=${quality}]/best`;
      // These shared arguments prevent playlists and make yt-dlp report the
      // final output path after any post-processing is complete.
      const args = [
        "--no-playlist",
        "-f",
        format,
        "--print",
        "after_move:filepath",
        "-P",
        storage
      ];

      if (downloadFormat === "mp3") {
        // Extract audio and convert it to the format selected by the user.
        args.push("--extract-audio", "--audio-format", "mp3");
      } else {
        const ffmpeg = tools.find((tool) => tool.id === "ffmpeg");
        if (!ffmpeg?.installed) throw new Error("FFmpeg is required to create an MP4.");

        // FFmpeg merges separate streams and guarantees an MP4 output file.
        args.push(
          "--ffmpeg-location",
          ffmpeg.executablePath,
          "--merge-output-format",
          "mp4",
          "--recode-video",
          "mp4"
        );
      }

      args.push(url);
      const result = await window.missionary.runTool({
        tool: "yt-dlp",
        args,
        cwd: storage
      });

      if (result.code !== 0) throw new Error(result.stderr || "yt-dlp failed.");
      if (result.outputPath) setLastOutput(result.outputPath);
      setProgress(100);
      setMessage("Download completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.");
      setMessage("Download failed.");
    } finally {
      setBusy(false);
    }
  }

  // Convert each selected local file with FFmpeg or ImageMagick.
  async function convert() {
    if (!inputs.length) {
      setError("Choose at least one input file.");
      return;
    }
    if (!storage) {
      setError("Choose an output folder first.");
      return;
    }

    const tool: ToolId =
      conversionKind === "image" ? "imagemagick" : "ffmpeg";
    if (!toolReady(tool)) {
      setError(`Install ${tool} to convert files.`);
      return;
    }

    setBusy(true);
    setError("");
    setProgress(0);
    setMessage(
      `Converting ${inputs.length} file${inputs.length === 1 ? "" : "s"}...`
    );

    try {
      // Process files sequentially so progress and failures map to one file.
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        const output = `${storage}\\${fileName(
          replaceExtension(input, conversionFormat)
        )}`;
        // ImageMagick receives input/output directly. FFmpeg uses an audio
        // command for MP3 and either stream-copy or hardware video encoding.
        const args =
          conversionKind === "image"
            ? [input, output]
            : conversionFormat === "mp3"
              ? ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", output]
              : [
                  "-y",
                  "-i",
                  input,
                  ...(hardwareEncoder !== "auto"
                    ? ["-c:v", hardwareEncoder, "-c:a", "aac"]
                    : ["-c", "copy"]),
                  output
                ];
        const result = await window.missionary.runTool({
          tool,
          args,
          cwd: storage
        });

        if (result.code !== 0) {
          throw new Error(
            result.stderr || `${tool} failed for ${fileName(input)}.`
          );
        }

        setLastOutput(output);
        setProgress(((index + 1) / inputs.length) * 100);
      }

      setMessage("Conversion completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Conversion failed.");
      setMessage("Conversion failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      {/* Header: application identity and the current operation status. */}
      <header>
        <div>
          <p className="eyebrow">LOCAL MEDIA WORKBENCH</p>
          <h1>Local File Missionary</h1>
          <p className="subtitle">
            Private downloads and conversions powered by local tools.
          </p>
        </div>
        <span className="status"><i /> {message}</span>
      </header>
      {/* Switch between the downloader and local file converter workflows. */}
      <nav className="window-tabs" aria-label="Main sections">
        <button
          className={view === "download" ? "active" : "secondary"}
          onClick={() => setView("download")}
        >
          Downloader
        </button>
        <button
          className={view === "convert" ? "active" : "secondary"}
          onClick={() => setView("convert")}
        >
          Converter
        </button>
      </nav>
      {/* Shared destination folder used by both download and conversion flows. */}
      <section className="panel storage">
        <div>
          <p className="eyebrow">OUTPUT DIRECTORY</p>
          <strong>{storage || "No output folder selected"}</strong>
          <small>All results are saved here; no hosted upload is used.</small>
        </div>
        <button
          onClick={async () => {
            const selected = await window.missionary.selectStorage();
            if (selected) setStorage(selected);
          }}
        >
          Choose folder
        </button>
      </section>
      {/* Only the active workflow is rendered to keep the interface focused. */}
      {view === "download" ? (
        <section className="panel workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">QUICK DOWNLOAD</p>
              <h2>Paste a link and go</h2>
            </div>
            <span className="hint">Profile saved automatically</span>
          </div>
          <div className="url-row">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void inspectUrl();
              }}
              placeholder="Paste a YouTube or supported video link"
              aria-label="Video URL"
            />
            <button
              className="secondary"
              onClick={() => void inspectUrl()}
              disabled={busy}
            >
              Preview
            </button>
          </div>
          {metadata && (
            <div className="media-preview">
              {metadata.thumbnail && <img src={metadata.thumbnail} alt="" />}
              {metadata.title && (
                <div>
                  <strong>{metadata.title}</strong>
                  <span>{durationLabel}</span>
                </div>
              )}
            </div>
          )}
          <div className="field-grid">
            <label>
              Output format
              <select
                value={downloadFormat}
                onChange={(event) =>
                  setDownloadFormat(event.target.value as DownloadFormat)
                }
              >
                <option value="mp4">MP4 video</option>
                <option value="mp3">MP3 audio</option>
              </select>
            </label>
            {downloadFormat === "mp4" && (
              <label>
                Quality
                <select
                  value={quality}
                  onChange={(event) => setQuality(event.target.value)}
                >
                  <option value="best">Best available</option>
                  <option value="2160">Up to 4K</option>
                  <option value="1080">Up to 1080p</option>
                  <option value="720">Up to 720p</option>
                </select>
              </label>
            )}
          </div>
          <button
            className="run-button"
            onClick={() => void download()}
            disabled={busy}
          >
            Download {downloadFormat.toUpperCase()}
          </button>
        </section>
      ) : (
        <section className="panel workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LOCAL CONVERTER</p>
              <h2>Convert files in batches</h2>
            </div>
            <span className="hint">No internet required</span>
          </div>
          <div className="operation-tabs">
            <button
              className={conversionKind === "video" ? "active" : "secondary"}
              onClick={() => setConversionKind("video")}
            >
              Video / audio
            </button>
            <button
              className={conversionKind === "image" ? "active" : "secondary"}
              onClick={() => setConversionKind("image")}
            >
              Images
            </button>
          </div>
          <div className="file-picker">
            <div>
              <strong>
                {inputs.length
                  ? `${inputs.length} file${inputs.length === 1 ? "" : "s"} selected`
                  : "No files selected"}
              </strong>
              {inputs.length > 0 && (
                <small>{inputs.map(fileName).join(", ")}</small>
              )}
            </div>
            <button
              className="secondary"
              onClick={async () =>
                setInputs(await window.missionary.selectFiles())
              }
            >
              Choose files
            </button>
          </div>
          <div className="field-grid">
            <label>
              Output format
              <select
                value={conversionFormat}
                onChange={(event) => setConversionFormat(event.target.value)}
              >
                {(conversionKind === "image"
                  ? ["png", "jpg", "webp", "tiff"]
                  : ["mp4", "mkv", "webm", "mov", "mp3"]
                ).map((format) => (
                  <option key={format}>{format}</option>
                ))}
              </select>
            </label>
            {conversionKind === "video" && (
              <label>
                Video encoder
                <select
                  value={hardwareEncoder}
                  onChange={(event) => setHardwareEncoder(event.target.value)}
                >
                  <option value="auto">Automatic (local CPU)</option>
                  {hardwareEncoders.map((encoder) => (
                    <option key={encoder} value={encoder}>
                      {encoder} (hardware)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            className="run-button"
            onClick={() => void convert()}
            disabled={busy}
          >
            Convert {inputs.length || ""} file{inputs.length === 1 ? "" : "s"}
          </button>
        </section>
      )}
      {/* Progress is shown for tool operations that report work or a percent. */}
      {(progress !== null || progressMessage) && (
        <div className="progress-area">
          <div className="progress-track">
            <div style={{ width: `${progress ?? 35}%` }} />
          </div>
          <span>
            {progress === null ? "Working..." : `${Math.round(progress)}%`}
          </span>
          <small>{progressMessage.slice(0, 140)}</small>
        </div>
      )}
      {/* Errors are rendered outside the workflow panels so they remain visible. */}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {lastOutput && (
        <div className="output-actions">
          <span>Output ready: {lastOutput}</span>
          <button onClick={() => void window.missionary.openPath(lastOutput)}>
            Open
          </button>
          <button
            className="secondary"
            onClick={() => void window.missionary.showPath(lastOutput)}
          >
            Show in folder
          </button>
        </div>
      )}
      {/* Installed dependencies and their local install actions. */}
      <section className="tools-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOCAL COMPONENTS</p>
            <h2>Toolchain</h2>
          </div>
          <button className="secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="tool-grid">
          {tools.map((tool) => (
            <article className="panel tool" key={tool.id}>
              <div className="tool-title">
                <div className={`icon ${tool.id}`}>
                  {tool.id === "yt-dlp"
                    ? "↓"
                    : tool.id === "ffmpeg"
                      ? "▶"
                      : "✦"}
                </div>
                <div>
                  <h3>{tool.label}</h3>
                  <span>{tool.version}</span>
                </div>
                <b className={tool.installed ? "installed" : "missing"}>
                  {tool.installed ? "READY" : "NOT INSTALLED"}
                </b>
              </div>
              <p className="license">{tool.license}</p>
              <p className="note">{tool.note}</p>
              <div className="tool-actions">
                <a href={tool.source} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
                <button
                  disabled={tool.installed || busy}
                  onClick={() => void install(tool.id)}
                >
                  {tool.installed ? "Installed" : "Install locally"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer>Third-party binaries are local and separately licensed. Review <b>THIRD-PARTY-NOTICES.txt</b> before distribution.</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
