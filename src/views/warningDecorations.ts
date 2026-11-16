// Memory-hog / long-running markers as FileDecorations on tree items (no notifications).
import * as vscode from 'vscode';
import { cfg, type PortService, type PortState } from '../core/portService';
import { formatMb } from '../core/runtime';
import { entryWarnings, hasWarning, mergeWarnings, warningBadge, type EntryWarnings } from '../core/warnings';
import type { PortEntry } from '../types';

const t = vscode.l10n.t;
export const DECORATION_SCHEME = 'whos-on-my-port';

export function portUri(e: PortEntry): vscode.Uri {
  return vscode.Uri.from({ scheme: DECORATION_SCHEME, path: `/port/${e.port}/${e.pid}` });
}

export function projectUri(key: string): vscode.Uri {
  return vscode.Uri.from({ scheme: DECORATION_SCHEME, path: `/project/${encodeURIComponent(key)}` });
}

export function thresholds() {
  const c = cfg();
  return { memoryWarningMB: c.memoryWarningMB, longRunningHours: c.longRunningHours };
}

/** Human-readable warning lines ("Uses 1.4 GB RAM", "Running for 9h"). */
export function warningLines(w: EntryWarnings): string[] {
  const out: string[] = [];
  if (w.memoryBytes !== undefined) out.push(t('Uses {0} RAM', formatMb(w.memoryBytes)));
  if (w.runningHours !== undefined) out.push(t('Running for {0}h', w.runningHours));
  return out;
}

export class WarningDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly byUri = new Map<string, EntryWarnings>();
  private readonly disposables: vscode.Disposable[] = [];
  private entries: PortEntry[] = [];
  private scannedAt = Date.now();

  /** `projectKeysOf` returns the tree's level-1 project groups (for propagating to project rows). */
  constructor(service: PortService, private readonly projectKeysOf: () => { key: string; entries: PortEntry[] }[]) {
    this.disposables.push(
      vscode.window.registerFileDecorationProvider(this),
      service.onDidChange((s) => this.update(s)),
    );
  }

  /** Recomputes after a scan or a settings change. */
  update(s?: PortState): void {
    if (s) {
      this.entries = s.entries;
      this.scannedAt = s.scannedAt ?? Date.now();
    }
    const th = thresholds();
    this.byUri.clear();
    const perEntry = new Map<PortEntry, EntryWarnings>();
    for (const e of this.entries) {
      const w = entryWarnings(e, th, this.scannedAt);
      if (!hasWarning(w)) continue;
      perEntry.set(e, w);
      this.byUri.set(portUri(e).toString(), w);
    }
    if (perEntry.size) {
      for (const p of this.projectKeysOf()) {
        const merged = mergeWarnings(p.entries.map((e) => perEntry.get(e) ?? {}));
        if (hasWarning(merged)) this.byUri.set(projectUri(p.key).toString(), merged);
      }
    }
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== DECORATION_SCHEME) return undefined;
    const w = this.byUri.get(uri.toString());
    if (!w) return undefined;
    return new vscode.FileDecoration(warningBadge(w), warningLines(w).join(' · '), new vscode.ThemeColor('list.warningForeground'));
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}
