# Agent Binaries

Place the Pi agent binaries here for development, or let CI build them from `third_party/pi`.

Expected file names:

- `pi-linux-x64`
- `pi-linux-arm64`
- `pi-win.exe`
- `pi-darwin-x64`
- `pi-darwin-arm64`

The shell spawns the binary with `--mode rpc` and talks to it over stdin/stdout using Pi's JSON-RPC protocol (e.g. `get_state` as a health check).

CI builds the binary at `third_party/pi/packages/coding-agent/dist/pi` (or `dist/pi.exe` on Windows) using `bun run build:binary` and copies it to the names above. If the binary is missing, the shell runs in stub mode and the status page will show `binaryExists: false`.
