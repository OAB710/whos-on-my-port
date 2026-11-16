import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mdCell, toMarkdownTable } from '../core/markdownReport';
import type { PortEntry } from '../types';

const now = Date.UTC(2026, 0, 1);
const ft = (msAgo: number) => (now - msAgo + 11_644_473_600_000) * 10_000;

function entry(p: Partial<PortEntry>): PortEntry {
  return { port: 3000, pid: 100, addresses: ['127.0.0.1'], group: 'current', isDev: true, elevated: false, lanExposed: false, connections: 0, ...p };
}

test('toMarkdownTable renders header, separator and rows', () => {
  const md = toMarkdownTable(
    [
      entry({
        proc: { pid: 100, ppid: 1, name: 'node.exe', created: ft(3 * 3600_000), memBytes: 40 * 1024 * 1024, commandLine: 'node a', exePath: null },
        projectName: 'shop',
        terminalPid: 5,
      }),
      entry({ port: 8080, pid: 200, addresses: ['0.0.0.0', '::'], group: 'other', windowLabel: 'api|x' }),
    ],
    undefined,
    now,
  );
  const lines = md.trimEnd().split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '| Port | Process | PID | Project | Memory | Uptime | Bound to | Window |');
  assert.match(lines[1], /^\|( ---:? \|)+$/);
  assert.equal(lines[2], '| 3000 | node.exe | 100 | shop | 40 MB | 3h | 127.0.0.1 | this window |');
  assert.equal(lines[3], '| 8080 |  | 200 |  |  |  | 0.0.0.0, :: | api\\|x |');
});

test('mdCell escapes pipes and newlines', () => {
  assert.equal(mdCell('a|b\nc'), 'a\\|b c');
});
