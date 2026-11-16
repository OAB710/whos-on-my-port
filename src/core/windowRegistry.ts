// Shares "which folders and terminals does each VS Code window own" between windows
// through a JSON file in globalStorage (same for every window of a profile).
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isAlive } from '../providers/processProvider';
import type { WindowInfo } from '../types';

interface WindowRecord extends WindowInfo {
  hostPid: number;
  updatedAt: number;
}

interface RegistryFile {
  version: 1;
  windows: Record<string, WindowRecord>;
  knownFolders: string[];
}

const MAX_KNOWN_FOLDERS = 100;

export class WindowRegistry implements vscode.Disposable {
  private readonly file: string;
  private readonly id = vscode.env.sessionId;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(storageUri: vscode.Uri, private readonly log: vscode.LogOutputChannel) {
    this.file = path.join(storageUri.fsPath, 'windows.json');
    const update = () => this.publish();
    this.disposables.push(
      vscode.window.onDidOpenTerminal(update),
      vscode.window.onDidCloseTerminal(update),
      vscode.workspace.onDidChangeWorkspaceFolders(update),
    );
  }

  /** Terminal shell PIDs of THIS window. */
  async currentTerminals(): Promise<Map<number, vscode.Terminal>> {
    const map = new Map<number, vscode.Terminal>();
    await Promise.all(
      vscode.window.terminals.map(async (t) => {
        const pid = await t.processId;
        if (pid) map.set(pid, t);
      }),
    );
    return map;
  }

  /** Current working directory of a terminal (follows `cd` when shell integration is active). */
  static cwdOf(t: vscode.Terminal): string | undefined {
    const live = t.shellIntegration?.cwd;
    if (live?.scheme === 'file') return live.fsPath;
    const initial = (t.creationOptions as vscode.TerminalOptions).cwd;
    if (typeof initial === 'string') return initial;
    if (initial?.scheme === 'file') return initial.fsPath;
    return undefined;
  }

  static cwdMap(terminals: Map<number, vscode.Terminal>): Map<number, string> {
    const out = new Map<number, string>();
    for (const [pid, t] of terminals) {
      const cwd = WindowRegistry.cwdOf(t);
      if (cwd) out.set(pid, cwd);
    }
    return out;
  }

  currentFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  }

  /** Writes this window's record. Serialized to avoid self-races. */
  publish(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.doPublish()).catch((e) => this.log.warn(`registry write failed: ${e}`));
    return this.writeChain;
  }

  async read(): Promise<RegistryFile> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as RegistryFile;
      if (data.version === 1 && data.windows) return data;
    } catch {
      /* missing or corrupt: start fresh */
    }
    return { version: 1, windows: {}, knownFolders: [] };
  }

  /** Other live windows + all known folders. */
  async snapshot(): Promise<{ otherWindows: WindowInfo[]; knownFolders: string[] }> {
    const data = await this.read();
    const otherWindows = Object.entries(data.windows)
      .filter(([id, w]) => id !== this.id && isAlive(w.hostPid))
      .map(([, w]) => ({ label: w.label, folders: w.folders, terminalPids: w.terminalPids, terminalCwds: w.terminalCwds }));
    return { otherWindows, knownFolders: data.knownFolders };
  }

  private async doPublish(): Promise<void> {
    const terminals = await this.currentTerminals();
    const folders = this.currentFolders();
    const data = await this.read();

    for (const [id, w] of Object.entries(data.windows)) {
      if (!isAlive(w.hostPid)) delete data.windows[id];
    }
    data.windows[this.id] = {
      hostPid: process.pid,
      label: vscode.workspace.name ?? (folders[0] ? path.basename(folders[0]) : 'untitled'),
      folders,
      terminalPids: [...terminals.keys()],
      terminalCwds: Object.fromEntries([...WindowRegistry.cwdMap(terminals)].map(([pid, cwd]) => [String(pid), cwd])),
      updatedAt: Date.now(),
    };
    const lower = new Set(folders.map((f) => f.toLowerCase()));
    data.knownFolders = [...folders, ...data.knownFolders.filter((f) => !lower.has(f.toLowerCase()))].slice(0, MAX_KNOWN_FOLDERS);
    await this.write(data);
  }

  private async write(data: RegistryFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /** Removes this window's record (keeps knownFolders for orphan detection). */
  async unregister(): Promise<void> {
    try {
      const data = await this.read();
      delete data.windows[this.id];
      await this.write(data);
    } catch {
      /* best effort on shutdown */
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
