import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.js';
import { createKeyStore, generateKey, hashKey, normalizeScopes, safeEqual } from '../src/core/auth.js';
import { HttpError } from '../src/core/errors.js';

const fresh = () => createKeyStore(openDatabase(':memory:'), { defaultRateLimit: 60 });

test('generateKey memakai prefix nxs_ dan tidak pernah kembar', () => {
  const a = generateKey();
  assert.match(a, /^nxs_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, generateKey());
});

test('hashKey stabil dan berbeda untuk input berbeda', () => {
  assert.equal(hashKey('abc'), hashKey('abc'));
  assert.notEqual(hashKey('abc'), hashKey('abd'));
  assert.equal(hashKey('abc').length, 64);
});

test('safeEqual membandingkan nilai, bukan panjang', () => {
  assert.equal(safeEqual('rahasia', 'rahasia'), true);
  assert.equal(safeEqual('rahasia', 'rahasiA'), false);
  assert.equal(safeEqual('a', 'panjang sekali'), false);
});

test('normalizeScopes: bawaan semua modul, tanda * menang, input buruk ditolak', () => {
  assert.deepEqual(normalizeScopes(undefined), ['*']);
  assert.deepEqual(normalizeScopes(['notifier', '*']), ['*']);
  assert.deepEqual(normalizeScopes(['notifier', 'notifier']), ['notifier']);
  assert.throws(() => normalizeScopes([]), HttpError);
  assert.throws(() => normalizeScopes(['Ada Spasi']), HttpError);
});

test('create mengembalikan secret sekali, database hanya menyimpan hash', () => {
  const db = openDatabase(':memory:');
  const keys = createKeyStore(db);
  const { key, secret } = keys.create({ name: 'Bot Telegram', scopes: ['notifier'], rateLimit: 5 });

  assert.equal(key.name, 'Bot Telegram');
  assert.equal(key.rate_limit, 5);
  assert.deepEqual(key.scopes, ['notifier']);
  assert.equal(key.prefix, secret.slice(0, 8));
  assert.equal('key_hash' in key, false);

  const stored = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(key.id);
  assert.equal(stored.key_hash, hashKey(secret));
  assert.equal(JSON.stringify(stored).includes(secret), false);
});

test('verify menerima key asli dan menolak sisanya', () => {
  const keys = fresh();
  const { key, secret } = keys.create({ name: 'Web' });
  assert.equal(keys.verify(secret).id, key.id);
  assert.equal(keys.verify(`${secret}x`), null);
  assert.equal(keys.verify('nxs_tidakada'), null);
  assert.equal(keys.verify('tanpa-prefix'), null);
  assert.equal(keys.verify(undefined), null);
  assert.equal(keys.verify(`nxs_${'a'.repeat(300)}`), null);
});

test('rate limit bawaan dipakai kalau tidak diisi, nama kosong ditolak', () => {
  const keys = fresh();
  assert.equal(keys.create({ name: 'A' }).key.rate_limit, 60);
  assert.throws(() => keys.create({ name: '   ' }), HttpError);
  assert.throws(() => keys.create({ name: 'x'.repeat(61) }), HttpError);
});

test('allows memeriksa scope', () => {
  const keys = fresh();
  const wide = keys.create({ name: 'Semua' }).key;
  const narrow = keys.create({ name: 'Sempit', scopes: ['notifier'] }).key;
  assert.equal(keys.allows(wide, 'apa-saja'), true);
  assert.equal(keys.allows(narrow, 'notifier'), true);
  assert.equal(keys.allows(narrow, 'storage'), false);
});

test('patch mengubah sebagian field dan menjaga sisanya', () => {
  const keys = fresh();
  const { key } = keys.create({ name: 'Lama', rateLimit: 10 });
  const next = keys.patch(key.id, { active: false });
  assert.equal(next.active, false);
  assert.equal(next.name, 'Lama');
  assert.equal(next.rate_limit, 10);
  assert.equal(keys.patch(key.id, { name: 'Baru', rate_limit: 99, scopes: ['notifier'] }).name, 'Baru');
  assert.equal(keys.patch(9999, { active: true }), null);
});

test('remove menghapus key dan verify gagal sesudahnya', () => {
  const keys = fresh();
  const { key, secret } = keys.create({ name: 'Sementara' });
  assert.equal(keys.remove(key.id), true);
  assert.equal(keys.remove(key.id), false);
  assert.equal(keys.verify(secret), null);
});

test('markUsed mengisi last_used_at', () => {
  const keys = fresh();
  const { key } = keys.create({ name: 'Dipakai' });
  assert.equal(keys.list()[0].last_used_at, null);
  keys.markUsed(key.id);
  assert.match(keys.list()[0].last_used_at, /^\d{4}-\d{2}-\d{2}T/);
});
