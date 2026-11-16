// Markdown table of port entries ("Copy Port List as Markdown"). Pure, no 'vscode' import.
import type { PortEntry } from '../types';
import { formatMb, formatUptime } from './runtime';

export interface MarkdownLabels {
  /** Column headers: Port, Process, PID, Project, Memory, Uptime, Bound to, Window. */
  headers: [string, string, string, string, string, string, string, string];
  /** Shown in the Window column for processes owned by this window. */
  thisWindow: string;
  /** Shown in the Window column for another VS Code window without a label. */
  otherWindow: string;
}

export const DEFAULT_MARKDOWN_LABELS: MarkdownLabels = {
  headers: ['Port', 'Process', 'PID', 'Project', 'Memory', 'Uptime', 'Bound to', 'Window'],
  thisWindow: 'this window',
  otherWindow: 'another VS Code window',
};

/** Escapes characters that would break a Markdown table cell. */
export function mdCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function windowOf(e: PortEntry, l: MarkdownLabels): string {
  if (e.windowLabel) return e.windowLabel;
  if (e.unregisteredWindow) return l.otherWindow;
  if (e.terminalPid !== undefined || e.group === 'current') return l.thisWindow;
  return '';
}

export function toMarkdownTable(entries: readonly PortEntry[], labels: MarkdownLabels = DEFAULT_MARKDOWN_LABELS, now = Date.now()): string {
  const rows = entries.map((e) => [
    String(e.port),
    e.proc?.name ?? '',
    String(e.pid),
    e.projectName ?? '',
    e.proc ? formatMb(e.proc.memBytes) : '',
    (e.proc && formatUptime(e.proc.created, now)) || '',
    e.addresses.join(', '),
    windowOf(e, labels),
  ]);
  const line = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |`;
  return [line(labels.headers), `|${labels.headers.map((_, i) => (i === 0 || i === 2 ? ' ---: ' : ' --- ')).join('|')}|`, ...rows.map(line)].join('\n') + '\n';
}
