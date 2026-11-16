// Multi-select helpers for tree commands (no 'vscode' import; unit-tested).
import type { PortEntry } from '../types';

/**
 * Nodes a command should act on. VS Code passes `(clicked, selected)` for menu / inline
 * actions; keybindings pass nothing, so the view's current selection is used.
 * The whole selection applies only when the clicked node is part of it.
 */
export function resolveTargets<T>(clicked: T | undefined, selected: readonly T[] | undefined, viewSelection: readonly T[]): T[] {
  if (clicked === undefined || clicked === null || typeof clicked !== 'object') return [...viewSelection];
  if (selected && selected.length > 1 && selected.includes(clicked)) return [...selected];
  return [clicked];
}

type EntryNode =
  | { kind: 'port'; entry: PortEntry }
  | { kind: 'project'; entries: PortEntry[] }
  | { kind: string };

/** Entries of selected port leaves and project groups, one per PID (a PID can hold several ports). */
export function entriesOf(nodes: readonly EntryNode[]): PortEntry[] {
  const seen = new Set<number>();
  const out: PortEntry[] = [];
  for (const n of nodes) {
    const list = n.kind === 'port' ? [(n as { entry: PortEntry }).entry] : n.kind === 'project' ? (n as { entries: PortEntry[] }).entries : [];
    for (const e of list) {
      if (seen.has(e.pid)) continue;
      seen.add(e.pid);
      out.push(e);
    }
  }
  return out;
}

/** Distinct ports of selected port leaves / free pinned ports, in selection order. */
export function portsOf(nodes: readonly ({ kind: string; entry?: PortEntry; port?: number })[]): number[] {
  const out: number[] = [];
  for (const n of nodes) {
    const port = n.kind === 'port' ? n.entry?.port : n.kind === 'freePinned' ? n.port : undefined;
    if (port !== undefined && !out.includes(port)) out.push(port);
  }
  return out;
}
