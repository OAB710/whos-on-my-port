import * as vscode from 'vscode';
import { blockMessage } from '../core/killer';
import { normalizePath } from '../core/pathUtils';
import { cfg, type PortService, type PortState } from '../core/portService';
import { formatMb, formatUptime, iconKey, ICONS_WITH_LIGHT } from '../core/runtime';
import { entryWarnings } from '../core/warnings';
import type { PortEntry } from '../types';
import type { TrackedCommand } from '../features/commandTracker';
import { entryLanUrls } from '../features/lan';
import { formatRange, isReserved } from '../core/reservedPorts';
import type { PortRange } from '../types';
import { portUri, projectUri, thresholds, warningLines } from './warningDecorations';

const t = vscode.l10n.t;

type ProjectKind = 'current' | 'other' | 'background';

/**
 * Two levels only:
 *   Level 1 — project groups (current workspace folders, other projects, Background / Unassigned)
 *   Level 2 — port leaves
 * A "Pinned" group is added at the top only when the user has pinned ports.
 */
export type Node =
  | { kind: 'project'; projectKind: ProjectKind; key: string; name: string; path?: string; entries: PortEntry[] }
  | { kind: 'pinned'; ports: number[] }
  | { kind: 'port'; entry: PortEntry; pinned: boolean; parentKey: string }
  | { kind: 'freePinned'; port: number }
  | { kind: 'message'; text: string; icon: string; command?: vscode.Command };

type ProjectNode = Extract<Node, { kind: 'project' }>;

/** Groups that never belong to a project. */
const NOISE = new Set(['system', 'extension']);

export { formatMb };

function shortName(e: PortEntry): string {
  return (e.proc?.name ?? t('(exited)')).replace(/\.exe$/i, '');
}

function isInside(path: string, folder: string): boolean {
  const p = normalizePath(path);
  const f = normalizePath(folder);
  return p === f || p.startsWith(f + '\\');
}

