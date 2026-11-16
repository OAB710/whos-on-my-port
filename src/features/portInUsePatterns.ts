// "Port already in use" detection patterns. Pure, no 'vscode' import (unit-tested).

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const PATTERNS: RegExp[] = [
  /EADDRINUSE[^\n]*?:(\d{2,5})\b/i, // Node: listen EADDRINUSE: address already in use :::3000
  /address already in use[^\n]*?:(\d{2,5})\b/i,
  /\bport (\d{2,5}) is (?:already )?in use\b(?!, trying)/i,
  /\bPort (\d{2,5}) was already in use/i, // Spring Boot
  /\[Errno (?:98|48|10048)\][^\n]*?(?:', |\]:|:)(\d{2,5})\b/i, // Python / uvicorn: ('127.0.0.1', 8000)
  /Failed to bind to address \S*?:(\d{2,5})\b/i, // ASP.NET Kestrel
  /bind(?:ing)? (?:to )?\S*?:(\d{2,5})[^\n]*?(?:in use|only one usage)/i,
];

/** Lines that mention a busy port but recover on their own (e.g. Vite). */
const IGNORE: RegExp[] = [/trying another one/i, /using port \d+ instead/i];

/**
 * Permission errors when binding (Windows: port inside a range reserved by Hyper-V/WSL/WinNAT,
 * or below 1024 elsewhere). Only reported when a port number can be extracted from the line.
 */
const DENIED_MARKERS: RegExp[] = [
  /\bEACCES\b/, // Node: listen EACCES: permission denied 0.0.0.0:3000
  /\bWinError 10013\b|\bErrno 13\b/i, // Python
  /forbidden by its access permissions/i, // .NET SocketException 10013 / Windows message text
  /\bSocketException \(10013\)/i,
];

/** Where the port sits in a "denied" line, most specific first. */
const DENIED_PORT: RegExp[] = [
  /\(\s*'[^']*',\s*(\d{2,5})\s*\)/, // Python: ('127.0.0.1', 8000)
  /(?:\d{1,3}(?:\.\d{1,3}){3}|\]|localhost|::|\*|\+):(\d{2,5})\b/i, // 0.0.0.0:3000, [::1]:3000, :::3000, http://localhost:5000
  /::[0-9a-f:]*:(\d{2,5})\b/i, // bare IPv6: ::1:5173, fe80::1:3000
  /\bport (\d{2,5})\b/i,
];

export type PortErrorKind = 'inUse' | 'denied';

export interface PortError {
  port: number;
  kind: PortErrorKind;
}

function validPort(s: string | undefined): number | undefined {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}

function deniedPort(line: string): number | undefined {
  if (!DENIED_MARKERS.some((r) => r.test(line))) return undefined;
  for (const re of DENIED_PORT) {
    const port = validPort(re.exec(line)?.[1]);
    if (port) return port;
  }
  return undefined;
}

/** "Port in use" and "permission denied" errors found in a chunk of terminal output (one per port). */
export function findPortErrors(chunk: string): PortError[] {
  const found = new Map<number, PortErrorKind>();
  for (const line of stripAnsi(chunk).split(/\r?\n/)) {
    if (IGNORE.some((r) => r.test(line))) continue;
    const denied = deniedPort(line);
    if (denied) {
      found.set(denied, 'denied');
      continue;
    }
    for (const re of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        const port = validPort(m[1]);
        if (port && !found.has(port)) found.set(port, 'inUse');
        break;
      }
    }
  }
  return [...found].map(([port, kind]) => ({ port, kind }));
}

/** Returns busy ports found in a chunk of terminal output. */
export function findBusyPorts(chunk: string): number[] {
  return findPortErrors(chunk)
    .filter((e) => e.kind === 'inUse')
    .map((e) => e.port);
}
