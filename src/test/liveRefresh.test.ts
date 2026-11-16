import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideTick, liveIntervalMs, socketSignature } from '../core/liveRefresh';

test('socketSignature ignores order, duplicates and bind address', () => {
  const a = socketSignature([
    { port: 3000, pid: 10 },
    { port: 5173, pid: 20 },
    { port: 3000, pid: 10 },
  ]);
  const b = socketSignature([
    { port: 5173, pid: 20 },
    { port: 3000, pid: 10 },
  ]);
  assert.equal(a, b);
  assert.notEqual(a, socketSignature([{ port: 3000, pid: 11 }, { port: 5173, pid: 20 }]));
  assert.equal(socketSignature([]), '');
});

test('decideTick scans when listeners changed or never scanned', () => {
  assert.equal(decideTick({ now: 1000, signature: 'a' }), 'scan');
  assert.equal(decideTick({ now: 1000, signature: 'b', scannedSignature: 'a', lastFullScanAt: 900, lastRenderAt: 900 }), 'scan');
});

test('decideTick does a periodic full scan, then render-only, else idle', () => {
  const base = { signature: 'a', scannedSignature: 'a' };
  assert.equal(decideTick({ ...base, now: 31_000, lastFullScanAt: 1_000, lastRenderAt: 30_000 }), 'scan');
  assert.equal(decideTick({ ...base, now: 31_000, lastFullScanAt: 20_000, lastRenderAt: 1_000 }), 'render');
  assert.equal(decideTick({ ...base, now: 31_000, lastFullScanAt: 20_000, lastRenderAt: 20_000 }), 'idle');
  assert.equal(decideTick({ ...base, now: 31_000, lastFullScanAt: 20_000 }), 'render');
});

test('liveIntervalMs clamps to 1..60 s', () => {
  assert.equal(liveIntervalMs(2), 2000);
  assert.equal(liveIntervalMs(0), 1000);
  assert.equal(liveIntervalMs(999), 60000);
  assert.equal(liveIntervalMs('x'), 2000);
  assert.equal(liveIntervalMs(1.5), 1500);
});
