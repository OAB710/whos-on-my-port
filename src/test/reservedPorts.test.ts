import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRange, isReserved, mergePortRanges, parseExcludedPortRanges } from '../core/reservedPorts';
import { findBusyPorts, findPortErrors } from '../features/portInUsePatterns';

const EN = `
Protocol tcp Port Exclusion Ranges

Start Port    End Port
----------    --------
      2980        3079
      5357        5357
     50000       50059     *

* - Administered port exclusions.
`;

// Localized header (German); only the numeric rows matter.
const DE = `
Protokoll tcp Portausschlussbereiche

Startport    Endport
----------    --------
      1080        1080
     2980        3079

* - Verwaltete Portausschlüsse.
`;

test('parseExcludedPortRanges reads numeric rows and the * marker', () => {
  assert.deepEqual(parseExcludedPortRanges(EN), [
    { start: 2980, end: 3079, administered: false },
    { start: 5357, end: 5357, administered: false },
    { start: 50000, end: 50059, administered: true },
  ]);
  assert.deepEqual(parseExcludedPortRanges('\r\nnothing here\r\n'), []);
  assert.deepEqual(parseExcludedPortRanges('  70000 70001\n  10 5\n'), []);
});

test('mergePortRanges de-duplicates IPv4 + IPv6 and sorts', () => {
  const merged = mergePortRanges(parseExcludedPortRanges(EN), parseExcludedPortRanges(DE));
  assert.deepEqual(
    merged.map((r) => [r.start, r.end, r.administered]),
    [[1080, 1080, false], [2980, 3079, false], [5357, 5357, false], [50000, 50059, true]],
  );
});

test('isReserved finds the containing range (inclusive)', () => {
  const ranges = parseExcludedPortRanges(EN);
  assert.equal(isReserved(3000, ranges)?.start, 2980);
  assert.equal(isReserved(2980, ranges)?.end, 3079);
  assert.equal(isReserved(3079, ranges)?.end, 3079);
  assert.equal(isReserved(3080, ranges), undefined);
  assert.equal(formatRange(ranges[0]), '2980–3079');
  assert.equal(formatRange(ranges[1]), '5357');
});

test('findPortErrors recognises permission-denied binds', () => {
  const cases: [string, number][] = [
    ['Error: listen EACCES: permission denied 0.0.0.0:3000', 3000],
    ['Error: listen EACCES: permission denied :::4200', 4200],
    ['Error: listen EACCES: permission denied ::1:5173', 5173],
    ["ERROR:    [Errno 13] error while attempting to bind on address ('127.0.0.1', 8000): [winerror 10013] an attempt was made to access a socket in a way forbidden by its access permissions", 8000],
    ['OSError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions: 127.0.0.1:5000', 5000],
    ['Failed to bind to address http://127.0.0.1:5050: An attempt was made to access a socket in a way forbidden by its access permissions.', 5050],
  ];
  for (const [line, port] of cases) assert.deepEqual(findPortErrors(line), [{ port, kind: 'denied' }], line);
});

test('permission errors without a port are ignored; in-use errors keep their kind', () => {
  assert.deepEqual(findPortErrors('OSError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions'), []);
  assert.deepEqual(findPortErrors('System.Net.Sockets.SocketException (10013): An attempt was made to access a socket in a way forbidden by its access permissions.'), []);
  assert.deepEqual(findPortErrors('Error: listen EADDRINUSE: address already in use :::3000'), [{ port: 3000, kind: 'inUse' }]);
  assert.deepEqual(findBusyPorts('Error: listen EACCES: permission denied 0.0.0.0:3000'), []);
});
