# Changelog

## 0.2.4 — 2026-11-16

- New: **Check / Find Free Port…** (`…` menu and Command Palette). Shows whether a port is free, who holds it or whether Windows reserved it, and suggests the nearest free port (skipping reserved ranges). Common dev ports are listed when nothing is typed.

## 0.2.3 — 2026-11-16

- Fixed: *Port History…* did not open.
- Kill & Retry message no longer repeats the port number.
- New Marketplace page with a demo.

## 0.2.2 — 2026-11-16

- First release on the VS Code Marketplace (publisher `OAB714`).

## 0.2.1 — 2026-11-16

- New icon: a glass magnifier looking into a socket.

## 0.2.0 — 2026-11-16

First public preview (Windows only).

**See who holds a port**
- Ports view grouped by project: this workspace first, other projects, Background / Unassigned.
- Knows which VS Code window a port belongs to, by following the process tree back to the terminal that started it.
- Technology icons (Node, Vite, Next, Python, Django, Laravel…), memory, uptime, LAN marker, orphaned servers.
- ▲ / ⏱ badges for memory hogs and long-running servers (`memoryWarningMB`, `longRunningHours`).

**Free it safely**
- Kill with Ctrl+C first for servers in this window's terminals, then `taskkill /T`, then *Kill as Administrator*.
- Never touches Windows system processes, VS Code itself, Docker or WSL forwarders.
- Multi-select (`Ctrl`/`Shift`+click) with one confirmation; `Delete` = kill, `Enter` = open in browser.
- Kill All Processes in Project, Kill Port… (type a port number), Clean Up Orphaned Processes.

**Dev-server workflow**
- **Kill & Retry** when a terminal prints `EADDRINUSE`.
- **Restart** a dev server with the exact command that started it.
- **Port History…** across all projects: run a stopped server again; secrets (`API_KEY=…`, tokens) are hidden.
- Ports **reserved by Windows** (Hyper-V/WSL excluded ranges): explains `EACCES` and how to fix it.
- **Test on your phone**: Copy LAN URL and Show QR Code.
- Optional **Auto Refresh** every few seconds (off by default), Sort By / Group by Project, pinned ports, Copy Port List as Markdown.

No telemetry. No webview. English and Vietnamese.

## 0.1.0

- Internal scaffold (not released).
