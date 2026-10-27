Requirements:
Windows in WSL, Linux, Macos:
nix-shell OR nodejs v24, ffmpeg v9, imagemagick v7, latest yt-dlp, typescript v7, mono v6, wine64

With nix-shell:
```bash
cd FileMissionary
nix-channel --add https://nixos.org/channels/nixpkgs-unstable
nix-channel --update
nix-shell
npm install
```

Without nix-shell:

install all the dependencies then
```bash
cd FileMissionary
export WINEPREFIX="$PWD/.wine"
npm install
```

When developing:
```bash
cd FileMissionary
nix-shell
```
