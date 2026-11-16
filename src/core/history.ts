// Port History: commands that actually opened a port (no 'vscode' import; unit-tested).
// Stored once for all projects in VS Code's globalState — never in a file inside a project.

export type EndReason = 'stopped' | 'crashed' | 'killed' | 'unknown';

export interface HistoryRecord {
  id: string;
  /** Already redacted (see redact.ts). */
  command: string;
  cwd: string;
  projectName: string;
  ports: number[];
  terminalName: string;
  /** Extension-host PID of the window running it (only while running). */
  ownerPid?: number;
  /** Start of the latest run (ms). */
  firstSeen: number;
  lastSeen: number;
  endedAt?: number;
  endReason?: EndReason;
  exitCode?: number;
}

export const HISTORY_KEY = 'whosOnMyPort.history.v1';
export const HISTORY_MAX = 100;

/** De-dupe key: same command in the same folder (Windows paths are case-insensitive). */
export function historyKey(command: string, cwd: string): string {
  return `${command.trim()}\u0000${cwd.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()}`;
}

export interface Sighting {
  ownerPid?: number;
  command: string;
  cwd: string;
  projectName: string;
  ports: number[];
  terminalName: string;
}

export interface UpsertResult {
  records: HistoryRecord[];
  id: string;
  /** Something other than lastSeen changed (worth persisting right away). */
  changed: boolean;
}

const uniqSorted = (ports: number[]) => [...new Set(ports)].sort((a, b) => a - b);

/**
 * Records a running command seen holding `ports`. `sameRun` = this sighting belongs to a run
 * already recorded (same terminal execution): ports are merged. Otherwise it is a new run:
 * the record moves to the top and its end state is cleared.
 */
export function upsertRecord(
  records: readonly HistoryRecord[],
  s: Sighting,
  now: number,
  sameRun: boolean,
  newId: () => string,
  max = HISTORY_MAX,
): UpsertResult {
  const key = historyKey(s.command, s.cwd);
  const idx = records.findIndex((r) => historyKey(r.command, r.cwd) === key);
  const old = idx >= 0 ? records[idx] : undefined;
  if (old && sameRun && old.endedAt === undefined) {
    const ports = uniqSorted([...old.ports, ...s.ports]);
    const changed = ports.join() !== old.ports.join();
    const updated: HistoryRecord = { ...old, ports, lastSeen: now };
    const out = [...records];
    out[idx] = updated;
    return { records: out, id: old.id, changed };
  }
  const rec: HistoryRecord = {
    id: old?.id ?? newId(),
    command: s.command,
    cwd: s.cwd,
    projectName: s.projectName,
    ports: uniqSorted(s.ports),
    terminalName: s.terminalName,
    ...(s.ownerPid !== undefined ? { ownerPid: s.ownerPid } : {}),
    firstSeen: now,
    lastSeen: now,
  };
  const rest = records.filter((_, i) => i !== idx);
  return { records: [rec, ...rest].slice(0, max), id: rec.id, changed: true };
}

/**
 * Records a server that was killed but whose start we never saw (started before the extension,
 * outside VS Code terminals, by another tool…). Several ports of the same process killed together
 * (within `mergeMs`) end up in one record.
 */
export function recordKilled(
  records: readonly HistoryRecord[],
  s: Sighting,
  now: number,
  newId: () => string,
  mergeMs = 5000,
): HistoryRecord[] {
  const key = historyKey(s.command, s.cwd);
  const idx = records.findIndex((r) => historyKey(r.command, r.cwd) === key);
  const old = idx >= 0 ? records[idx] : undefined;
  if (old && old.endReason === 'killed' && old.endedAt !== undefined && now - old.endedAt <= mergeMs) {
    const out = [...records];
    out[idx] = { ...old, ports: uniqSorted([...old.ports, ...s.ports]) };
    return out;
  }
  const { records: up, id } = upsertRecord(records, s, now, false, newId);
  return markEnded(up, id, 'killed', undefined, now);
}

export function endReasonOf(exitCode: number | undefined): EndReason {
  if (exitCode === undefined) return 'unknown';
  return exitCode === 0 ? 'stopped' : 'crashed';
}

/** Marks a run as ended. The first reason wins (a kill is recorded before the shell reports the exit). */
export function markEnded(
  records: readonly HistoryRecord[],
  id: string,
  reason: EndReason,
  exitCode: number | undefined,
  now: number,
): HistoryRecord[] {
  return records.map((r) =>
    r.id === id && r.endedAt === undefined
      ? { ...r, endedAt: now, endReason: reason, ...(exitCode !== undefined ? { exitCode } : {}) }
      : r,
  );
}

/**
 * Runs still marked as running whose window is gone (reload/close) can't be followed any more:
 * close them as 'unknown' at their last sighting. Runs owned by a live window are kept.
 */
export function closeStale(records: readonly HistoryRecord[], ownerAlive: (pid: number) => boolean = () => false): HistoryRecord[] {
  return records.map((r) =>
    r.endedAt === undefined && !(r.ownerPid !== undefined && ownerAlive(r.ownerPid))
      ? { ...r, endedAt: r.lastSeen, endReason: 'unknown' as const }
      : r,
  );
}

/** Merges records from an older per-workspace store; newest first, de-duplicated, capped. */
export function mergeRecords(a: readonly HistoryRecord[], b: readonly HistoryRecord[], max = HISTORY_MAX): HistoryRecord[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .sort((x, y) => (y.endedAt ?? y.lastSeen) - (x.endedAt ?? x.lastSeen))
    .filter((r) => {
      const k = historyKey(r.command, r.cwd);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}

/** Validates data read back from storage (shape may come from an older/newer version). */
export function sanitizeRecords(value: unknown): HistoryRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (r): r is HistoryRecord =>
        !!r &&
        typeof r === 'object' &&
        typeof r.id === 'string' &&
        typeof r.command === 'string' &&
        typeof r.cwd === 'string' &&
        Array.isArray(r.ports) &&
        typeof r.lastSeen === 'number',
    )
    .slice(0, HISTORY_MAX);
}

/** Compact age: "45s", "12m", "3h", "2d". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
