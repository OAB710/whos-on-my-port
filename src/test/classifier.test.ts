import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ancestry, classify, type ClassifyContext } from '../core/classifier';
import { buildDevSet } from '../core/safety';
import type { ProcInfo, ScanResult } from '../types';

function proc(pid: number, ppid: number, name: string, created: number, commandLine: string | null = name): ProcInfo {
  return { pid, ppid, name, created, memBytes: 50 * 1024 * 1024, commandLine, exePath: null };
}

// Process tree:
//  1 wininit  →  10 Code.exe (main) → 11 Code.exe (ext host = self)
//                                    → 20 pwsh (terminal of THIS window) → 21 node (vite, :5173)
//                                    → 30 pwsh (terminal of OTHER window) → 31 node (:3000)
//  41 node (:4000) parent 40 is dead → orphan in known folder
//  51 node (:4500) parent 50 reused by a younger process → broken, but unknown folder → other
//  60 python (:8000) no terminal, path in current folder → current
//  70 svchost (:135) → system/blocked
//  80 com.docker.backend (:8080) → blocked docker
const procs = new Map<number, ProcInfo>(
  [
    proc(1, 0, 'wininit.exe', 1),
    proc(10, 1, 'Code.exe', 10),
    proc(11, 10, 'Code.exe', 11),
    proc(20, 10, 'pwsh.exe', 20),
    proc(21, 20, 'node.exe', 21, 'node D:\\Projects\\Shop\\node_modules\\vite\\bin\\vite.js'),
    proc(30, 10, 'pwsh.exe', 30),
    proc(31, 30, 'node.exe', 31, 'node server.js'),
    proc(41, 40, 'node.exe', 41, '"C:\\Program Files\\nodejs\\node.exe" D:\\Projects\\Old\\index.js'),
    proc(50, 1, 'notepad.exe', 999),
    proc(51, 50, 'node.exe', 51, 'node C:\\tmp\\x\\srv.js'),
    proc(60, 1, 'python.exe', 60, 'python D:\\Projects\\Shop\\api\\manage.py runserver'),
    proc(70, 1, 'svchost.exe', 70, null),
    proc(80, 1, 'com.docker.backend.exe', 80),
  ].map((p) => [p.pid, p]),
);

const scan: ScanResult = {
  sockets: [
    { port: 5173, address: '::1', pid: 21 },
    { port: 5173, address: '127.0.0.1', pid: 21 },
    { port: 3000, address: '0.0.0.0', pid: 31 },
    { port: 4000, address: '127.0.0.1', pid: 41 },
    { port: 4500, address: '127.0.0.1', pid: 51 },
    { port: 8000, address: '127.0.0.1', pid: 60 },
    { port: 135, address: '0.0.0.0', pid: 70 },
    { port: 8080, address: '0.0.0.0', pid: 80 },
    { port: 9999, address: '127.0.0.1', pid: 12345 },
  ],
  procs,
  connections: new Map([['5173:21', 2]]),
  at: 0,
  durationMs: 0,
};

const ctx: ClassifyContext = {
  currentFolders: ['d:/projects/shop/'],
  currentTerminalPids: new Set([20]),
  otherWindows: [{ label: 'landing-page', folders: ['D:\\Projects\\Landing'], terminalPids: [30] }],
  knownFolders: ['D:\\Projects\\Shop', 'D:\\Projects\\Old'],
  devNames: buildDevSet([]),
  selfPid: 11,
};

const entries = classify(scan, ctx);
const byPort = (p: number) => entries.find((e) => e.port === p)!;

test('IPv4 + IPv6 of the same (port, pid) collapse into one row', () => {
  assert.equal(entries.filter((e) => e.port === 5173).length, 1);
  assert.deepEqual(byPort(5173).addresses.sort(), ['127.0.0.1', '::1']);
  assert.equal(byPort(5173).connections, 2);
});

test('terminal of this window → current, with terminalPid', () => {
  const e = byPort(5173);
  assert.equal(e.group, 'current');
  assert.equal(e.terminalPid, 20);
  assert.equal(e.terminalChildPid, 21);
  assert.equal(e.projectName, 'shop');
  assert.equal(e.lanExposed, false);
});

