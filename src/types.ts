// Shared types. Must NOT import 'vscode' (used by unit-tested modules).

/** One (port, pid) pair in LISTEN state for a single bind address. */
export interface ListeningSocket {
  port: number;
  /** Bind host without brackets, e.g. "0.0.0.0", "127.0.0.1", "::", "::1". */
  address: string;
  pid: number;
}

export interface ProcInfo {
  pid: number;
  ppid: number;
  /** Image name as reported by Windows, e.g. "node.exe". */
  name: string;
  /** Creation time as Windows FILETIME (UTC, 100ns ticks). 0 when unknown. */
  created: number;
  memBytes: number;
  /** null when we lack permission to read it (elevated / other user / protected). */
  commandLine: string | null;
  exePath: string | null;
}

export interface ScanResult {
  sockets: ListeningSocket[];
  procs: Map<number, ProcInfo>;
  /** Number of non-listening connections per "port:pid" key. */
  connections: Map<string, number>;
  at: number;
  durationMs: number;
}

export type PortGroup = 'current' | 'other' | 'orphan' | 'extension' | 'system';
export type BlockReason = 'system' | 'editor' | 'docker' | 'wsl' | 'exited';

export interface PortEntry {
  port: number;
  pid: number;
  addresses: string[];
  proc?: ProcInfo;
  parent?: ProcInfo;
  group: PortGroup;
  isDev: boolean;
  /** Folder name of the project the process seems to belong to. */
  projectName?: string;
  /** Absolute folder path of that project, when known. */
  projectPath?: string;
  /** Workspace label of the *other* VS Code window that owns this process. */
  windowLabel?: string;
  /** Shell PID of a terminal in THIS window that is an ancestor of the process. */
  terminalPid?: number;
  /** Process directly under that terminal shell (the command it runs, e.g. npm), ancestor of `pid` or `pid` itself. */
  terminalChildPid?: number;
  /** Working directory of the VS Code terminal (this or another window) that started it, if known. */
  terminalCwd?: string;
  /** Command line of the process directly under the user's shell (e.g. `node npm-cli.js run dev`). */
  launcherCommandLine?: string;
  /** Started from a terminal of a VS Code window that doesn't run this extension. */
  unregisteredWindow?: boolean;
  elevated: boolean;
  lanExposed: boolean;
  blocked?: BlockReason;
  connections: number;
}

/** Inclusive TCP port range reserved by Windows (netsh excludedportrange). */
export interface PortRange {
  start: number;
  end: number;
  /** Marked "*" by netsh: added by an administrator (persistent). */
  administered: boolean;
}

export interface KillResult {
  ok: boolean;
  /** Process still alive after the attempt (typically access denied). */
  stillAlive: boolean;
  message?: string;
}

export interface WindowInfo {
  label: string;
  folders: string[];
  terminalPids: number[];
  /** Working directory per terminal PID (keys are PIDs as strings). */
  terminalCwds?: Record<string, string>;
}
