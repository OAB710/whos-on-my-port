import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeStale,
  endReasonOf,
  formatAge,
  historyKey,
  markEnded,
  sanitizeRecords,
  upsertRecord,
  type HistoryRecord,
  type Sighting,
} from '../core/history';

let n = 0;
const newId = () => `id${++n}`;
const sight = (command: string, ports: number[], cwd = 'D:/IT/shop-app'): Sighting => ({
  command, cwd, projectName: 'shop-app', ports, terminalName: 'pwsh',
});

test('historyKey ignores case, slash style and trailing separator of cwd', () => {
  assert.equal(historyKey('npm run dev', 'D:/IT/Shop-App/'), historyKey('npm run dev ', 'd:/it/shop-app'));
  assert.notEqual(historyKey('npm run dev', 'D:/IT/a'), historyKey('npm run dev', 'D:/IT/b'));
});

test('upsert: same run merges ports, a new run moves the record to the top and reopens it', () => {
  let r = upsertRecord([], sight('npm run dev', [3000]), 1000, false, newId);
  assert.equal(r.records.length, 1);
  const id = r.id;
  r = upsertRecord(r.records, sight('npm run dev', [3001]), 2000, true, newId);
  assert.deepEqual(r.records[0].ports, [3000, 3001]);
  assert.equal(r.records[0].lastSeen, 2000);
  assert.equal(r.changed, true);
  r = upsertRecord(r.records, sight('npm run dev', [3000]), 3000, true, newId);
  assert.equal(r.changed, false, 'only lastSeen moved');

  r = upsertRecord(r.records, sight('python app.py', [8000]), 4000, false, newId);
  assert.equal(r.records[0].command, 'python app.py');
  const ended = markEnded(r.records, id, 'stopped', 0, 5000);
  r = upsertRecord(ended, sight('npm run dev', [5173]), 6000, false, newId);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].id, id, 'same command + cwd keeps its id');
  assert.deepEqual(r.records[0].ports, [5173]);
  assert.equal(r.records[0].endedAt, undefined);
  assert.equal(r.records[0].firstSeen, 6000);
});

test('upsert caps the list', () => {
  let recs: HistoryRecord[] = [];
  for (let i = 0; i < 60; i++) recs = upsertRecord(recs, sight(`node s${i}.js`, [3000 + i]), i, false, newId, 50).records;
  assert.equal(recs.length, 50);
  assert.equal(recs[0].command, 'node s59.js');
});

test('markEnded: first reason wins; endReasonOf maps exit codes', () => {
  const { records, id } = upsertRecord([], sight('npm start', [3000]), 1, false, newId);
  const killed = markEnded(records, id, 'killed', undefined, 2);
  const again = markEnded(killed, id, endReasonOf(1), 1, 3);
  assert.equal(again[0].endReason, 'killed');
  assert.equal(again[0].endedAt, 2);
  assert.equal(endReasonOf(0), 'stopped');
  assert.equal(endReasonOf(130), 'crashed');
  assert.equal(endReasonOf(undefined), 'unknown');
});

test('closeStale and sanitizeRecords', () => {
  const { records } = upsertRecord([], sight('npm start', [3000]), 10, false, newId);
  const closed = closeStale(records);
  assert.equal(closed[0].endReason, 'unknown');
  assert.equal(closed[0].endedAt, 10);
  assert.deepEqual(sanitizeRecords(undefined), []);
  assert.deepEqual(sanitizeRecords([{ id: 1 }, null, ...closed]), closed);
});

test('formatAge', () => {
  assert.equal(formatAge(5_000), '5s');
  assert.equal(formatAge(125_000), '2m');
  assert.equal(formatAge(2 * 3_600_000), '2h');
  assert.equal(formatAge(3 * 86_400_000), '3d');
});
