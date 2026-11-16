import * as vscode from 'vscode';
import { Killer } from './core/killer';
import { cfg, CONFIG, PortService } from './core/portService';
import { WindowRegistry } from './core/windowRegistry';
import { CommandTracker } from './features/commandTracker';
import { registerCommands } from './features/commands';
import { PortInUseDetector } from './features/portInUseDetector';
import { reservedRanges } from './features/reservedPorts';
import { restartCommand } from './features/restart';
import { PortStatusBar } from './features/statusBar';
import { createProvider } from './providers/processProvider';
import { PortTreeProvider } from './views/portTreeProvider';
import { WarningDecorationProvider } from './views/warningDecorations';

let registry: WindowRegistry | undefined;

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Who's On My Port", { log: true });
  ctx.subscriptions.push(log);

  const provider = await createProvider();
  if (!provider) {
    // macOS / Linux in v1.0: show the welcome message instead of a tree.
    await vscode.commands.executeCommand('setContext', 'whosOnMyPort.unsupported', true);
    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider('whosOnMyPort.ports', { getChildren: () => [], getTreeItem: (x: vscode.TreeItem) => x }),
    );
    return;
  }

  registry = new WindowRegistry(ctx.globalStorageUri, log);
  const service = new PortService(provider, registry, log);
  const killer = new Killer(service, log);
  const tracker = new CommandTracker();
  const tree = new PortTreeProvider(
    service,
    ctx.extensionUri,
    (e) => restartCommand(e, service, tracker),
    () => reservedRanges(service),
  );
  const view = vscode.window.createTreeView('whosOnMyPort.ports', { treeDataProvider: tree, showCollapseAll: true });
  const decorations = new WarningDecorationProvider(service, () => tree.projects());
  const statusBar = new PortStatusBar(service);
  // Activity Bar badge = ports of this workspace.
  ctx.subscriptions.push(
    service.onDidChange((s) => {
      const n = s.entries.filter((e) => e.group === 'current').length;
      view.badge = n ? { value: n, tooltip: vscode.l10n.t('{0} port(s) in this workspace', n) } : undefined;
    }),
  );
  ctx.subscriptions.push(registry, service, view, decorations, statusBar, tracker, new PortInUseDetector(service, killer, tracker, log));
  // A new command in a terminal can make its server restartable: re-render (no rescan).
  ctx.subscriptions.push(tracker.onDidStart(() => tree.refreshView()));

  const setDevFilter = async (on: boolean) => {
    await vscode.commands.executeCommand('setContext', 'whosOnMyPort.devFilter', on);
    await vscode.workspace.getConfiguration(CONFIG).update('filterDevOnly', on, vscode.ConfigurationTarget.Global);
  };
  await vscode.commands.executeCommand('setContext', 'whosOnMyPort.devFilter', cfg().filterDevOnly);
  registerCommands(ctx, service, killer, log, setDevFilter, tree, tracker);

  // --- Scan scheduling: nothing runs while idle (NFR-02). ---
  let timer: NodeJS.Timeout | undefined;
  const restartTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    const secs = cfg().autoRefreshSeconds;
    if (view.visible && secs > 0) timer = setInterval(() => void service.scan(), secs * 1000);
  };
  ctx.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  ctx.subscriptions.push(
    view.onDidChangeVisibility(() => {
      if (view.visible) void service.scan();
      restartTimer();
    }),
  );

  let debounce: NodeJS.Timeout | undefined;
  const scanSoon = () => {
    if (!view.visible && !cfg().showStatusBar) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void service.scan(), 2000);
  };
  ctx.subscriptions.push(
    vscode.window.onDidOpenTerminal(scanSoon),
    vscode.window.onDidCloseTerminal(scanSoon),
    { dispose: () => debounce && clearTimeout(debounce) },
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(CONFIG)) return;
      if (e.affectsConfiguration(`${CONFIG}.autoRefreshSeconds`)) restartTimer();
      if (e.affectsConfiguration(`${CONFIG}.showStatusBar`)) statusBar.applyVisibility();
      if (e.affectsConfiguration(`${CONFIG}.filterDevOnly`)) {
        void vscode.commands.executeCommand('setContext', 'whosOnMyPort.devFilter', cfg().filterDevOnly);
      }
      if (e.affectsConfiguration(`${CONFIG}.customDevProcesses`)) void service.scan();
      else {
        tree.refreshView();
        decorations.update();
      }
    }),
  );

  void registry.publish();
  if (cfg().showStatusBar || view.visible) {
    const startup = setTimeout(() => void service.scan(), 3000);
    ctx.subscriptions.push({ dispose: () => clearTimeout(startup) });
  }
}

export async function deactivate(): Promise<void> {
  await registry?.unregister();
}
