# Agent Binaries

Place the Pi agent binaries here for development, or let CI build and copy them from `third_party/pi`.

Expected file names:

- `pi-linux-x64`
- `pi-linux-arm64`
- `pi-win.exe`
- `pi-darwin-x64`
- `pi-darwin-arm64`

The shell will look for `pi-{platform}-{arch}` (or `pi.exe` on Windows) under `resources/bin` in development and under `resources/bin` (via `process.resourcesPath`) in production.

If the binary is missing, the shell runs in stub mode and logs a warning.
