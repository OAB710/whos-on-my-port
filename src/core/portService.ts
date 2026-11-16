import * as vscode from 'vscode';
import type { ProcessProvider } from '../providers/processProvider';
import type { PortEntry } from '../types';
import { classify } from './classifier';
import { socketSignature } from './liveRefresh';
import { buildDevSet } from './safety';
import { toSortBy } from './sort';
import { WindowRegistry } from './windowRegistry';

export const CONFIG = 'whosOnMyPort';

export function cfg() {
  const c = vscode.workspace.getConfiguration(CONFIG);
  return {
    liveRefresh: c.get<boolean>('liveRefresh', false),
    liveRefreshIntervalSeconds: c.get<number>('liveRefreshIntervalSeconds', 2),
    confirmBeforeKill: c.get<boolean>('confirmBeforeKill', true),
    filterDevOnly: c.get<boolean>('filterDevOnly', true),
    customDevProcesses: c.get<string[]>('customDevProcesses', []),
    gracefulStop: c.get<boolean>('gracefulStop', true),
    gracefulTimeoutMs: c.get<number>('gracefulTimeoutMs', 3000),
    detectPortInUse: c.get<boolean>('detectPortInUse', true),
    showStatusBar: c.get<boolean>('showStatusBar', true),
    pinnedPorts: c.get<number[]>('pinnedPorts', []),
    memoryWarningMB: c.get<number>('memoryWarningMB', 1024),
    longRunningHours: c.get<number>('longRunningHours', 8),
    sortBy: toSortBy(c.get<string>('sortBy', 'port')),
    groupByProject: c.get<boolean>('groupByProject', true),
  };
}

export interface PortState {
  entries: PortEntry[];
  error?: string;
  scannedAt?: number;
  /** socketSignature() of the listeners seen by this scan (live refresh compares against it). */
  signature?: string;
}

/** Owns scanning: de-duplicates concurrent requests and broadcasts results. */
export class PortService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<PortState>();
  readonly onDidChange = this.emitter.event;
  private inflight?: Promise<PortState>;
  private _state: PortState = { entries: [] };
  terminals = new Map<number, vscode.Terminal>();

  constructor(
    readonly provider: ProcessProvider,
    private readonly registry: WindowRegistry,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  get state(): PortState {
    return this._state;
  }

  /** Starts a scan, or joins the one already running. */
  scan(): Promise<PortState> {
    this.inflight ??= this.doScan().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async doScan(): Promise<PortState> {
    try {
      const [scan, terminals, snap] = await Promise.all([
        this.provider.scan(),
        this.registry.currentTerminals(),
        this.registry.snapshot(),
      ]);
      this.terminals = terminals;
      const entries = classify(scan, {
        currentFolders: this.registry.currentFolders(),
        currentTerminalPids: new Set(terminals.keys()),
        currentTerminalCwds: WindowRegistry.cwdMap(terminals),
        otherWindows: snap.otherWindows,
        knownFolders: snap.knownFolders,
        devNames: buildDevSet(cfg().customDevProcesses),
        selfPid: process.pid,
      });
      this.log.info(`scan: ${scan.sockets.length} sockets, ${scan.procs.size} processes, ${entries.length} listeners in ${scan.durationMs} ms`);
      this._state = { entries, scannedAt: scan.at, signature: socketSignature(scan.sockets) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`scan failed: ${msg}`);
      this._state = { entries: this._state.entries, error: msg, scannedAt: Date.now() };
    }
    this.emitter.fire(this._state);
    return this._state;
  }

  async isPortBusy(port: number): Promise<boolean> {
    const sockets = await this.provider.listeningSockets();
    return sockets.some((s) => s.port === port);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
