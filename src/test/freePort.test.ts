import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearestFreePort, parsePortInput, portStatus } from '../core/freePort';

const reserved = [{ start: 3005, end: 3010, administered: false }];

test('parsePortInput', () => {
  assert.equal(parsePortInput('3000'), 3000);
  assert.equal(parsePortInput(' :5173 '), 5173);
  assert.equal(parsePortInput('0'), undefined);
  assert.equal(parsePortInput('70000'), undefined);
  assert.equal(parsePortInput('abc'), undefined);
});

test('portStatus distinguishes free, busy and reserved', () => {
  const busy = new Set([3000]);
  assert.equal(portStatus(3000, busy, reserved).kind, 'busy');
  assert.equal(portStatus(3007, busy, reserved).kind, 'reserved');
  assert.equal(portStatus(3001, busy, reserved).kind, 'free');
});

test('nearestFreePort skips busy and Windows-reserved ports', () => {
  const busy = new Set([3000, 3001, 3002, 3003, 3004]);
  assert.equal(nearestFreePort(3000, busy, reserved), 3011);
  assert.equal(nearestFreePort(4000, new Set(), []), 4000);
  // Top of the range taken: search downwards.
  assert.equal(nearestFreePort(65535, new Set([65535]), []), 65534);
});
