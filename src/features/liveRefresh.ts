// Live refresh: while the Ports view is visible AND the window is focused, poll the cheap
// `netstat -ano` every few seconds and run a full scan only when the listeners changed
// (or every 30 s to refresh memory). Nothing runs otherwise (NFR-02).
import * as vscode from 'vscode';
import { decideTick, FULL_SCAN_EVERY_MS, liveIntervalMs, socketSignature } from '../core/liveRefresh';
import { cfg, CONFIG, type PortService } from '../core/portService';

export class LiveRefresh implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Bumped on stop, so a tick still in flight never schedules a second loop. */
  private generation = 0;
  private lastFullScanAt?: number;
  private lastRenderAt?: number;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: PortService,
    private readonly view: vscode.TreeView<unknown>,
    /** Re-render the tree without scanning (advances uptime text). */
    private readonly render: () => void,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      service.onDidChange((s) => {
        this.lastFullScanAt = s.scannedAt ?? Date.now();
        this.lastRenderAt = Date.now();
      }),
      view.onDidChangeVisibility(() => this.update()),
      vscode.window.onDidChangeWindowState(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${CONFIG}.liveRefresh`) || e.affectsConfiguration(`${CONFIG}.liveRefreshIntervalSeconds`)) {
          this.stop();
          this.update();
        }
      }),
    );
    this.update();
  }

  private get shouldRun(): boolean {
    return cfg().liveRefresh && this.view.visible && vscode.window.state.focused;
  }

  /** Starts or stops the loop to match visibility / focus / settings. */
  update(): void {
    if (!this.shouldRun) return this.stop();
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  private stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** setTimeout chain (not setInterval): a slow tick never overlaps the next one. */
  private schedule(): void {
    if (!this.running) return;
    const gen = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => {
        if (gen === this.generation) this.schedule();
      });
    }, liveIntervalMs(cfg().liveRefreshIntervalSeconds));
  }

  private async tick(): Promise<void> {
    if (!this.shouldRun) return this.stop();
    const now = Date.now();
    const state = this.service.state;
    // After a failed scan, don't retry the expensive scan on every tick.
    if (state.error && this.lastFullScanAt !== undefined && now - this.lastFullScanAt < FULL_SCAN_EVERY_MS) return;
    let signature: string;
    try {
      signature = socketSignature(await this.service.provider.listeningSockets());
    } catch (e) {
      this.log.warn(`live refresh: netstat failed: ${e}`);
      return;
    }
    if (!this.running || this.service.state !== state) return; // stopped, or a scan happened meanwhile
    const action = decideTick({
      now: Date.now(),
      signature,
      scannedSignature: state.signature,
      lastFullScanAt: this.lastFullScanAt,
      lastRenderAt: this.lastRenderAt,
    });
    if (action === 'scan') {
      await this.service.scan();
    } else if (action === 'render') {
      this.lastRenderAt = Date.now();
      this.render();
    }
  }

  dispose(): void {
    this.stop();
    this.disposables.forEach((d) => d.dispose());
  }
}
