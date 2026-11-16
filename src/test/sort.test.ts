import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortEntries, toSortBy } from '../core/sort';
import type { PortEntry } from '../types';

function entry(port: number, pid: number, name?: string, memMb?: number, created?: number): PortEntry {
  return {
    port, pid, addresses: ['127.0.0.1'], group: 'current', isDev: true, elevated: false, lanExposed: false, connections: 0,
    proc: name === undefined ? undefined : { pid, ppid: 0, name, created: created ?? 0, memBytes: (memMb ?? 0) * 1048576, commandLine: null, exePath: null },
  };
}

const a = entry(5173, 1, 'node.exe', 300, 300);
const b = entry(3000, 2, 'Python.exe', 50, 100);
const c = entry(8080, 3, 'java.exe', 900, 0); // created unknown
const d = entry(4000, 4); // exited: no proc info
const ports = (list: PortEntry[]) => list.map((e) => e.port);

test('sort by port (default) is ascending with PID tiebreak', () => {
  const twin = entry(3000, 1, 'node.exe');
  assert.deepEqual(sortEntries([a, b, c, d, twin], 'port').map((e) => `${e.port}/${e.pid}`), ['3000/1', '3000/2', '4000/4', '5173/1', '8080/3']);
});

test('sort by memory: biggest first, unknown last', () => {
  assert.deepEqual(ports(sortEntries([a, b, c, d], 'memory')), [8080, 5173, 3000, 4000]);
});

test('sort by uptime: longest running first, unknown last (by port)', () => {
  assert.deepEqual(ports(sortEntries([a, b, c, d], 'uptime')), [3000, 5173, 4000, 8080]);
});

test('sort by name: case-insensitive A–Z, no name last', () => {
  assert.deepEqual(ports(sortEntries([a, b, c, d], 'name')), [8080, 5173, 3000, 4000]);
});

test('toSortBy falls back to port', () => {
  assert.equal(toSortBy('memory'), 'memory');
  assert.equal(toSortBy('nope'), 'port');
  assert.equal(toSortBy(undefined), 'port');
});
