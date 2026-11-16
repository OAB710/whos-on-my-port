import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryWarnings, hasWarning, mergeWarnings, warningBadge } from '../core/warnings';
import type { PortEntry } from '../types';

const now = Date.UTC(2026, 0, 1);
const ft = (msAgo: number) => (now - msAgo + 11_644_473_600_000) * 10_000;
const MB = 1024 * 1024;

function entry(memMb: number, hoursAgo: number): PortEntry {
  return {
    port: 3000, pid: 1, addresses: ['127.0.0.1'], group: 'current', isDev: true, elevated: false, lanExposed: false, connections: 0,
    proc: { pid: 1, ppid: 0, name: 'node.exe', created: ft(hoursAgo * 3_600_000), memBytes: memMb * MB, commandLine: null, exePath: null },
  };
}

test('entryWarnings applies thresholds', () => {
  const th = { memoryWarningMB: 1024, longRunningHours: 8 };
  assert.deepEqual(entryWarnings(entry(100, 1), th, now), {});
  assert.deepEqual(entryWarnings(entry(1500, 1), th, now), { memoryBytes: 1500 * MB });
  assert.deepEqual(entryWarnings(entry(100, 9.5), th, now), { runningHours: 9 });
  const both = entryWarnings(entry(2048, 30), th, now);
  assert.equal(both.memoryBytes, 2048 * MB);
  assert.equal(both.runningHours, 30);
  assert.equal(warningBadge(both), '▲⏱');
});

test('0 disables a threshold', () => {
  const w = entryWarnings(entry(5000, 100), { memoryWarningMB: 0, longRunningHours: 0 }, now);
  assert.equal(hasWarning(w), false);
  assert.equal(warningBadge(w), undefined);
});

test('entries without process info or creation time never warn', () => {
  const e = entry(5000, 100);
  e.proc!.created = 0;
  assert.deepEqual(entryWarnings(e, { memoryWarningMB: 0, longRunningHours: 1 }, now), {});
  assert.deepEqual(entryWarnings({ ...e, proc: undefined }, { memoryWarningMB: 1, longRunningHours: 1 }, now), {});
});

test('badges and merge', () => {
  assert.equal(warningBadge({ memoryBytes: 1 }), '▲');
  assert.equal(warningBadge({ runningHours: 9 }), '⏱');
  assert.deepEqual(mergeWarnings([{ memoryBytes: 5 }, { runningHours: 9 }, { memoryBytes: 7, runningHours: 2 }]), { memoryBytes: 7, runningHours: 9 });
});
