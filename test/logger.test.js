import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.js';
import { createLogStore, levelFor } from '../src/core/logger.js';
import { createKeyStore } from '../src/core/auth.js';

const entry = (status, extra = {}) => ({ method: 'POST', path: '/v1/notify', status, ms: 4, ...extra });

test('levelFor memetakan status ke level', () => {
  assert.equal(levelFor(200), 'info');
  assert.equal(levelFor(404), 'warn');
  assert.equal(levelFor(429), 'warn');
  assert.equal(levelFor(502), 'error');
});

test('list mengurutkan terbaru dulu, memfilter level, dan memakai cursor before', () => {
  const db = openDatabase(':memory:');
  const logs = createLogStore(db);
  logs.write(entry(200));
  logs.write(entry(401));
  logs.write(entry(500, { message: 'boom' }));
  logs.write(entry(200));

  const all = logs.list();
  assert.equal(all.length, 4);
  assert.ok(all[0].id > all[3].id);

  assert.deepEqual(logs.list({ level: 'warn' }).map((r) => r.status), [401]);
  assert.equal(logs.list({ level: 'error' })[0].message, 'boom');

  const page1 = logs.list({ limit: 2 });
  const page2 = logs.list({ limit: 2, before: page1[1].id });
  assert.equal(page2.length, 2);
  assert.ok(page2[0].id < page1[1].id);
});

test('list menyertakan nama key lewat join, kosong kalau key sudah dihapus', () => {
  const db = openDatabase(':memory:');
  const keys = createKeyStore(db);
  const logs = createLogStore(db);
  const { key } = keys.create({ name: 'Bot Telegram' });

  logs.write(entry(200, { keyId: key.id }));
  assert.equal(logs.list()[0].key_name, 'Bot Telegram');

  keys.remove(key.id);
  const row = logs.list()[0];
  assert.equal(row.key_id, key.id);
  assert.equal(row.key_name, null);
});

test('stats menghitung total dan error sejak waktu tertentu', () => {
  const logs = createLogStore(openDatabase(':memory:'));
  logs.write(entry(200));
  logs.write(entry(500));
  logs.write(entry(404));
  assert.deepEqual({ ...logs.stats('2000-01-01T00:00:00.000Z') }, { total: 3, errors: 1 });
  assert.deepEqual({ ...logs.stats('2999-01-01T00:00:00.000Z') }, { total: 0, errors: 0 });
});

test('prune menghapus log lebih tua dari batas hari', () => {
  const db = openDatabase(':memory:');
  const logs = createLogStore(db);
  logs.write(entry(200));
  db.prepare("UPDATE logs SET ts = '2000-01-01T00:00:00.000Z'").run();
  logs.write(entry(200));
  assert.equal(logs.prune(30), 1);
  assert.equal(logs.list().length, 1);
});

test('path dan message panjang dipotong', () => {
  const logs = createLogStore(openDatabase(':memory:'));
  logs.write(entry(500, { path: `/${'a'.repeat(1000)}`, message: 'm'.repeat(1000) }));
  const row = logs.list()[0];
  assert.equal(row.path.length, 300);
  assert.equal(row.message.length, 500);
});
