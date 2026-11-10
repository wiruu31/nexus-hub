// Tes ini butuh paket hasil npm install. Tanpa fastify terpasang, tes dilewati.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.js';
import { openDatabase } from '../src/core/database.js';
import { loadModules } from '../src/core/modules.js';

let buildApp = null;
try {
  ({ buildApp } = await import('../src/app.js'));
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

const ADMIN = { 'x-admin-token': 'token-admin-panjang-sekali' };

async function boot(fetchImpl) {
  const config = loadConfig({ ADMIN_TOKEN: 'token-admin-panjang-sekali', TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_CHAT_ID: '7' });
  const mods = await loadModules(fileURLToPath(new URL('../src/modules/', import.meta.url)));
  return buildApp({ config, db: openDatabase(':memory:'), mods, fetchImpl, logger: false });
}

test('alur utama: buat key, kirim notifikasi, log tercatat, modul dimatikan, batas request', { skip: !buildApp }, async (t) => {
  const sent = [];
  const app = await boot(async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  t.after(() => app.close());

  assert.equal((await app.inject({ url: '/admin/summary' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/notify', payload: { message: 'x' } })).statusCode, 401);

  const created = await app.inject({ method: 'POST', url: '/admin/keys', headers: ADMIN, payload: { name: 'Bot', rate_limit: 2 } });
  assert.equal(created.statusCode, 201);
  const { secret } = created.json();
  assert.match(secret, /^nxs_/);

  const keyHeader = { 'x-api-key': secret };
  const ok = await app.inject({ method: 'POST', url: '/v1/notify', headers: keyHeader, payload: { message: 'Halo', title: 'Tes' } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { sent: true });
  assert.equal(sent[0].text, 'Tes\n\nHalo');

  assert.equal((await app.inject({ method: 'POST', url: '/v1/notify', headers: keyHeader, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/notify', headers: keyHeader, payload: { message: 'lagi' } })).statusCode, 429);

  const logs = (await app.inject({ url: '/admin/logs', headers: ADMIN })).json().logs;
  assert.ok(logs.some((l) => l.status === 200 && l.module === 'notifier' && l.key_name === 'Bot'));

  await app.inject({ method: 'PATCH', url: '/admin/modules/notifier', headers: ADMIN, payload: { enabled: false } });
  const off = await app.inject({ method: 'GET', url: '/v1/notify/status', headers: keyHeader });
  assert.equal(off.statusCode, 503);
});

test('dashboard dan docs dilayani, rute asing 404 berbentuk JSON', { skip: !buildApp }, async (t) => {
  const app = await boot(fetch);
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/health' })).json().status, 'ok');
  assert.equal((await app.inject({ url: '/docs/json' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/tidak-ada' })).json().error, 'not_found');
});
