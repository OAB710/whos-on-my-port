import * as vscode from 'vscode';
import type { Killer } from '../core/killer';
import { cfg, CONFIG, type PortService } from '../core/portService';
import { toMarkdownTable } from '../core/markdownReport';
import { formatMb } from '../core/runtime';
import { entriesOf, portsOf, resolveTargets } from '../core/selection';
import { SORT_KEYS } from '../core/sort';
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

/**
 * Pins live in USER settings, unless the user already set a per-project override
 * (workspace / folder value) — then that level is updated, otherwise it would mask the change.
 */
async function setPinned(ports: number[]): Promise<void> {
  const c = vscode.workspace.getConfiguration(CONFIG);
  const info = c.inspect<number[]>('pinnedPorts');
  // cfg() reads without a resource scope, so folder-level values (multi-root) never apply;
  // in a single-folder window the folder settings ARE the workspace settings.
  const target = info?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const unique = [...new Set(ports)].sort((a, b) => a - b);
  await c.update('pinnedPorts', unique, target);
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
  view: vscode.TreeView<Node>,
): void {
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(`whosOnMyPort.${id}`, fn));
  /** Clicked node, or the whole multi-selection it belongs to, or the view selection (keybindings). */
  const targets = (clicked?: Node, selected?: readonly Node[]) => resolveTargets(clicked, selected, view.selection);

  /** Kill / Force Kill for one or many selected nodes (ports + whole projects). */
  const killTargets = (nodes: Node[], force: boolean) => {
    const entries = entriesOf(nodes);
    if (entries.length === 0) return;
    const single = nodes.length === 1 && nodes[0].kind === 'port';
    if (single) return killer.kill(entries[0], { force });
    const project = nodes.length === 1 && nodes[0].kind === 'project' ? nodes[0] : undefined;
    const title = project
      ? t('Stop all processes of {0}?', project.name)
      : t('Stop {0} selected process(es)?', entries.filter((e) => !e.blocked).length);
    if (entries.every((e) => e.blocked)) {
      vscode.window.setStatusBarMessage(`$(shield) ${t('Nothing to stop: the selected processes are protected.')}`, 2500);
      return;
    }
    return killer.killMany(entries, title, { force });
  };

  reg('refresh', () => service.scan());

  // View options (overflow menu). "…Checked" twins only differ by their ✓ title (menus can't show a toggle state).
  const setView = (key: 'sortBy' | 'groupByProject' | 'liveRefresh', value: unknown) =>
    vscode.workspace.getConfiguration(CONFIG).update(key, value, vscode.ConfigurationTarget.Global);
  for (const key of SORT_KEYS) {
    const id = `sortBy${key[0].toUpperCase()}${key.slice(1)}`;
    reg(id, () => setView('sortBy', key));
    reg(`${id}Checked`, () => setView('sortBy', key));
  }
  reg('groupByProjectOn', () => setView('groupByProject', true));
  reg('groupByProjectOff', () => setView('groupByProject', false));
  reg('liveRefreshOn', () => setView('liveRefresh', true));
  reg('liveRefreshOff', () => setView('liveRefresh', false));
  reg('showLogs', () => log.show());
  reg('filterOn', () => setDevFilter(true));
  reg('filterOff', () => setDevFilter(false));

  reg('kill', (n?: Node, sel?: Node[]) => killTargets(targets(n, sel), false));
  reg('killProject', (n?: Node, sel?: Node[]) => killTargets(targets(n, sel), false));
  reg('restart', (n?: Node) => {
    const e = entryOf(n);
    if (e) return restartEntry(e, service, killer, tracker, log);
  });
  reg('forceKill', (n?: Node, sel?: Node[]) => killTargets(targets(n, sel), true));

  reg('openBrowser', async (n?: Node, sel?: Node[]) => {
    const nodes = targets(n, sel);
    const ports = portsOf(nodes);
    if (ports.length === 0) {
      // Enter on a project / message row (keybinding): keep the default Enter behaviour (expand, run item command).
      if (!n && nodes.length) await vscode.commands.executeCommand('list.select');
      return;
    }
    for (const port of ports) await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
  });
  reg('copyUrl', async (n?: Node, sel?: Node[]) => {
    const urls = portsOf(targets(n, sel)).map((port) => `http://localhost:${port}`);
    if (urls.length === 0) return;
    await vscode.env.clipboard.writeText(urls.join('\n'));
    const msg = urls.length === 1 ? t('Copied {0}', urls[0]) : t('Copied {0} URLs', urls.length);
    vscode.window.setStatusBarMessage(`$(check) ${msg}`, 2500);
  });

  reg('revealTerminal', (n?: Node) => {
    const e = entryOf(n);
    const term = e?.terminalPid !== undefined ? service.terminals.get(e.terminalPid) : undefined;
    if (term) term.show();
    else vscode.window.setStatusBarMessage('$(info) ' + t('The terminal is no longer open.'), 4000);
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
    vscode.window.setStatusBarMessage('$(info) ' + t('Command line is not available (process runs with higher privileges).'), 4000);
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
      vscode.window.setStatusBarMessage('$(info) ' + t('No ports in this workspace.'), 4000);
      return;
    }
    await killer.killMany(list, t('Stop all {0} process(es) using ports in this workspace?', list.length));
  });

  reg('cleanOrphans', async () => {
    const { entries } = await service.scan();
    const list = entries.filter((e) => e.group === 'orphan');
    if (list.length === 0) {
      vscode.window.setStatusBarMessage('$(info) ' + t('No orphaned processes found.'), 4000);
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
    vscode.window.setStatusBarMessage('$(info) ' + t('Port {0} is free.', port), 4000);
    return;
  }
  for (const h of holders) await killer.kill(h);
}
