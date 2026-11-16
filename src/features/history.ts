// Port History: remembers the terminal commands that actually opened a port in this workspace
// and lets the user run them again. Stored in globalState for all projects (never in a project folder).
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import {
  closeStale,
  mergeRecords,
  endReasonOf,
  formatAge,
  HISTORY_KEY,
  markEnded,
  recordKilled,
  sanitizeRecords,
  upsertRecord,
  type HistoryRecord,
} from '../core/history';
import type { Killer } from '../core/killer';
import { baseName, normalizePath } from '../core/pathUtils';
import { CONFIG, type PortService, type PortState } from '../core/portService';
import { friendlyCommand } from '../core/launchCommand';
import { isRedacted, redactCommand } from '../core/redact';
import { WindowRegistry } from '../core/windowRegistry';
import { isAlive } from '../providers/processProvider';
import type { PortEntry } from '../types';
import type { CommandTracker } from './commandTracker';

const t = vscode.l10n.t;
const STATUS_MS = 2500;
const PERSIST_LASTSEEN_MS = 60_000;

const enabled = () => vscode.workspace.getConfiguration(CONFIG).get<boolean>('history.enabled', true);

export class PortHistory implements vscode.Disposable {
  /** Terminal execution → history record id (runs recorded in this session). */
  private readonly runs = new WeakMap<vscode.TerminalShellExecution, string>();
  /** Executions being stopped by Killer (their end is recorded as "killed"). */
  private readonly killing = new WeakSet<vscode.TerminalShellExecution>();
  private lastPersist = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly memento: vscode.Memento,
    legacyMemento: vscode.Memento | undefined,
    private readonly service: PortService,
    private readonly tracker: CommandTracker,
    killer: Killer,
    private readonly log: vscode.LogOutputChannel,
  ) {
    // One-time migration from the old per-workspace store.
    const legacy = legacyMemento ? sanitizeRecords(legacyMemento.get(HISTORY_KEY)) : [];
    const stored = this.load();
    const start = closeStale(legacy.length ? mergeRecords(stored, legacy) : stored, isAlive);
    if (legacy.length) void legacyMemento!.update(HISTORY_KEY, undefined);
    if (legacy.length || start.some((r, i) => r !== stored[i])) this.set(start, true);

    this.disposables.push(
      service.onDidChange((s) => this.onScan(s)),
      tracker.onDidEnd((e) => {
        const id = this.runs.get(e.execution);
        if (!id) return;
        const reason = this.killing.has(e.execution) ? 'killed' : endReasonOf(e.exitCode);
        this.set(markEnded(this.load(), id, reason, e.exitCode, Date.now()), true);
      }),
      killer.onWillKill((entry) => {
        const exec = this.executionOf(entry);
        if (exec && this.runs.has(exec)) this.killing.add(exec);
      }),
      killer.onDidKill(({ entry, ok }) => {
        const exec = this.executionOf(entry);
        const id = exec && this.runs.get(exec);
        if (exec && id) {
          if (ok) this.set(markEnded(this.load(), id, 'killed', undefined, Date.now()), true);
          else this.killing.delete(exec);
          return;
        }
        // A server we never saw start (before activation, outside VS Code terminals, another
        // tool…): rebuild its launch command from the process tree so it can be run again.
        if (ok && enabled()) this.recordUntrackedKill(entry);
      }),
    );
  }

  /** Always read from storage: other windows write to the same history. */
  private load(): HistoryRecord[] {
    return sanitizeRecords(this.memento.get(HISTORY_KEY));
  }

  get records(): readonly HistoryRecord[] {
    return this.load();
  }

  isRunning(r: HistoryRecord): boolean {
    return r.endedAt === undefined;
  }

  remove(id: string): void {
    this.set(this.load().filter((r) => r.id !== id), true);
  }

  clear(): void {
    this.set([], true);
  }

  private executionOf(e: PortEntry): vscode.TerminalShellExecution | undefined {
    if (e.terminalPid === undefined) return undefined;
    return this.tracker.lastCommand(this.service.terminals.get(e.terminalPid))?.execution;
  }

  private recordUntrackedKill(e: PortEntry): void {
    if (e.blocked || !e.isDev) return;
    const raw = e.launcherCommandLine ?? e.proc?.commandLine;
    if (!raw) return; // elevated process: command line unreadable
    const terminal = e.terminalPid !== undefined ? this.service.terminals.get(e.terminalPid) : undefined;
    const cwd = (terminal && WindowRegistry.cwdOf(terminal)) ?? e.terminalCwd ?? e.projectPath ?? '';
    const command = redactCommand(friendlyCommand(raw));
    const sighting = {
      command,
      cwd,
      projectName: e.projectName ?? (cwd ? baseName(cwd) : t('Unknown project')),
      ports: [e.port],
      terminalName: terminal?.name ?? '',
    };
    const now = Date.now();
    this.set(recordKilled(this.load(), sighting, now, () => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`), true);
    this.log.info(`history: recorded killed "${command}" on :${e.port} (cwd ${cwd || '?'})`);
  }

  /** Records every still-running terminal command that holds a port in this scan. */
  private onScan(s: PortState): void {
    if (!enabled() || s.error) return;
    const byExec = new Map<vscode.TerminalShellExecution, { entry: PortEntry; terminal: vscode.Terminal; ports: number[] }>();
    for (const e of s.entries) {
      if (e.terminalPid === undefined || e.blocked) continue;
      const terminal = this.service.terminals.get(e.terminalPid);
      const cmd = this.tracker.lastCommand(terminal);
      if (!terminal || !cmd || this.tracker.isEnded(cmd.execution)) continue;
      const g = byExec.get(cmd.execution);
      if (g) g.ports.push(e.port);
      else byExec.set(cmd.execution, { entry: e, terminal, ports: [e.port] });
    }
    if (byExec.size === 0) return;

    let records = this.load();
    let changed = false;
    const now = Date.now();
    for (const [exec, { entry, terminal, ports }] of byExec) {
      const cmd = this.tracker.lastCommand(terminal)!;
      const cwd = cmd.cwd ?? entry.projectPath ?? '';
      const r = upsertRecord(
        records,
        {
          command: redactCommand(cmd.commandLine),
          cwd,
          projectName: entry.projectName ?? (cwd ? baseName(cwd) : terminal.name),
          ports,
          terminalName: terminal.name,
          ownerPid: process.pid,
        },
        now,
        this.runs.has(exec),
        () => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      );
      if (!this.runs.has(exec)) this.log.info(`history: recorded "${r.records[0].command}" on :${ports.join(', :')}`);
      this.runs.set(exec, r.id);
      records = r.records;
      changed ||= r.changed;
    }
    this.set(records, changed);
  }

  private set(records: HistoryRecord[], important: boolean): void {
    if (important || Date.now() - this.lastPersist > PERSIST_LASTSEEN_MS) void this.persist(records);
  }

  private async persist(records: HistoryRecord[]): Promise<void> {
    this.lastPersist = Date.now();
    try {
      await this.memento.update(HISTORY_KEY, records);
    } catch (e) {
      this.log.warn(`history: could not save: ${e}`);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

// ---------------- UI ----------------

type Item = vscode.QuickPickItem & { record?: HistoryRecord };

const RUN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('play'), tooltip: t('Run again') };
const REMOVE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: t('Remove from history') };
const CLEAR: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: t('Clear Port History') };

function reasonLabel(r: HistoryRecord): string {
  switch (r.endReason) {
    case 'stopped':
      return t('stopped');
    case 'crashed':
      return r.exitCode !== undefined ? t('crashed (exit {0})', r.exitCode) : t('crashed');
    case 'killed':
      return t('killed');
    default:
      return t('ended');
  }
}

function ago(ms: number): string {
  return ms < 60_000 ? t('just now') : t('{0} ago', formatAge(ms));
}

/** QuickPick labels render "$(name)" as icons; break that up for display only. */
const plain = (s: string) => s.replace(/\$\(/g, '$​(');

/** True when `cwd` lies inside one of this window's workspace folders. */
function inCurrentWorkspace(cwd: string): boolean {
  if (!cwd) return false;
  const c = normalizePath(cwd);
  return (vscode.workspace.workspaceFolders ?? []).some((f) => {
    const w = normalizePath(f.uri.fsPath);
    return c === w || c.startsWith(w + '\\');
  });
}

function toItem(h: PortHistory, r: HistoryRecord, now: number): Item {
  const running = h.isRunning(r);
  const parts = [r.projectName];
  if (running) parts.push(t('running'));
  else parts.push(ago(now - (r.endedAt ?? r.lastSeen)), reasonLabel(r));
  if (isRedacted(r.command)) parts.push(t('secret hidden'));
  return {
    label: `${r.ports.map((p) => `:${p}`).join(' ')}  ${plain(r.command)}`,
    description: parts.join(' · '),
    detail: r.cwd || undefined,
    buttons: running ? [REMOVE] : [RUN, REMOVE],
    record: r,
  };
}

export async function showHistory(h: PortHistory, tracker: CommandTracker, log: vscode.LogOutputChannel): Promise<void> {
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = t('Port History');
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.buttons = [CLEAR];

  const render = () => {
    const now = Date.now();
    const all = h.records;
    const running = all.filter((r) => h.isRunning(r));
    const ended = all.filter((r) => !h.isRunning(r));
    const here = ended.filter((r) => inCurrentWorkspace(r.cwd));
    const elsewhere = ended.filter((r) => !inCurrentWorkspace(r.cwd));
    const items: Item[] = [];
    const section = (label: string, list: HistoryRecord[]) => {
      if (!list.length) return;
      items.push({ label, kind: vscode.QuickPickItemKind.Separator });
      items.push(...list.map((r) => toItem(h, r, now)));
    };
    section(t('Running'), running);
    section(t('This workspace'), here);
    section(t('Other projects'), elsewhere);
    if (items.length === 0) {
      items.push({ label: `$(history) ${t('No dev server has been recorded yet. Start one in a terminal, or stop one from the Ports view.')}` });
    }
    qp.items = items;
    qp.placeholder = enabled()
      ? t('Enter = run again · dev servers you started or stopped, all projects')
      : t('Port History is turned off (whosOnMyPort.history.enabled)');
  };
  render();

  const run = (r: HistoryRecord) => {
    qp.hide();
    void runAgain(r, tracker, log);
  };
  const subs = [
    qp.onDidAccept(() => {
      const r = qp.selectedItems[0]?.record;
      if (!r) return qp.hide();
      if (h.isRunning(r)) {
        vscode.window.setStatusBarMessage(`$(info) ${t('Already running: {0}', r.command)}`, STATUS_MS);
        return qp.hide();
      }
      run(r);
    }),
    qp.onDidTriggerItemButton(({ item, button }) => {
      if (!item.record) return;
      if (button === RUN) run(item.record);
      else if (button === REMOVE) {
        h.remove(item.record.id);
        render();
      }
    }),
    qp.onDidTriggerButton((b) => {
      if (b !== CLEAR) return;
      h.clear();
      render();
      vscode.window.setStatusBarMessage(`$(check) ${t('Port History cleared')}`, STATUS_MS);
    }),
  ];
  await new Promise<void>((resolve) => subs.push(qp.onDidHide(() => resolve())));
  subs.forEach((d) => d.dispose());
  qp.dispose();
}

/** Idle terminal of this window in `cwd`: shell integration active and nothing running. */
function idleTerminalIn(cwd: string, tracker: CommandTracker): vscode.Terminal | undefined {
  if (!cwd) return undefined;
  const want = normalizePath(cwd);
  return vscode.window.terminals.find((term) => {
    if (term.exitStatus !== undefined || !term.shellIntegration) return false;
    const here = term.shellIntegration.cwd?.fsPath;
    if (!here || normalizePath(here) !== want) return false;
    const last = tracker.lastCommand(term);
    return !last || tracker.isEnded(last.execution);
  });
}

function waitForShellIntegration(term: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration | undefined> {
  if (term.shellIntegration) return Promise.resolve(term.shellIntegration);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(term.shellIntegration);
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal !== term) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e.shellIntegration);
    });
  });
}

export async function runAgain(r: HistoryRecord, tracker: CommandTracker, log: vscode.LogOutputChannel): Promise<void> {
  if (r.cwd && !fs.existsSync(r.cwd)) {
    vscode.window.setStatusBarMessage(`$(warning) ${t('Folder no longer exists: {0}', r.cwd)}`, 4000);
    return;
  }
  const reused = idleTerminalIn(r.cwd, tracker);
  const term = reused ?? vscode.window.createTerminal({ name: r.projectName || t('Port History'), cwd: r.cwd || undefined });
  term.show();
  log.info(`history: run again "${r.command}" in ${reused ? 'existing' : 'new'} terminal (cwd ${r.cwd || '?'})`);

  if (!r.cwd) {
    // Folder unknown (server started outside VS Code terminals): don't run it in the wrong place.
    term.sendText(r.command, false);
    vscode.window.setStatusBarMessage(`$(folder) ${t('Folder unknown: cd into the project, then press Enter')}`, 6000);
    return;
  }
  if (isRedacted(r.command)) {
    // The real secret was never stored: type the command, let the user fill it in.
    term.sendText(r.command, false);
    vscode.window.setStatusBarMessage(`$(key) ${t('Replace *** with the real value, then press Enter')}`, 6000);
    return;
  }
  const si = await waitForShellIntegration(term, 3000);
  if (si) si.executeCommand(r.command);
  else term.sendText(r.command, true);
  vscode.window.setStatusBarMessage(`$(play) ${t('Running {0}', r.command)}`, STATUS_MS);
}
