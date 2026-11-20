# File Missionary

A local-first Electron wrapper for [yt-dlp](https://github.com/yt-dlp/yt-dlp),
[FFmpeg](https://ffmpeg.org/), and [ImageMagick](https://imagemagick.org/).

## Status

This public repository is an MVP showing the deployment shape from the design:
the Electron renderer communicates over a narrow, context-isolated IPC bridge
with a Node.js entry process, which owns local storage and tool subprocesses.

Third-party binaries are intentionally not committed. The tool manager stores
installed binaries in the user's local application data directory. Downloads
are made over HTTPS, and the SHA-256 digest is recorded in the Electron process
log after each download. The current Windows sources are the yt-dlp release,
the BtbN LGPL FFmpeg build, and the official ImageMagick Windows release.

The dashboard provides separate Downloader and Converter windows. Downloader
supports a quick MP4 or MP3 profile, link metadata preview, saved quality and
format preferences, and a required local output directory. Converter supports
individual or batch image/video conversion, local progress reporting, and
hardware FFmpeg encoders when the installed build exposes them. Video
conversion uses stream copy by default where possible to avoid unnecessary
re-encoding.

## Requirements

The current tool installer supports Windows 10/11 only. It downloads Windows
builds of yt-dlp, FFmpeg, and ImageMagick and uses PowerShell to extract or
install them. macOS and Linux are not currently supported.

Install [Node.js 22 or newer](https://nodejs.org/) before continuing. npm is
included with Node.js.

## Development

From a fresh checkout:

```powershell
npm ci
npm run dev
```

The app opens with no third-party tools installed. In the app, use the tool
cards to install yt-dlp, FFmpeg, and/or ImageMagick as needed. They are stored
in the user's local application data directory and do not need to be installed
globally.

Build and type-check:

```powershell
npm run build
npm run typecheck
```

The complete quality command is `npm test`. It runs TypeScript checks, ESLint,
Vitest unit tests, and both production builds.

To run the production build locally after building:

```powershell
npm start
```

## Licensing

Read [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) before distributing
anything. A public repository does not eliminate the need to preserve the
licenses and notices of downloaded binaries. FFmpeg builds must still be reviewed individually: an `--enable-gpl` or
`--enable-nonfree` build changes the distribution obligations.
