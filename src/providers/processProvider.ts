import type { KillResult, ListeningSocket, PortRange, ScanResult } from '../types';

/**
 * OS abstraction. v1.0 ships a Windows implementation only; macOS/Linux
 * (lsof / ss / ps) plug in here later without touching the UI.
 */
export interface ProcessProvider {
  /** Full scan: listeners + whole process table. */
  scan(): Promise<ScanResult>;
  /** Cheap check used while waiting for a graceful stop. */
  listeningSockets(): Promise<ListeningSocket[]>;
  /** Force-kill the process and its children. */
  kill(pid: number): Promise<KillResult>;
  /** Same as kill, through an elevation (UAC) prompt. */
  killElevated(pid: number): Promise<KillResult>;
  /** TCP port ranges reserved by the OS (Windows excludedportrange). Cached; call only when needed. */
  reservedPortRanges?(): Promise<PortRange[]>;
}

export async function createProvider(): Promise<ProcessProvider | undefined> {
  if (process.platform === 'win32') {
    const { WindowsProvider } = await import('./windowsProvider');
    return new WindowsProvider();
  }
  return undefined;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
