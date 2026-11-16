import * as vscode from 'vscode';
import type { Killer } from '../core/killer';
import { cfg, CONFIG, type PortService } from '../core/portService';
import { toMarkdownTable } from '../core/markdownReport';
import { formatMb } from '../core/runtime';
import type { PortEntry } from '../types';
import type { Node, PortTreeProvider } from '../views/portTreeProvider';
import type { CommandTracker } from './commandTracker';
import { copyLanUrl, showQrCode } from './lan';
import { reservedMessage, reservedRangeOf, showReservedPortsDocument } from './reservedPorts';
import { restartEntry } from './restart';

const t = vscode.l10n.t;

function entryOf(node?: Node): PortEntry | undefined {
  return node?.kind === 'port' ? node.entry : undefined;
}

function portOf(node?: Node): number | undefined {
  if (node?.kind === 'port') return node.entry.port;
  if (node?.kind === 'freePinned') return node.port;
  return undefined;
}

async function setPinned(ports: number[]): Promise<void> {
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const unique = [...new Set(ports)].sort((a, b) => a - b);
  await vscode.workspace.getConfiguration(CONFIG).update('pinnedPorts', unique, target);
}

function parsePort(s: string | undefined): number | undefined {
  const n = Number(s?.trim().replace(/^:/, ''));
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}

const GROUP_RANK = { current: 0, orphan: 1, other: 2, extension: 3, system: 4 } as const;

