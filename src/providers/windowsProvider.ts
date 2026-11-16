import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { mergePortRanges, parseExcludedPortRanges } from '../core/reservedPorts';
import type { KillResult, ListeningSocket, PortRange, ScanResult } from '../types';
import { isAlive, type ProcessProvider } from './processProvider';
import { encodePowerShell, parseNetstat, parseProcessJson, PROCESS_QUERY_PS } from './windowsParse';

const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows';
const NETSTAT = path.join(SYSTEM_ROOT, 'System32', 'NETSTAT.EXE');
const NETSH = path.join(SYSTEM_ROOT, 'System32', 'netsh.exe');
const RESERVED_TTL_MS = 60_000;
const TASKKILL = path.join(SYSTEM_ROOT, 'System32', 'taskkill.exe');
const POWERSHELL = path.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

function run(file: string, args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // On a non-zero exit, execFile sets err.code to the numeric exit code.
        const exit = (err as { code?: unknown } | null)?.code;
        const code = err ? (typeof exit === 'number' ? exit : 1) : 0;
        resolve({ stdout: stdout ?? '', stderr: stderr || (err ? String(err.message) : ''), code });
      },
    );
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WindowsProvider implements ProcessProvider {
  private reserved?: { at: number; ranges: Promise<PortRange[]> };

  /** netsh excludedportrange for IPv4 + IPv6, cached for a minute. Never part of a regular scan. */
  reservedPortRanges(): Promise<PortRange[]> {
    if (this.reserved && Date.now() - this.reserved.at < RESERVED_TTL_MS) return this.reserved.ranges;
    const ranges = Promise.all(
      ['ipv4', 'ipv6'].map((ip) => run(NETSH, ['interface', ip, 'show', 'excludedportrange', 'protocol=tcp'], 5000)),
    ).then((rs) => mergePortRanges(...rs.map((r) => parseExcludedPortRanges(r.stdout))));
    this.reserved = { at: Date.now(), ranges };
    return ranges;
  }

  async scan(): Promise<ScanResult> {
    const t0 = Date.now();
    // Run both in parallel: netstat (~100 ms) and one CIM query (~300-800 ms).
    const [net, ps] = await Promise.all([
      run(NETSTAT, ['-ano']),
      run(POWERSHELL, [...PS_ARGS, '-EncodedCommand', encodePowerShell(PROCESS_QUERY_PS)]),
    ]);
    if (net.code !== 0 && !net.stdout) {
      throw new Error(`netstat failed: ${net.stderr.trim()}`);
    }
    const { sockets, connections } = parseNetstat(net.stdout);

    let procs;
    try {
      procs = parseProcessJson(ps.stdout);
    } catch (e) {
      throw new Error(`Process query failed (PowerShell may be blocked by policy): ${ps.stderr.trim() || String(e)}`);
    }
    if (procs.size === 0) {
      throw new Error(`Process query returned nothing (PowerShell may be blocked by policy): ${ps.stderr.trim()}`);
    }
    return { sockets, connections, procs, at: Date.now(), durationMs: Date.now() - t0 };
  }

  async listeningSockets(): Promise<ListeningSocket[]> {
    const net = await run(NETSTAT, ['-ano'], 5000);
    return parseNetstat(net.stdout).sockets;
  }

  async kill(pid: number): Promise<KillResult> {
    const r = await run(TASKKILL, ['/F', '/T', '/PID', String(pid)], 10000);
    await delay(200);
    const stillAlive = isAlive(pid);
    return { ok: !stillAlive, stillAlive, message: (r.stderr || r.stdout).trim() };
  }

  async killElevated(pid: number): Promise<KillResult> {
    const script = [
      "$ErrorActionPreference='Stop'",
      `Start-Process -FilePath '${TASKKILL.replace(/'/g, "''")}' -ArgumentList '/F','/T','/PID','${pid}' -Verb RunAs -WindowStyle Hidden -Wait`,
    ].join(';');
    const r = await run(POWERSHELL, [...PS_ARGS, '-EncodedCommand', encodePowerShell(script)], 120000);
    await delay(200);
    const stillAlive = isAlive(pid);
    return { ok: !stillAlive, stillAlive, message: r.code !== 0 ? r.stderr.trim() : undefined };
  }
}