test('terminal of another window → other, labelled with that window', () => {
  const e = byPort(3000);
  assert.equal(e.group, 'other');
  assert.equal(e.windowLabel, 'landing-page');
  assert.equal(e.lanExposed, true);
});

test('path fallback → current', () => {
  assert.equal(byPort(8000).group, 'current');
});

test('dead parent + known folder → orphan', () => {
  const e = byPort(4000);
  assert.equal(e.group, 'orphan');
  assert.equal(e.projectName, 'Old');
});

test('reused parent PID is detected as broken lineage', () => {
  assert.equal(ancestry(51, procs).broken, true);
  // Unknown folder → not an orphan, just another dev project.
  assert.equal(byPort(4500).group, 'other');
  assert.equal(byPort(4500).projectName, 'x');
});

test('system, docker and exited processes are blocked', () => {
  assert.equal(byPort(135).group, 'system');
  assert.equal(byPort(135).blocked, 'system');
  assert.equal(byPort(8080).blocked, 'docker');
  assert.equal(byPort(9999).blocked, 'exited');
});

test('editor processes are blocked', () => {
  const s: ScanResult = { ...scan, sockets: [{ port: 9229, address: '127.0.0.1', pid: 10 }] };
  assert.equal(classify(s, ctx)[0].blocked, 'editor');
});

test('elevated = present but command line unreadable', () => {
  assert.equal(byPort(135).elevated, true);
  assert.equal(byPort(5173).elevated, false);
});

test('extension tooling (e.g. agy.exe spawned by the extension host) is not a project port', () => {
  const p = new Map(procs);
  p.set(90, proc(90, 11, 'agy.exe', 90, 'C:/Users/me/.gemini/bin/agy.exe --hub --add-dir=d:/projects/shop'));
  p.set(91, proc(91, 11, 'node.exe', 91, 'node c:/users/me/.vscode/extensions/x.eslint/server.js D:/Projects/Shop'));
  const s: ScanResult = { ...scan, procs: p, sockets: [{ port: 58455, address: '127.0.0.1', pid: 90 }, { port: 6009, address: '127.0.0.1', pid: 91 }] };
  const out = classify(s, ctx);
  assert.deepEqual(out.map((e) => e.group), ['extension', 'extension']);
});

test('terminal of a VS Code window without this extension → other, unregistered window', () => {
  const p = new Map(procs);
  p.set(100, proc(100, 10, 'powershell.exe', 100));
  p.set(101, proc(101, 100, 'node.exe', 101, 'node server.js'));
  const s: ScanResult = { ...scan, procs: p, sockets: [{ port: 4000, address: '127.0.0.1', pid: 101 }] };
  const e = classify(s, ctx)[0];
  assert.equal(e.group, 'other');
  assert.equal(e.unregisteredWindow, true);
});

test('terminal cwd names the project for relative commands (multi-root)', () => {
  const p = new Map(procs);
  p.set(110, proc(110, 20, 'node.exe', 110, 'node server.js'));
  const s: ScanResult = { ...scan, procs: p, sockets: [{ port: 3000, address: '127.0.0.1', pid: 110 }] };
  const e = classify(s, { ...ctx, currentFolders: ['D:/pg/shop-app', 'D:/pg/api'], currentTerminalCwds: new Map([[20, 'D:/pg/api/src']]) })[0];
  assert.equal(e.group, 'current');
  assert.equal(e.projectName, 'api');
});

test('dev server launched by an AI agent extension is a project, not extension tooling', () => {
  const p = new Map(procs);
  p.set(120, proc(120, 11, 'claude.exe', 120));
  p.set(121, proc(121, 120, 'bash.exe', 121));
  p.set(122, proc(122, 121, 'node.exe', 122, 'node D:/Projects/Landing/server.js'));
  const s: ScanResult = { ...scan, procs: p, sockets: [{ port: 5173, address: '0.0.0.0', pid: 122 }] };
  const e = classify(s, { ...ctx, otherWindows: [] })[0];
  assert.equal(e.group, 'other');
  assert.equal(e.projectName, 'Landing');
});
