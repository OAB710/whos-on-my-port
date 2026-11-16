import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNetstat, parseProcessJson, splitHostPort } from '../providers/windowsParse';

const NETSTAT_EN = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       14280
  TCP    127.0.0.1:3000         127.0.0.1:52011        ESTABLISHED     14280
  TCP    127.0.0.1:52011        127.0.0.1:3000         ESTABLISHED     9999
  TCP    [::]:3000              [::]:0                 LISTENING       14280
  TCP    [::1]:5173             [::]:0                 LISTENING       200
  TCP    [fe80::1%12]:8080      [::]:0                 LISTENING       300
  UDP    0.0.0.0:5353           *:*                                    400
`;

// German Windows: the state column is translated.
const NETSTAT_DE = `
  Proto  Lokale Adresse         Remoteadresse          Status           PID
  TCP    0.0.0.0:8000           0.0.0.0:0              ABHÖREN         777
  TCP    127.0.0.1:8000         127.0.0.1:60000        HERGESTELLT     777
`;

test('splitHostPort handles IPv4, IPv6 and zone ids', () => {
  assert.deepEqual(splitHostPort('0.0.0.0:135'), { host: '0.0.0.0', port: 135 });
  assert.deepEqual(splitHostPort('[::1]:5173'), { host: '::1', port: 5173 });
  assert.deepEqual(splitHostPort('[fe80::1%12]:8080'), { host: 'fe80::1', port: 8080 });
  assert.equal(splitHostPort('garbage'), undefined);
});

test('parseNetstat finds listeners regardless of locale', () => {
  const en = parseNetstat(NETSTAT_EN);
  assert.deepEqual(
    en.sockets.map((s) => `${s.port}/${s.address}/${s.pid}`),
    ['135/0.0.0.0/1234', '3000/0.0.0.0/14280', '3000/::/14280', '5173/::1/200', '8080/fe80::1/300'],
  );
  assert.equal(en.connections.get('3000:14280'), 1);

  const de = parseNetstat(NETSTAT_DE);
  assert.deepEqual(de.sockets, [{ port: 8000, address: '0.0.0.0', pid: 777 }]);
});

test('parseProcessJson accepts array, single object and empty output', () => {
  const arr = parseProcessJson('[{"i":1,"p":0,"n":"a.exe","c":5,"m":1024,"l":null,"e":null}]');
  assert.equal(arr.get(1)?.name, 'a.exe');
  assert.equal(arr.get(1)?.commandLine, null);

  const single = parseProcessJson('\uFEFF{"i":2,"p":1,"n":"b.exe","c":6,"m":0,"l":"b --x","e":"C:\\\\b.exe"}');
  assert.equal(single.get(2)?.commandLine, 'b --x');

  assert.equal(parseProcessJson('  ').size, 0);
});