export function registerCommands(
  ctx: vscode.ExtensionContext,
  service: PortService,
  killer: Killer,
  log: vscode.LogOutputChannel,
  setDevFilter: (on: boolean) => Promise<void>,
  tree: PortTreeProvider,
  tracker: CommandTracker,
): void {
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(`whosOnMyPort.${id}`, fn));

  reg('refresh', () => service.scan());
  reg('showLogs', () => log.show());
  reg('filterOn', () => setDevFilter(true));
  reg('filterOff', () => setDevFilter(false));

  reg('kill', (n?: Node) => {
    const e = entryOf(n);
    if (e) return killer.kill(e);
  });
  reg('killProject', (n?: Node) => {
    if (n?.kind === 'project') return killer.killMany(n.entries, t('Stop all processes of {0}?', n.name));
  });
  reg('restart', (n?: Node) => {
    const e = entryOf(n);
    if (e) return restartEntry(e, service, killer, tracker, log);
  });
  reg('forceKill', (n?: Node) => {
    const e = entryOf(n);
    if (e) return killer.kill(e, { force: true });
  });

  reg('openBrowser', (n?: Node) => {
    const port = portOf(n);
    if (port) return vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
  });
  reg('copyUrl', async (n?: Node) => {
    const port = portOf(n);
    if (!port) return;
    const url = `http://localhost:${port}`;
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(`$(check) ${t('Copied {0}', url)}`, 2500);
  });

  reg('revealTerminal', (n?: Node) => {
    const e = entryOf(n);
    const term = e?.terminalPid !== undefined ? service.terminals.get(e.terminalPid) : undefined;
    if (term) term.show();
    else void vscode.window.showInformationMessage(t('The terminal is no longer open.'));
  });

  reg('copyAsMarkdown', async () => {
    if (!service.state.scannedAt) await service.scan();
    // Same entries as the tree shows (respects the dev filter), one row per port/PID.
    const seen = new Set<string>();
    const entries = tree
      .projects()
      .flatMap((p) => p.entries)
      .filter((e) => !seen.has(`${e.port}:${e.pid}`) && !!seen.add(`${e.port}:${e.pid}`))
      .sort((a, b) => a.port - b.port || a.pid - b.pid);
    const md = toMarkdownTable(entries, {
      headers: [t('Port'), t('Process'), 'PID', t('Project'), t('Memory'), t('Uptime'), t('Bound to'), t('Window')],
      thisWindow: t('this window'),
      otherWindow: t('another VS Code window'),
    });
    await vscode.env.clipboard.writeText(md);
    vscode.window.setStatusBarMessage(`$(check) ${t('Copied {0} port(s) as Markdown', entries.length)}`, 2500);
  });

  reg('copyLanUrl', (n?: Node) => {
    const e = entryOf(n);
    if (e) return copyLanUrl(e);
  });
  reg('showQrCode', (n?: Node) => {
    const e = entryOf(n);
    if (e) return showQrCode(e, ctx.globalStorageUri);
  });

  reg('showReservedPorts', (arg?: number | Node) => {
    const port = typeof arg === 'number' ? arg : portOf(arg);
    return showReservedPortsDocument(service, port);
  });

  reg('copyPid', (n?: Node) => {
    const e = entryOf(n);
    if (e) return vscode.env.clipboard.writeText(String(e.pid));
  });
  reg('copyCommandLine', (n?: Node) => {
    const e = entryOf(n);
    if (!e) return;
    if (e.proc?.commandLine) return vscode.env.clipboard.writeText(e.proc.commandLine);
    void vscode.window.showInformationMessage(t('Command line is not available (process runs with higher privileges).'));
  });
  reg('openProjectFolder', (n?: Node) => {
    const folder = n?.kind === 'project' ? n.path : entryOf(n)?.projectPath;
    if (folder) return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true });
  });

  reg('pin', (n?: Node) => {
    const port = portOf(n);
    if (port) return setPinned([...cfg().pinnedPorts, port]);
  });
  reg('unpin', (n?: Node) => {
    const port = portOf(n);
    if (port) return setPinned(cfg().pinnedPorts.filter((p) => p !== port));
  });
  reg('pinPort', async () => {
    const value = await vscode.window.showInputBox({
      title: t('Pin Port'),
      prompt: t('Port number to always show at the top'),
      validateInput: (v) => (parsePort(v) ? undefined : t('Enter a number between 1 and 65535')),
    });
    const port = parsePort(value);
    if (port) await setPinned([...cfg().pinnedPorts, port]);
  });

  reg('killAllInWorkspace', async () => {
    const { entries } = await service.scan();
    const list = entries.filter((e) => e.group === 'current');
    if (list.length === 0) {
      void vscode.window.showInformationMessage(t('No ports in this workspace.'));
      return;
    }
    await killer.killMany(list, t('Stop all {0} process(es) using ports in this workspace?', list.length));
  });

  reg('cleanOrphans', async () => {
    const { entries } = await service.scan();
    const list = entries.filter((e) => e.group === 'orphan');
    if (list.length === 0) {
      void vscode.window.showInformationMessage(t('No orphaned processes found.'));
      return;
    }
    await killer.killMany(list, t('Stop {0} orphaned process(es)?', list.length));
  });

  reg('killPort', async (arg?: number | string) => {
    const direct = parsePort(arg === undefined ? undefined : String(arg));
    if (direct) return killByPort(direct, service, killer);

    type Item = vscode.QuickPickItem & { entry?: PortEntry };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = t('Kill Port');
    qp.placeholder = t('Type a port number or pick a process');
    qp.busy = true;
    qp.matchOnDescription = true;
    qp.show();

    const toItem = (e: PortEntry): Item => ({
      label: `:${e.port}`,
      description: `${e.proc?.name ?? '?'} • PID ${e.pid}${e.projectName ? ` • ${e.projectName}` : ''}`,
      detail: e.blocked ? `🛡 ${t('Protected')}` : e.proc ? formatMb(e.proc.memBytes) : undefined,
      entry: e,
    });
    const devOnly = cfg().filterDevOnly;
    service.scan().then((s) => {
      qp.items = s.entries
        .filter((e) => !devOnly || (e.group !== 'system' && e.group !== 'extension'))
        .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.port - b.port)
        .map(toItem);
      qp.busy = false;
    });

    const picked = await new Promise<Item | number | undefined>((resolve) => {
      qp.onDidAccept(() => resolve(qp.selectedItems[0] ?? parsePort(qp.value)));
      qp.onDidHide(() => resolve(undefined));
    });
    qp.dispose();
    if (typeof picked === 'number') return killByPort(picked, service, killer);
    if (picked?.entry) return killer.kill(picked.entry);
  });
}

async function killByPort(port: number, service: PortService, killer: Killer): Promise<void> {
  const { entries } = await service.scan();
  const holders = entries.filter((e) => e.port === port);
  if (holders.length === 0) {
    const range = await reservedRangeOf(service, port);
    if (range) {
      // Nothing to kill: the port is blocked by a Windows reservation, not by a process.
      vscode.window.setStatusBarMessage(`$(lock) ${reservedMessage(port, range)} — ${t('run "Show Ports Reserved by Windows" for fixes')}`, 6000);
      return;
    }
    void vscode.window.showInformationMessage(t('Port {0} is free.', port));
    return;
  }
  for (const h of holders) await killer.kill(h);
}