export class PortTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private state: PortState = { entries: [] };
  private loaded = false;
  /** Number of level-1 project groups in the last render (Background collapses when others exist). */
  private projectCount = 0;
  /** Windows-reserved ranges, fetched only while a pinned port is free. */
  private reserved: PortRange[] = [];
  private reservedKey = '';

  constructor(
    service: PortService,
    private readonly extensionUri: vscode.Uri,
    /** Command that Restart would re-run for an entry (undefined = not restartable). */
    private readonly restartCommand: (e: PortEntry) => TrackedCommand | undefined = () => undefined,
    /** Lazily fetches Windows-reserved port ranges (cached by the provider). */
    private readonly fetchReserved: () => Promise<PortRange[]> = async () => [],
  ) {
    service.onDidChange((s) => {
      this.state = s;
      this.loaded = true;
      this.emitter.fire(undefined);
    });
  }

  refreshView(): void {
    this.emitter.fire(undefined);
  }

  // ---------- structure ----------

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots();
    const pinned = new Set(cfg().pinnedPorts);
    if (node.kind === 'project') {
      return node.entries.map((entry) => ({ kind: 'port', entry, pinned: pinned.has(entry.port), parentKey: node.key }));
    }
    if (node.kind === 'pinned') {
      if (node.ports.some((port) => !this.state.entries.some((e) => e.port === port))) this.refreshReserved();
      return node.ports.flatMap<Node>((port) => {
        const holders = this.state.entries.filter((e) => e.port === port);
        return holders.length
          ? holders.map((entry) => ({ kind: 'port', entry, pinned: true, parentKey: 'pinned' }))
          : [{ kind: 'freePinned', port }];
      });
    }
    return [];
  }

  /** Re-renders when the reserved ranges change (fetch is cached ~60 s by the provider, no polling). */
  private refreshReserved(): void {
    void this.fetchReserved().then((ranges) => {
      const key = ranges.map((r) => `${r.start}-${r.end}`).join(',');
      if (key === this.reservedKey) return;
      this.reserved = ranges;
      this.reservedKey = key;
      this.emitter.fire(undefined);
    }, () => undefined);
  }

  /** Builds the level-1 project groups. Exported shape is used by commands. */
  projects(): ProjectNode[] {
    const devOnly = cfg().filterDevOnly;
    const entries = this.state.entries.filter((e) => !devOnly || !NOISE.has(e.group));
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');

    // 1. Current workspace folders (used for matching; empty ones are dropped below).
    const current: ProjectNode[] = folders.map((f) => ({
      kind: 'project', projectKind: 'current', key: `current:${f.uri.fsPath}`, name: f.name, path: f.uri.fsPath, entries: [],
    }));
    const others = new Map<string, ProjectNode>();
    const background: ProjectNode = { kind: 'project', projectKind: 'background', key: 'background', name: t('Background / Unassigned'), entries: [] };

    for (const e of entries) {
      if (NOISE.has(e.group)) {
        background.entries.push(e);
        continue;
      }
      // Longest matching workspace folder wins (nested folders in multi-root).
      const folder = e.projectPath
        ? current.filter((c) => isInside(e.projectPath!, c.path!)).sort((a, b) => b.path!.length - a.path!.length)[0]
        : undefined;
      if (folder) {
        folder.entries.push(e);
      } else if (e.group === 'current' && current.length === 1 && !e.projectName) {
        current[0].entries.push(e); // running in this window but no better hint
      } else if (e.projectName) {
        const key = `other:${e.projectPath ? normalizePath(e.projectPath) : e.projectName.toLowerCase()}`;
        let p = others.get(key);
        if (!p) {
          p = { kind: 'project', projectKind: e.group === 'current' ? 'current' : 'other', key, name: e.projectName, path: e.projectPath, entries: [] };
          others.set(key, p);
        }
        p.entries.push(e);
      } else {
        background.entries.push(e);
      }
    }

    const sorted = [...others.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Projects running from this window's terminals but outside its folders stay near the top.
    // Only projects that actually hold a port are shown.
    const out = [
      ...current.filter((p) => p.entries.length > 0),
      ...sorted.filter((p) => p.projectKind === 'current'),
      ...sorted.filter((p) => p.projectKind !== 'current'),
    ];
    if (background.entries.length) out.push(background);
    return out;
  }

  private roots(): Node[] {
    if (!this.loaded) return [{ kind: 'message', text: t('Scanning…'), icon: 'loading~spin' }];
    const out: Node[] = [];
    if (this.state.error) {
      out.push(
        { kind: 'message', text: t('Scan failed — click to retry'), icon: 'error', command: { command: 'whosOnMyPort.refresh', title: t('Retry') } },
        { kind: 'message', text: this.state.error, icon: 'output', command: { command: 'whosOnMyPort.showLogs', title: t('Show Logs') } },
      );
    }
    const pinned = [...new Set(cfg().pinnedPorts)].sort((a, b) => a - b);
    if (pinned.length) out.push({ kind: 'pinned', ports: pinned });

    const projects = this.projects();
    this.projectCount = projects.length;
    out.push(...projects);
    if (projects.length === 0 && !this.state.error) {
      out.push({ kind: 'message', text: t('No ports in use'), icon: 'circle-slash' });
    }
    return out;
  }

  // ---------- rendering ----------

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'project':
        return this.projectItem(node);
      case 'pinned': {
        const item = new vscode.TreeItem(t('Pinned'), vscode.TreeItemCollapsibleState.Expanded);
        item.id = 'pinned';
        item.description = `(${node.ports.length})`;
        item.iconPath = new vscode.ThemeIcon('pinned');
        item.contextValue = 'pinnedGroup';
        return item;
      }
      case 'freePinned': {
        const item = new vscode.TreeItem(`:${node.port}`);
        item.id = `free:${node.port}`;
        const range = isReserved(node.port, this.reserved);
        if (range) {
          const text = t('Port {0} is reserved by Windows (Hyper-V/WSL range {1})', node.port, formatRange(range));
          item.description = t('reserved by Windows');
          item.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor('list.warningForeground'));
          item.contextValue = 'freePort.pinned.reserved';
          item.tooltip = text;
          item.accessibilityInformation = { label: text };
          item.command = { command: 'whosOnMyPort.showReservedPorts', title: t('How to fix'), arguments: [node.port] };
          return item;
        }
        item.description = t('free');
        item.iconPath = new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('descriptionForeground'));
        item.contextValue = 'freePort.pinned';
        item.tooltip = t('Port {0} is free', node.port);
        item.accessibilityInformation = { label: t('Port {0} is free', node.port) };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.text);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = node.command;
        item.tooltip = node.text;
        return item;
      }
      case 'port':
        return this.portItem(node.entry, node.pinned, node.parentKey);
    }
  }

  private projectItem(p: ProjectNode): vscode.TreeItem {
    const count = p.entries.length;
    let state = vscode.TreeItemCollapsibleState.Expanded;
    if (count === 0) state = vscode.TreeItemCollapsibleState.None;
    else if (p.projectKind === 'background' && this.projectCount > 1) state = vscode.TreeItemCollapsibleState.Collapsed;

    const item = new vscode.TreeItem(p.name, state);
    item.id = `project:${p.key}`;
    // Only used to attach warning FileDecorations; label/description/icon stay explicit.
    item.resourceUri = projectUri(p.key);
    item.description = p.projectKind === 'current' ? t('current ({0})', count) : `(${count})`;
    item.iconPath =
      p.projectKind === 'current'
        ? new vscode.ThemeIcon('folder-active', new vscode.ThemeColor('charts.green'))
        : p.projectKind === 'other'
          ? new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'))
          : new vscode.ThemeIcon('server-process', new vscode.ThemeColor('descriptionForeground'));

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${p.name}**\n\n`);
    if (p.path) md.appendMarkdown(`\`${p.path}\`\n\n`);
    const windows = [...new Set(p.entries.map((e) => e.windowLabel).filter(Boolean))];
    if (windows.length) md.appendMarkdown(`${t('Owned by VS Code window')}: **${windows.join(', ')}**\n\n`);
    md.appendMarkdown(count ? p.entries.map((e) => `\`:${e.port}\` ${shortName(e)}`).join(' · ') : t('No ports in use'));
    item.tooltip = md;

    const ctx = ['projectGroup'];
    if (p.entries.some((e) => !e.blocked)) ctx.push('killable');
    if (p.path) ctx.push('hasPath');
    item.contextValue = ctx.join('.');
    return item;
  }

  private portItem(e: PortEntry, pinned: boolean, parentKey: string): vscode.TreeItem {
    const item = new vscode.TreeItem(`:${e.port}`);
    item.id = `port:${parentKey}:${e.port}:${e.pid}`;
    item.resourceUri = portUri(e);

    // "<processName> · <memory> · <uptime>" + safety flags only when relevant.
    const parts: string[] = [shortName(e)];
    if (e.proc) parts.push(formatMb(e.proc.memBytes));
    const up = e.proc ? formatUptime(e.proc.created) : undefined;
    if (up) parts.push(up);
    if (e.group === 'orphan') parts.push(t('orphaned'));
    if (e.lanExposed) parts.push('LAN');
    if (parentKey === 'pinned' && e.projectName) parts.push(e.projectName);
    item.description = parts.join(' · ');

    item.iconPath = this.portIcon(e);
    item.tooltip = this.tooltip(e);
    item.accessibilityInformation = {
      label: t('Port {0}, {1}, PID {2}{3}', e.port, shortName(e), e.pid, e.projectName ? `, ${e.projectName}` : ''),
    };

    const ctx = ['portItem', e.blocked ? 'blocked' : 'killable', pinned ? 'pinned' : 'unpinned'];
    if (e.terminalPid !== undefined) ctx.push('terminal');
    if (this.restartCommand(e)) ctx.push('restartable');
    if (e.lanExposed) ctx.push('lan');
    if (e.projectPath) ctx.push('hasPath');
    item.contextValue = ctx.join('.');
    return item;
  }

  private portIcon(e: PortEntry): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
    if (e.blocked === 'system') return new vscode.ThemeIcon('lock', new vscode.ThemeColor('descriptionForeground'));
    const key = e.proc ? iconKey(e.proc.name, e.proc.commandLine) : undefined;
    if (key) {
      const dark = vscode.Uri.joinPath(this.extensionUri, 'media', 'runtime', `${key}.svg`);
      const light = ICONS_WITH_LIGHT.has(key) ? vscode.Uri.joinPath(this.extensionUri, 'media', 'runtime', `${key}_light.svg`) : dark;
      return { light, dark };
    }
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
  }

  private tooltip(e: PortEntry): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`### :${e.port} — ${e.proc?.name ?? t('(exited)')}\n\n`);
    const rows: [string, string][] = [['PID', String(e.pid)]];
    if (e.proc) rows.push([t('Memory'), formatMb(e.proc.memBytes)]);
    const up = e.proc ? formatUptime(e.proc.created) : undefined;
    if (up) rows.push([t('Uptime'), up]);
    rows.push([t('Bound to'), e.addresses.map((a) => `\`${a}\``).join(', ') + (e.lanExposed ? ` — ${t('reachable from your network')}` : '')]);
    const lan = entryLanUrls(e);
    if (lan.length) rows.push([t('LAN URL'), lan.slice(0, 3).map((u) => u.url).join(', ') + (lan.length > 3 ? ' …' : '')]);
    rows.push([t('Open connections'), String(e.connections)]);
    if (e.projectPath) rows.push([t('Project'), `\`${e.projectPath}\``]);
    if (e.windowLabel) rows.push([t('Owned by VS Code window'), `**${e.windowLabel}**`]);
    else if (e.unregisteredWindow) rows.push([t('Owned by VS Code window'), t('another VS Code window')]);
    if (e.terminalPid !== undefined) rows.push([t('Terminal'), t('Running in a terminal of this window')]);
    if (e.parent) rows.push([t('Parent'), `${e.parent.name} (PID ${e.parent.pid})`]);
    const restart = this.restartCommand(e);
    if (restart) rows.push([t('Restart runs'), `\`${restart.commandLine.replace(/`/g, "'")}\``]);
    md.appendMarkdown(rows.map(([k, v]) => `**${k}:** ${v}`).join('  \n') + '\n\n');

    const warnings = warningLines(entryWarnings(e, thresholds(), this.state.scannedAt ?? Date.now()));
    if (warnings.length) md.appendMarkdown(`$(warning) ${warnings.join(' · ')}\n\n`);

    if (e.proc?.commandLine) md.appendCodeblock(e.proc.commandLine, 'shell');
    else if (e.elevated) md.appendMarkdown(`$(lock) ${t('Running with higher privileges — details hidden.')}\n\n`);
    if (e.group === 'orphan') md.appendMarkdown(`\n$(warning) ${t('Orphaned: the terminal or window that started it is gone.')}\n\n`);
    if (e.group === 'extension') md.appendMarkdown(`\n$(extensions) ${t('Started by a VS Code extension. Stopping it may break that extension.')}\n\n`);
    if (e.blocked) md.appendMarkdown(`\n$(shield) ${blockMessage(e.blocked)}\n`);
    return md;
  }
}
