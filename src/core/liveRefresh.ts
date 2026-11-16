// Pure decision logic for the live-refresh loop (no 'vscode' import; unit-tested).
// Each tick runs only the cheap `netstat -ano`; the full scan (netstat + process table)
// runs when the set of listeners changed, or periodically to refresh memory figures.

export const FULL_SCAN_EVERY_MS = 30_000;
export const RENDER_EVERY_MS = 30_000;

/** Order-independent signature of the listening (port, pid) pairs. */
export function socketSignature(sockets: readonly { port: number; pid: number }[]): string {
  return [...new Set(sockets.map((s) => `${s.port}:${s.pid}`))].sort().join(',');
}

export interface TickState {
  now: number;
  /** Signature from this tick's netstat. */
  signature: string;
  /** Signature of the sockets seen by the last full scan (undefined = never scanned). */
  scannedSignature?: string;
  lastFullScanAt?: number;
  lastRenderAt?: number;
}

export type TickAction = 'scan' | 'render' | 'idle';

export function decideTick(
  s: TickState,
  fullScanEveryMs = FULL_SCAN_EVERY_MS,
  renderEveryMs = RENDER_EVERY_MS,
): TickAction {
  if (s.scannedSignature === undefined || s.signature !== s.scannedSignature) return 'scan';
  if (s.lastFullScanAt === undefined || s.now - s.lastFullScanAt >= fullScanEveryMs) return 'scan';
  if (s.lastRenderAt === undefined || s.now - s.lastRenderAt >= renderEveryMs) return 'render';
  return 'idle';
}

/** Clamps the configured interval (seconds) to the supported range and returns milliseconds. */
export function liveIntervalMs(seconds: unknown): number {
  const n = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 2;
  return Math.round(Math.min(60, Math.max(1, n)) * 1000);
}
