{
	pkgs ? import <nixpkgs> {}
}: pkgs.mkShell {
	# nativeBuildInputs is usually what you want -- tools you need to run
	nativeBuildInputs = with pkgs.buildPackages; [ nodejs_24 ffmpeg_9 imagemagick yt-dlp typescript_7 mono6 wineWow64Packages.stable ];
}
