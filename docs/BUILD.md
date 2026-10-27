Build for Linux

`npm run make -- --platform linux`

Build for Windows (if running on a linux system without nix-shell, make sure that WINEPREFIX is set to a desired location and that `winecfg` has been run at least once for that location)

`npm run make -- --platform win32`

Build for Macos (May or may not work properly on non-macos systems)

`npm run make -- --platform darwin` 
