import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entriesOf, portsOf, resolveTargets } from '../core/selection';
import type { PortEntry } from '../types';

function entry(port: number, pid: number): PortEntry {
  return { port, pid, addresses: ['127.0.0.1'], group: 'current', isDev: true, elevated: false, lanExposed: false, connections: 0 };
}

test('resolveTargets: clicked inside selection → whole selection; outside → only clicked; none → view selection', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  assert.deepEqual(resolveTargets(a, [a, b], []), [a, b]);
  assert.deepEqual(resolveTargets(c, [a, b], []), [c]);
  assert.deepEqual(resolveTargets(a, [a], []), [a]);
  assert.deepEqual(resolveTargets(a, undefined, [b]), [a]);
  assert.deepEqual(resolveTargets(undefined, undefined, [b, c]), [b, c]);
  // Palette passes a non-node argument (e.g. a port number) → fall back to the view selection.
  assert.deepEqual(resolveTargets<unknown>(3000, undefined, [b]), [b]);
});

test('entriesOf merges port leaves and project groups, one entry per PID', () => {
  const e1 = entry(3000, 10);
  const e2 = entry(3001, 10); // same process, second port
  const e3 = entry(5173, 20);
  const nodes = [
    { kind: 'port' as const, entry: e1 },
    { kind: 'project' as const, entries: [e2, e3] },
    { kind: 'freePinned', port: 8080 },
  ];
  assert.deepEqual(entriesOf(nodes).map((e) => e.pid), [10, 20]);
});

test('portsOf returns distinct ports of port and free pinned nodes', () => {
  const nodes = [
    { kind: 'port', entry: entry(3000, 1) },
    { kind: 'port', entry: entry(3000, 2) },
    { kind: 'freePinned', port: 8080 },
    { kind: 'project' },
  ];
  assert.deepEqual(portsOf(nodes), [3000, 8080]);
});
