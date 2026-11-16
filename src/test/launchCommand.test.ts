import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeStale, mergeRecords, recordKilled, type HistoryRecord } from '../core/history';
import { friendlyCommand, launcherOf } from '../core/launchCommand';
import type { ProcInfo } from '../types';

const p = (pid: number, name: string, commandLine: string | null): ProcInfo => ({
  pid, ppid: 0, name, created: pid, memBytes: 0, commandLine, exePath: null,
});

test('friendlyCommand rebuilds what the user typed', () => {
  assert.equal(friendlyCommand('"C:/Program Files/nodejs/node.exe" "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run dev'), 'npm run dev');
  assert.equal(friendlyCommand('node C:/Users/me/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs dev --port 3001'), 'pnpm dev --port 3001');
  assert.equal(friendlyCommand('C:/WINDOWS/system32/cmd.exe /d /s /c "vite --port 5173"'), 'vite --port 5173');
  assert.equal(friendlyCommand('"C:/Program Files/nodejs/node.exe" server.js'), 'node server.js');
  assert.equal(friendlyCommand('D:/proj/.venv/Scripts/python.exe manage.py runserver 8001'), 'D:/proj/.venv/Scripts/python.exe manage.py runserver 8001');
  assert.equal(friendlyCommand('node "D:/My App/server.js"'), 'node "D:/My App/server.js"');
});

test('launcherOf picks the process right under the user shell', () => {
  // node server.js ← cmd /d /s /c (npm script wrapper) ← node npm-cli.js run dev ← pwsh ← Code
  const lineage = [
    p(5, 'node.exe', 'node server.js'),
    p(4, 'cmd.exe', 'C:/WINDOWS/system32/cmd.exe /d /s /c node server.js'),
    p(3, 'node.exe', 'node C:/x/npm-cli.js run dev'),
    p(2, 'pwsh.exe', 'pwsh.exe'),
    p(1, 'Code.exe', 'Code.exe'),
  ];
  assert.equal(launcherOf(lineage)?.pid, 3);
  // Started by an agent: node ← bash -c "…" ← claude
  assert.equal(launcherOf([p(9, 'node.exe', 'node a.js'), p(8, 'bash.exe', 'bash -c "node a.js"'), p(7, 'claude.exe', 'claude')])?.pid, 9);
  // Broken chain (parent gone): top of what we know.
  assert.equal(launcherOf([p(9, 'node.exe', 'node a.js')])?.pid, 9);
});

const rec = (over: Partial<HistoryRecord>): HistoryRecord => ({
  id: 'a', command: 'npm run dev', cwd: 'D:/a', projectName: 'a', ports: [3000], terminalName: '', firstSeen: 1, lastSeen: 1, ...over,
});

test('recordKilled adds an ended record and merges ports killed together', () => {
  let n = 0;
  const id = () => `id${n++}`;
  const s = { command: 'npm run dev', cwd: 'D:/a', projectName: 'a', ports: [4000], terminalName: '' };
  let r = recordKilled([], s, 1000, id);
  assert.equal(r[0].endReason, 'killed');
  r = recordKilled(r, { ...s, ports: [4001] }, 2000, id);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].ports, [4000, 4001]);
  r = recordKilled(r, { ...s, ports: [4000] }, 60_000, id); // later run: fresh record
  assert.deepEqual(r[0].ports, [4000]);
});

test('closeStale keeps runs owned by a live window', () => {
  const out = closeStale([rec({ id: 'x', ownerPid: 10 }), rec({ id: 'y', ownerPid: 11, cwd: 'D:/b' })], (pid) => pid === 10);
  assert.equal(out[0].endedAt, undefined);
  assert.equal(out[1].endReason, 'unknown');
});

test('mergeRecords de-dupes and keeps newest first', () => {
  const out = mergeRecords([rec({ id: '1', lastSeen: 5 })], [rec({ id: '2', lastSeen: 9 }), rec({ id: '3', cwd: 'D:/b', lastSeen: 1 })]);
  assert.deepEqual(out.map((r) => r.id), ['2', '3']);
});
