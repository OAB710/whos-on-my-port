// Port ordering for the tree (no 'vscode' import; unit-tested).
import type { PortEntry } from '../types';

export const SORT_KEYS = ['port', 'memory', 'uptime', 'name'] as const;
export type SortBy = (typeof SORT_KEYS)[number];

export function toSortBy(v: unknown): SortBy {
  return (SORT_KEYS as readonly unknown[]).includes(v) ? (v as SortBy) : 'port';
}

const byPort = (a: PortEntry, b: PortEntry) => a.port - b.port || a.pid - b.pid;
const nameOf = (e: PortEntry) => (e.proc?.name ?? '').replace(/\.exe$/i, '').toLowerCase();

/**
 * port   — ascending port number
 * memory — biggest first (unknown last)
 * uptime — longest running first (unknown last)
 * name   — process name A–Z
 * Ties fall back to port order, so the list never jumps around.
 */
export function compareEntries(sortBy: SortBy): (a: PortEntry, b: PortEntry) => number {
  switch (sortBy) {
    case 'memory':
      return (a, b) => (b.proc?.memBytes ?? -1) - (a.proc?.memBytes ?? -1) || byPort(a, b);
    case 'uptime':
      // FILETIME creation: smaller = started earlier = longer uptime. 0 = unknown.
      return (a, b) => {
        const ca = a.proc?.created || Number.MAX_SAFE_INTEGER;
        const cb = b.proc?.created || Number.MAX_SAFE_INTEGER;
        return ca - cb || byPort(a, b);
      };
    case 'name':
      return (a, b) => {
        const na = nameOf(a);
        const nb = nameOf(b);
        if (na !== nb) return !na ? 1 : !nb ? -1 : na.localeCompare(nb);
        return byPort(a, b);
      };
    default:
      return byPort;
  }
}

export function sortEntries(entries: readonly PortEntry[], sortBy: SortBy): PortEntry[] {
  return [...entries].sort(compareEntries(sortBy));
}
