// Restart a dev server: stop it (Ctrl+C → force) and re-run the last command of its terminal.
import * as vscode from 'vscode';
import { describe, type Killer } from '../core/killer';
import { cfg, type PortService } from '../core/portService';
import type { PortEntry } from '../types';
import type { CommandTracker, TrackedCommand } from './commandTracker';

const t = vscode.l10n.t;
const STATUS_MS = 2500;

/** The command that Restart would re-run for this entry, if any. */
export function restartCommand(e: PortEntry, service: PortService, tracker: CommandTracker): TrackedCommand | undefined {
  if (e.blocked || e.terminalPid === undefined) return undefined;
  const last = tracker.lastCommand(service.terminals.get(e.terminalPid));
  // Only the command that is STILL running can be the one holding the port. If it already
  // ended (server went to the background and another command ran since), we don't know
  // which command started the server, so no Restart.
  if (!last || tracker.isEnded(last.execution)) return undefined;
  return last;
}

export async function restartEntry(
  e: PortEntry,
  service: PortService,
  killer: Killer,
  tracker: CommandTracker,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const terminal = e.terminalPid !== undefined ? service.terminals.get(e.terminalPid) : undefined;
  const cmd = restartCommand(e, service, tracker);
  if (!terminal || !cmd) {
    vscode.window.setStatusBarMessage(`$(warning) ${t('Cannot restart :{0} — its command is unknown.', e.port)}`, STATUS_MS);
    return;
  }

  if (cfg().confirmBeforeKill) {
    const restart = t('Restart');
    const pick = await vscode.window.showWarningMessage(
      t('Restart {0}?', describe(e)),
      { modal: true, detail: t('Runs again in its terminal: {0}', cmd.commandLine) },
      restart,
    );
    if (pick !== restart) return;
  }

  const status = vscode.window.setStatusBarMessage(`$(sync~spin) ${t('Restarting :{0}…', e.port)}`);
  try {
    log.info(`restart :${e.port} PID ${e.pid}: "${cmd.commandLine}" (cwd ${cmd.cwd ?? '?'})`);
    const ok = await killer.kill(e, { skipConfirm: true, noRefresh: true });
    if (!ok) {
      vscode.window.setStatusBarMessage(`$(error) ${t('Could not stop :{0}; not restarted.', e.port)}`, STATUS_MS);
      return;
    }

    // The shell must be back at its prompt before we can run the command again.
    let ended = await tracker.waitForEnd(cmd.execution, 5000);
    if (!ended && e.terminalChildPid !== undefined) {
      // E.g. "npm run dev" wrapper still alive after its node child died.
      log.info(`restart: command still running after 5 s; force-killing PID ${e.terminalChildPid}`);
      await service.provider.kill(e.terminalChildPid);
      ended = await tracker.waitForEnd(cmd.execution, 2000);
    }
    if (!ended) {
      vscode.window.setStatusBarMessage(`$(warning) ${t('Stopped :{0}, but the terminal is still busy; not restarted.', e.port)}`, 4000);
      return;
    }
    if (!terminal.shellIntegration) {
      vscode.window.setStatusBarMessage(`$(warning) ${t('Stopped :{0}; shell integration is unavailable, so it was not restarted.', e.port)}`, 4000);
      return;
    }
    terminal.shellIntegration.executeCommand(cmd.commandLine);
    vscode.window.setStatusBarMessage(`$(debug-restart) ${t('Restarted :{0} — {1}', e.port, cmd.commandLine)}`, STATUS_MS);
  } finally {
    status.dispose();
    setTimeout(() => void service.scan(), 4000);
  }
}
