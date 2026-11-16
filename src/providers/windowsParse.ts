// Pure parsers for Windows command output. No 'vscode' import (unit-tested).
import type { ListeningSocket, ProcInfo } from '../types';

export interface NetstatResult {
  sockets: ListeningSocket[];
  /** Non-listening connections per "port:pid". */
  connections: Map<string, number>;
}

/** Splits "1.2.3.4:80" / "[::1]:80" into host + port. Returns undefined on garbage. */
export function splitHostPort(s: string): { host: string; port: number } | undefined {
  const idx = s.lastIndexOf(':');
  if (idx <= 0) return undefined;
  let host = s.slice(0, idx);
  const port = Number(s.slice(idx + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);
  return { host, port };
}

const WILDCARD_REMOTE = new Set(['0.0.0.0', '::', '*']);

/**
 * Parses `netstat -ano` output. Locale-independent: the state column is ignored
 * (it is translated on non-English Windows); a socket is LISTENING when its remote
 * address is the wildcard with port 0.
 */
export function parseNetstat(text: string): NetstatResult {
  const sockets: ListeningSocket[] = [];
  const connections = new Map<string, number>();
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (t.length < 5 || t[0].toUpperCase() !== 'TCP') continue;
    const local = splitHostPort(t[1]);
    const remote = splitHostPort(t[2]);
    const pid = Number(t[t.length - 1]);
    if (!local || !remote || !Number.isInteger(pid)) continue;

    if (WILDCARD_REMOTE.has(remote.host) && remote.port === 0) {
      const key = `${local.port}|${local.host}|${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sockets.push({ port: local.port, address: local.host, pid });
    } else if (pid > 0) {
      const key = `${local.port}:${pid}`;
      connections.set(key, (connections.get(key) ?? 0) + 1);
    }
  }
  return { sockets, connections };
}

interface RawProc {
  i?: number; p?: number; n?: string | null; c?: number | null;
  m?: number | null; l?: string | null; e?: string | null;
}

/** Parses the compact JSON emitted by PROCESS_QUERY_PS (array, single object or empty). */
export function parseProcessJson(text: string): Map<number, ProcInfo> {
  const map = new Map<number, ProcInfo>();
  const trimmed = text.trim().replace(/^﻿/, '');
  if (!trimmed) return map;
  const parsed: unknown = JSON.parse(trimmed);
  const arr: RawProc[] = Array.isArray(parsed) ? parsed : parsed ? [parsed as RawProc] : [];
  for (const r of arr) {
    if (typeof r?.i !== 'number') continue;
    map.set(r.i, {
      pid: r.i,
      ppid: typeof r.p === 'number' ? r.p : 0,
      name: r.n ?? '',
      created: typeof r.c === 'number' ? r.c : 0,
      memBytes: typeof r.m === 'number' ? r.m : 0,
      commandLine: r.l ?? null,
      exePath: r.e ?? null,
    });
  }
  return map;
}

/**
 * PowerShell script listing ALL processes in one CIM query. Short keys keep the
 * JSON small (~300 processes). CreationDate is converted to FILETIME so it survives
 * JSON serialisation on PowerShell 5.1.
 */
export const PROCESS_QUERY_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ProgressPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  '$r=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,WorkingSetSize,CommandLine,ExecutablePath | ForEach-Object {' +
    "[pscustomobject]@{i=[int]$_.ProcessId;p=[int]$_.ParentProcessId;n=$_.Name;" +
    'c=$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0});' +
    'm=[int64]$_.WorkingSetSize;l=$_.CommandLine;e=$_.ExecutablePath}}',
  'ConvertTo-Json -InputObject @($r) -Compress -Depth 2',
].join(';');

/** Encodes a script for `powershell -EncodedCommand` (UTF-16LE base64). */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
