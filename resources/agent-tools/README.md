# Agent Tools

This directory holds the external command-line tools that Pi needs at runtime:

- `rg` / `rg.exe` — ripgrep (fast recursive grep)
- `fd` / `fd.exe` — fd (fast file finder)

Pi looks for these tools in `~/.pi/agent/bin` first, then in `PATH`. The Electron shell prepends this directory to `PATH` when spawning `pi --mode rpc`, so the bundled tools are used instead of downloading them from the internet.

Do not commit the actual binaries. CI downloads the platform-specific versions from the official GitHub releases and stages them here before packaging.
