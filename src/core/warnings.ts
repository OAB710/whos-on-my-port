// Memory-hog / long-running thresholds. Pure, no 'vscode' import.
import type { PortEntry } from '../types';
import { filetimeToMs } from './runtime';

export interface WarningThresholds {
  /** 0 = off. */
  memoryWarningMB: number;
  /** 0 = off. */
  longRunningHours: number;
}

export interface EntryWarnings {
  /** Set when memory is at or above the threshold. */
  memoryBytes?: number;
  /** Whole hours running, set when at or above the threshold. */
  runningHours?: number;
}

export const MEMORY_BADGE = '▲';
export const LONG_RUNNING_BADGE = '⏱';

export function entryWarnings(e: PortEntry, th: WarningThresholds, now = Date.now()): EntryWarnings {
  const w: EntryWarnings = {};
  if (!e.proc) return w;
  if (th.memoryWarningMB > 0 && e.proc.memBytes >= th.memoryWarningMB * 1024 * 1024) w.memoryBytes = e.proc.memBytes;
  if (th.longRunningHours > 0 && e.proc.created) {
    const hours = (now - filetimeToMs(e.proc.created)) / 3_600_000;
    if (hours >= th.longRunningHours) w.runningHours = Math.floor(hours);
  }
  return w;
}

export function hasWarning(w: EntryWarnings): boolean {
  return w.memoryBytes !== undefined || w.runningHours !== undefined;
}

/** 1–2 character badge for a file decoration, or undefined when there is nothing to flag. */
export function warningBadge(w: EntryWarnings): string | undefined {
  const b = (w.memoryBytes !== undefined ? MEMORY_BADGE : '') + (w.runningHours !== undefined ? LONG_RUNNING_BADGE : '');
  return b || undefined;
}

/** Merges several entries' warnings (project node): worst memory, longest uptime. */
export function mergeWarnings(list: EntryWarnings[]): EntryWarnings {
  const out: EntryWarnings = {};
  for (const w of list) {
    if (w.memoryBytes !== undefined) out.memoryBytes = Math.max(out.memoryBytes ?? 0, w.memoryBytes);
    if (w.runningHours !== undefined) out.runningHours = Math.max(out.runningHours ?? 0, w.runningHours);
  }
  return out;
}
