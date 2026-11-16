import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lanAddresses, lanUrls, type NetIfMap } from '../core/lanUrl';
import { qrMatrix, qrSvg } from '../core/qrSvg';

const IFACES: NetIfMap = {
  'vEthernet (WSL (Hyper-V firewall))': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
  'Wi-Fi': [
    { address: 'fe80::1', family: 'IPv6', internal: false },
    { address: '192.168.1.23', family: 'IPv4', internal: false },
  ],
  'Ethernet 2': [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
  'VirtualBox Host-Only Network': [{ address: '192.168.56.1', family: 4, internal: false }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  Ethernet: [{ address: '10.0.0.5', family: 4, internal: false }],
};

test('lanAddresses: IPv4 only, skips internal and link-local, physical adapters first', () => {
  assert.deepEqual(
    lanAddresses(IFACES).map((a) => [a.address, a.virtual]),
    [
      ['192.168.1.23', false],
      ['10.0.0.5', false],
      ['172.20.0.1', true],
      ['192.168.56.1', true],
    ],
  );
});

test('lanUrls for wildcard, specific and loopback binds', () => {
  assert.deepEqual(
    lanUrls(3000, ['0.0.0.0', '::'], IFACES).map((u) => u.url),
    ['http://192.168.1.23:3000', 'http://10.0.0.5:3000', 'http://172.20.0.1:3000', 'http://192.168.56.1:3000'],
  );
  assert.deepEqual(lanUrls(5173, ['::'], IFACES)[0].url, 'http://192.168.1.23:5173');
  const specific = lanUrls(8000, ['192.168.1.23'], IFACES);
  assert.deepEqual(specific.map((u) => [u.url, u.iface]), [['http://192.168.1.23:8000', 'Wi-Fi']]);
  assert.deepEqual(lanUrls(8000, ['127.0.0.1', '::1'], IFACES), []);
  assert.deepEqual(lanUrls(8000, ['0.0.0.0'], {}), []);
});

/** 7x7 finder pattern with its top-left corner at (x, y). */
function assertFinder(m: boolean[][], x: number, y: number): void {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      assert.equal(m[y + dy][x + dx], ring !== 2, `finder at ${x},${y} module ${dx},${dy}`);
    }
  }
}

test('qrMatrix: version 2 (25x25) for a short LAN URL, with three finder patterns and timing lines', () => {
  const m = qrMatrix('http://192.168.1.23:5173');
  assert.equal(m.length, 25);
  assert.ok(m.every((row) => row.length === 25));
  assertFinder(m, 0, 0);
  assertFinder(m, 25 - 7, 0);
  assertFinder(m, 0, 25 - 7);
  // Separator around the top-left finder is light.
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], false);
    assert.equal(m[i][7], false);
  }
  // Timing patterns alternate between the finders.
  for (let i = 8; i < 25 - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
  // Dark module next to the bottom-left finder.
  assert.equal(m[25 - 8][8], true);
});

test('qrMatrix grows with the payload; qrSvg produces a standalone SVG', () => {
  assert.equal(qrMatrix('http://192.168.100.200:65535/some/longer/path?x=1').length, 33); // version 4
  const svg = qrSvg('http://10.0.0.5:3000', 'http://10.0.0.5:3000 & more');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /&amp; more<\/text>/);
  assert.match(svg.trimEnd(), /<\/svg>$/);
});
