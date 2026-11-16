// Watches terminal command output (Shell Integration API, VS Code >= 1.93) for
// "port already in use" errors and offers Kill & Retry.
import * as vscode from 'vscode';
import { blockMessage, describe, type Killer } from '../core/killer';
import { cfg, type PortService } from '../core/portService';
import type { CommandTracker } from './commandTracker';
import { findPortErrors, type PortErrorKind } from './portInUsePatterns';
import { reservedMessage, reservedRangeOf, showReservedPortsDocument } from './reservedPorts';

const t = vscode.l10n.t;
const MAX_SCAN_CHARS = 256 * 1024;

export class PortInUseDetector implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: PortService,
    private readonly killer: Killer,
    private readonly tracker: CommandTracker,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      tracker.onDidStart((e) => {
        if (cfg().detectPortInUse) void this.watch(e);
      }),
    );
  }

  private async watch(e: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    const notified = new Set<number>();
    let pending = '';
    let total = 0;
    try {
      for await (const chunk of e.execution.read()) {
        total += chunk.length;
        if (total > MAX_SCAN_CHARS) break; // long-running server: stop reading after startup output
        const text = pending + chunk;
        const cut = text.lastIndexOf('\n');
        pending = cut >= 0 ? text.slice(cut + 1) : text;
        const complete = cut >= 0 ? text.slice(0, cut) : '';
        for (const { port, kind } of findPortErrors(complete)) {
          if (notified.has(port)) continue;
          notified.add(port);
          void this.offer(port, kind, e);
        }
      }
      for (const { port, kind } of findPortErrors(pending)) if (!notified.has(port)) void this.offer(port, kind, e);
    } catch (err) {
      this.log.warn(`terminal read failed: ${err}`);
    }
  }

  private async offer(port: number, kind: PortErrorKind, e: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    this.log.info(`detected ${kind === 'denied' ? 'permission error' : 'busy port'} ${port} in terminal "${e.terminal.name}"`);
    const state = await this.service.scan();
    const holder = state.entries.find((x) => x.port === port);

    // Nobody listens (or EACCES): maybe the port sits in a range Windows reserved for Hyper-V/WSL.
    if (kind === 'denied' || !holder) {
      const range = await reservedRangeOf(this.service, port);
      if (range) {
        this.log.info(`port ${port} is inside reserved range ${range.start}-${range.end}`);
        const fix = t('How to fix');
        const pick = await vscode.window.showWarningMessage(reservedMessage(port, range), fix);
        if (pick === fix) await showReservedPortsDocument(this.service, port);
        return;
      }
    }
    if (!holder) return; // already freed

    if (holder.blocked) {
      vscode.window.setStatusBarMessage('$(shield) ' + t('Port {0} is in use. {1}', port, blockMessage(holder.blocked)), 5000);
      return;
    }

    const retry = t('Kill & Retry');
    const kill = t('Kill');
    const show = t('Show');
    const command = e.execution.commandLine.value;
    const canRetry = !!command && !!e.terminal.shellIntegration;
    const actions = canRetry ? [retry, kill, show] : [kill, show];
    const pick = await vscode.window.showWarningMessage(t('Port {0} is used by {1}.', port, describe(holder)), ...actions);

    if (pick === show) {
      await vscode.commands.executeCommand('whosOnMyPort.ports.focus');
      return;
    }
    if (pick !== retry && pick !== kill) return;

    const ok = await this.killer.kill(holder, { skipConfirm: true, force: holder.terminalPid === undefined });
    if (!ok || pick !== retry) return;

    // Wait for the failed command to finish before re-running it.
    if (!(await this.tracker.waitForEnd(e.execution, 5000))) {
      vscode.window.setStatusBarMessage('$(info) ' + t('Port {0} is free. The previous command is still running, so it was not restarted.', port), 4000);
      return;
    }
    e.terminal.show(true);
    e.terminal.shellIntegration?.executeCommand(command);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
