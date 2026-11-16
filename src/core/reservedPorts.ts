// Ports reserved by Windows ("netsh interface ipv4 show excludedportrange protocol=tcp").
// Hyper-V / WSL / Docker reserve blocks of ports through WinNAT; binding inside such a block
// fails with EACCES / WinError 10013 even though nobody listens. Pure, no 'vscode' import.
import type { PortRange } from '../types';

/**
 * Parses netsh output. The text around the table is localized, so only lines made of
 * two port numbers (plus an optional "*" = administered exclusion) are taken.
 */
export function parseExcludedPortRanges(text: string): PortRange[] {
  const out: PortRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,5})\s+(\d{1,5})\s*(\*)?\s*$/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start < 1 || end > 65535 || end < start) continue;
    out.push({ start, end, administered: !!m[3] });
  }
  return out;
}

/** Sorted, de-duplicated union of several range lists (IPv4 + IPv6). Overlaps are kept as-is. */
export function mergePortRanges(...lists: PortRange[][]): PortRange[] {
  const seen = new Map<string, PortRange>();
  for (const r of lists.flat()) {
    const key = `${r.start}-${r.end}`;
    const prev = seen.get(key);
    seen.set(key, prev ? { ...prev, administered: prev.administered || r.administered } : r);
  }
  return [...seen.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The reserved range containing `port`, if any. */
export function isReserved(port: number, ranges: readonly PortRange[]): PortRange | undefined {
  return ranges.find((r) => port >= r.start && port <= r.end);
}

export function formatRange(r: PortRange): string {
  return r.start === r.end ? String(r.start) : `${r.start}–${r.end}`;
}
