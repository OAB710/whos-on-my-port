import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessProjectPath, mentionsFolder, normalizePath, tokenizeCommandLine } from '../core/pathUtils';
import { findBusyPorts } from '../features/portInUsePatterns';

test('normalizePath', () => {
  assert.equal(normalizePath('D:/Projects/Shop/'), 'd:\\projects\\shop');
  assert.equal(normalizePath('C:\\'), 'c:\\');
});

test('mentionsFolder respects path boundaries', () => {
  const hay = normalizePath('node D:\\app2\\server.js');
  assert.equal(mentionsFolder(hay, 'd:\\app'), false);
  assert.equal(mentionsFolder(hay, 'd:\\app2'), true);
  assert.equal(mentionsFolder(normalizePath('"D:\\app" --x'), 'd:\\app'), true);
});

test('tokenizeCommandLine honours quotes', () => {
  assert.deepEqual(tokenizeCommandLine('"C:\\Program Files\\node.exe" "D:\\My App\\a.js" --port 3'), [
    'C:\\Program Files\\node.exe',
    'D:\\My App\\a.js',
    '--port',
    '3',
  ]);
});

test('guessProjectPath', () => {
  assert.equal(guessProjectPath('node D:\\shop\\node_modules\\.bin\\vite --port 3000'), 'D:\\shop');
  assert.equal(guessProjectPath('python D:\\proj\\manage.py runserver'), 'D:\\proj');
  assert.equal(guessProjectPath('"C:\\Program Files\\nodejs\\node.exe" "D:\\Dự án\\web\\server.js"'), 'D:\\Dự án\\web');
  assert.equal(guessProjectPath('node --root=D:/site/public'), 'D:\\site\\public');
  assert.equal(guessProjectPath('"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev'), undefined);
  assert.equal(guessProjectPath(null), undefined);
});

test('findBusyPorts recognises common frameworks', () => {
  const cases: [string, number][] = [
    ['Error: listen EADDRINUSE: address already in use :::3000', 3000],
    ['\x1b[31mError: listen EADDRINUSE: address already in use 127.0.0.1:5000\x1b[0m', 5000],
    ['Web server failed to start. Port 8080 was already in use.', 8080],
    ["ERROR:    [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000): only one usage", 8000],
    ['Failed to bind to address http://127.0.0.1:5001: address already in use.', 5001],
    ['Port 5000 is in use by another program.', 5000],
  ];
  for (const [line, port] of cases) assert.deepEqual(findBusyPorts(line), [port], line);
});

test('findBusyPorts ignores self-recovering messages', () => {
  assert.deepEqual(findBusyPorts('Port 5173 is in use, trying another one...'), []);
  assert.deepEqual(findBusyPorts('Server running on port 3000'), []);
});

import { formatUptime, iconKey } from '../core/runtime';

test('iconKey picks framework icons from the command line', () => {
  assert.equal(iconKey('node.exe', 'node D:/shop/node_modules/vite/bin/vite.js'), 'vite');
  assert.equal(iconKey('node.exe', 'node D:/shop/node_modules/vitest/vitest.mjs'), 'vitest');
  assert.equal(iconKey('node.exe', 'node D:/web/node_modules/next/dist/bin/next dev'), 'next');
  assert.equal(iconKey('node.exe', 'node server.js'), 'nodejs');
  assert.equal(iconKey('python.exe', 'python manage.py runserver'), 'django');
  assert.equal(iconKey('php.exe', 'php artisan serve'), 'laravel');
  assert.equal(iconKey('mysqld.exe', null), 'database');
  assert.equal(iconKey('agy.exe', null), undefined);
});

test('formatUptime', () => {
  const now = Date.UTC(2026, 0, 1);
  const ft = (msAgo: number) => (now - msAgo + 11_644_473_600_000) * 10_000;
  assert.equal(formatUptime(ft(45_000), now), '45s');
  assert.equal(formatUptime(ft(12 * 60_000), now), '12m');
  assert.equal(formatUptime(ft(3 * 3600_000), now), '3h');
  assert.equal(formatUptime(0, now), undefined);
});
