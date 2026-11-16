# Who's On My Port

**Find which process is holding a port, which VS Code window it belongs to, and free it — without killing the wrong project.**

> Windows only in v1.0 · No telemetry · No webview · 0% CPU when idle

<!-- TODO: demo GIF (multi-window + Kill & Retry) -->

## Features

- **Ports grouped by owner**: *Current Workspace*, *Other Projects* (labelled with the VS Code window that owns them), *Orphaned*, *System*.
- **Accurate window detection**: follows the process tree back to the integrated terminal that started it. It doesn't guess from paths.
- **Kill & Retry**: when a terminal prints `EADDRINUSE` / *port already in use*, one click frees the port and re-runs your command.
- **Graceful stop**: processes started in this window's terminals get `Ctrl+C` first and are force-killed only if needed.
- **Orphan detection**: finds dev servers left running after their terminal or window was closed.
- **Safety net**: never kills Windows system processes, VS Code itself, or Docker/WSL port forwarders.
- **Kill Port…** from the Command Palette, **status bar** counter, **pinned ports** with free/busy state, **Kill All in Workspace**.
- Runs as Administrator? You get a 🔒 marker and a *Kill as Administrator* (UAC) option.
- ⚠ LAN marker for servers reachable from your network (`0.0.0.0`).
- **Restart dev server**: one click (restart icon) stops a server that runs in this window's terminal and re-runs the exact command that started it (needs shell integration; shown only when the command is known).
- **Test on your phone**: *Copy LAN URL* and *Show QR Code for Phone* for servers bound to `0.0.0.0` / a LAN IP. The QR code opens as an image in the editor; Wi-Fi/Ethernet addresses are preferred over WSL/Hyper-V/VM adapters.
- **Memory hog / long-running markers**: a small ▲ (memory) / ⏱ (uptime) badge on the port and its project, configurable thresholds, no notifications.
- **Ports reserved by Windows**: when `EACCES` / `WinError 10013` hits a port inside a Hyper-V/WSL *excludedportrange*, you are told why and get a *How to fix* guide (*Show Ports Reserved by Windows*). Pinned ports that are reserved show a 🔒. Fix commands are never run for you.
- **Copy Port List as Markdown**: paste the current table into an issue, PR or chat.

## Requirements

- Windows 10/11, VS Code 1.93+ (also works in Cursor, Windsurf, and VSCodium via Open VSX).
- *Kill & Retry* needs terminal **shell integration** (PowerShell, pwsh, Git Bash). `cmd.exe` is not supported.

## Settings

| Setting | Default | Description |
|---|---|---|
| `whosOnMyPort.autoRefreshSeconds` | `0` | Rescan while the view is visible. `0` = on demand only |
| `whosOnMyPort.confirmBeforeKill` | `true` | Ask before stopping a process |
| `whosOnMyPort.filterDevOnly` | `true` | Hide Windows system services |
| `whosOnMyPort.customDevProcesses` | `[]` | Extra process names treated as dev processes |
| `whosOnMyPort.gracefulStop` | `true` | Ctrl+C first for processes in this window's terminals |
| `whosOnMyPort.gracefulTimeoutMs` | `3000` | Wait before force-killing |
| `whosOnMyPort.detectPortInUse` | `true` | Watch terminals for "port in use" errors |
| `whosOnMyPort.showStatusBar` | `true` | Port counter in the status bar |
| `whosOnMyPort.pinnedPorts` | `[]` | Ports always shown at the top |
| `whosOnMyPort.memoryWarningMB` | `1024` | ▲ badge when a process uses at least this much RAM. `0` = off |
| `whosOnMyPort.longRunningHours` | `8` | ⏱ badge when a process has been running this many hours. `0` = off |

Keybinding example:

```json
{ "key": "ctrl+alt+k", "command": "whosOnMyPort.killPort", "args": 3000 }
```

## How it works

One scan = `netstat -ano` and a single `Get-CimInstance Win32_Process` query, run in parallel. Each VS Code window records its terminal PIDs in a small shared file in the extension's global storage, so a port can be traced back to the exact window that started it. Nothing leaves your machine.

## Troubleshooting

- **"Scan failed — PowerShell may be blocked by policy"**: some corporate machines block PowerShell. Run *Who's On My Port: Show Logs* and open an issue with the output.

## License

MIT
