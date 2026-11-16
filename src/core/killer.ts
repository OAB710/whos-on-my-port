// Kill workflow: safety check → confirm → graceful (Ctrl+C) → force → elevated.
import * as vscode from 'vscode';
import type { BlockReason, PortEntry } from '../types';
import { cfg, type PortService } from './portService';

const t = vscode.l10n.t;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function describe(e: PortEntry): string {
  const name = e.proc?.name ?? t('unknown');
  const project = e.projectName ? ` — ${e.projectName}` : '';
  return t('{0} (PID {1}) on port {2}{3}', name, e.pid, e.port, project);
}

export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case 'system':
      return t('This is a Windows system process and cannot be stopped from here.');
    case 'editor':
      return t('This process belongs to the editor itself. Stopping it would close VS Code.');
    case 'docker':
      return t('This port is forwarded by Docker Desktop. Stop the container instead (docker stop <container>).');
    case 'wsl':
      return t('This port is forwarded by WSL. Stop the process inside your WSL distribution instead.');
    case 'exited':
      return t('The process has already exited.');
  }
}

export interface KillOptions {
  /** Skip confirmation (caller already asked, e.g. Kill & Retry or bulk). */
  skipConfirm?: boolean;
  /** Skip the Ctrl+C attempt. */
  force?: boolean;
  /** Do not rescan afterwards (bulk callers rescan once). */
  noRefresh?: boolean;
}

export class Killer implements vscode.Disposable {
  private readonly willKill = new vscode.EventEmitter<PortEntry>();
  private readonly didKill = new vscode.EventEmitter<{ entry: PortEntry; ok: boolean }>();
  /** Fires after confirmation, right before Ctrl+C / taskkill (Port History marks the run as killed). */
  readonly onWillKill = this.willKill.event;
  readonly onDidKill = this.didKill.event;

  constructor(private readonly service: PortService, private readonly log: vscode.LogOutputChannel) {}

  dispose(): void {
    this.willKill.dispose();
    this.didKill.dispose();
  }

  async kill(e: PortEntry, opts: KillOptions = {}): Promise<boolean> {
    if (e.blocked) {
      vscode.window.setStatusBarMessage('$(shield) ' + blockMessage(e.blocked), 5000);
      return false;
    }
    const c = cfg();
    if (c.confirmBeforeKill && !opts.skipConfirm) {
      const stop = t('Stop');
      const pick = await vscode.window.showWarningMessage(t('Stop {0}?', describe(e)), { modal: true }, stop);
      if (pick !== stop) return false;
    }

    this.willKill.fire(e);
    let ok = false;
    const terminal = e.terminalPid !== undefined ? this.service.terminals.get(e.terminalPid) : undefined;
    if (!opts.force && c.gracefulStop && terminal) {
      ok = await this.graceful(e, terminal, c.gracefulTimeoutMs);
    }
    if (!ok) ok = await this.force(e);
    this.didKill.fire({ entry: e, ok });

    if (!opts.noRefresh) setTimeout(() => void this.service.scan(), 300);
    return ok;
  }

  /** Kills many entries after a single confirmation (when confirmBeforeKill is on). */
  async killMany(entries: PortEntry[], title: string, opts: Pick<KillOptions, 'force'> = {}): Promise<void> {
    const targets = entries.filter((e) => !e.blocked);
    if (targets.length === 0) return;
    if (cfg().confirmBeforeKill) {
      const list = targets.map((e) => `:${e.port} ${e.proc?.name ?? ''} (PID ${e.pid})`).join('\n');
      const stop = t('Stop {0}', targets.length);
      const pick = await vscode.window.showWarningMessage(title, { modal: true, detail: list }, stop);
      if (pick !== stop) return;
    }
    // Same PID may hold several ports: kill each process once.
    const seen = new Set<number>();
    const unique = targets.filter((e) => !seen.has(e.pid) && seen.add(e.pid));
    await Promise.all(unique.map((e) => this.kill(e, { skipConfirm: true, noRefresh: true, force: opts.force })));
    setTimeout(() => void this.service.scan(), 300);
  }

  private async graceful(e: PortEntry, terminal: vscode.Terminal, timeoutMs: number): Promise<boolean> {
    this.log.info(`graceful stop: Ctrl+C → terminal "${terminal.name}" for :${e.port} PID ${e.pid}`);
    terminal.sendText('\x03', false);
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await delay(300);
      try {
        if (!(await this.service.isPortBusy(e.port))) return true;
      } catch {
        break;
      }
    }
    this.log.info(`graceful stop timed out for PID ${e.pid}; forcing`);
    return false;
  }

  private async force(e: PortEntry): Promise<boolean> {
    const r = await this.service.provider.kill(e.pid);
    this.log.info(`taskkill PID ${e.pid}: ok=${r.ok} ${r.message ?? ''}`);
    if (r.ok) return true;
    if (!r.stillAlive) return true;

    const admin = t('Kill as Administrator');
    const pick = await vscode.window.showWarningMessage(
      t('Access denied while stopping {0}. It is probably running as Administrator.', describe(e)),
      admin,
    );
    if (pick !== admin) return false;
    const r2 = await this.service.provider.killElevated(e.pid);
    this.log.info(`elevated taskkill PID ${e.pid}: ok=${r2.ok} ${r2.message ?? ''}`);
    if (!r2.ok) vscode.window.setStatusBarMessage('$(info) ' + t('The process is still running (elevation cancelled or denied).'), 4000);
    return r2.ok;
  }
}
