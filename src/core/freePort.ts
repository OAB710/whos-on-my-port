// Free-port search for "Check / Find Free Port…". Pure, no 'vscode' import (unit-tested).
import type { PortRange } from '../types';
import { isReserved } from './reservedPorts';

export type PortStatus =
  | { kind: 'free' }
  | { kind: 'busy' }
  | { kind: 'reserved'; range: PortRange }
  | { kind: 'invalid' };

export function parsePortInput(s: string): number | undefined {
  const t = s.trim().replace(/^:/, '');
  if (!/^\d{1,5}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 65535 ? n : undefined;
}

export function portStatus(port: number, busy: ReadonlySet<number>, reserved: readonly PortRange[]): PortStatus {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { kind: 'invalid' };
  if (busy.has(port)) return { kind: 'busy' };
  const range = isReserved(port, reserved);
  if (range) return { kind: 'reserved', range };
  return { kind: 'free' };
}

/**
 * Nearest port ≥ `from` (then below it, down to `min`) that nobody listens on and Windows has not
 * reserved. Returns undefined when the whole range is taken (practically never).
 */
export function nearestFreePort(
  from: number,
  busy: ReadonlySet<number>,
  reserved: readonly PortRange[],
  min = 1024,
  max = 65535,
): number | undefined {
  const ok = (p: number) => portStatus(p, busy, reserved).kind === 'free';
  for (let p = Math.max(from, 1); p <= max; p++) if (ok(p)) return p;
  for (let p = Math.min(from, max) - 1; p >= min; p--) if (ok(p)) return p;
  return undefined;
}

/** Common dev ports shown when the input is empty. */
export const COMMON_DEV_PORTS = [3000, 4200, 5000, 5173, 8000, 8080] as const;
