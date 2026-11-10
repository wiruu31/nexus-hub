import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.js';
import { createKeyStore } from '../src/core/auth.js';
import { createLimiter } from '../src/core/ratelimit.js';
import { createModuleState } from '../src/core/modules.js';
import { createAdminGuard, createGate, extractKey } from '../src/core/gate.js';
import { HttpError } from '../src/core/errors.js';

const mod = { id: 'notifier', path: 'notify', name: 'N', description: 'D', version: '1', routes() {} };

function setup() {
  const db = openDatabase(':memory:');
  const keys = createKeyStore(db);
  const state = createModuleState(db, [mod]);
  const limiter = createLimiter();
  const gate = createGate({ keys, limiter, state })(mod);
  return { keys, state, gate };
}

const call = async (gate, headers) => {
  const req = { headers };
  const reply = { sent: {}, headers(h) { Object.assign(this.sent, h); return this; } };
  try {
    await gate(req, reply);
    return { ok: true, req, reply };
  } catch (err) {
    assert.ok(err instanceof HttpError, `bukan HttpError: ${err}`);
    return { ok: false, err, req, reply };
  }
};

test('extractKey membaca x-api-key atau Bearer', () => {
  assert.equal(extractKey({ 'x-api-key': ' nxs_a ' }), 'nxs_a');
  assert.equal(extractKey({ authorization: 'Bearer nxs_b' }), 'nxs_b');
  assert.equal(extractKey({ authorization: 'Basic abc' }), null);
  assert.equal(extractKey({}), null);
});

test('gate: tanpa key 401, key asing 401', async () => {
  const { gate } = setup();
  const none = await call(gate, {});
  assert.equal(none.err.status, 401);
  assert.equal(none.err.code, 'api_key_missing');
  assert.equal(none.req.nexus.module, 'notifier');

  const wrong = await call(gate, { 'x-api-key': 'nxs_salah' });
  assert.equal(wrong.err.code, 'api_key_invalid');
});

test('gate: key valid lolos, header rate limit terpasang, last_used_at terisi', async () => {
  const { gate, keys } = setup();
  const { key, secret } = keys.create({ name: 'Bot', rateLimit: 3 });
  const res = await call(gate, { 'x-api-key': secret });
  assert.equal(res.ok, true);
  assert.equal(res.req.nexus.keyId, key.id);
  assert.equal(res.reply.sent['x-ratelimit-limit'], '3');
  assert.equal(res.reply.sent['x-ratelimit-remaining'], '2');
  assert.ok(keys.list()[0].last_used_at);
});

test('gate: key nonaktif 403, scope salah 403, modul mati 503, semuanya mencatat keyId', async () => {
  const { gate, keys, state } = setup();
  const off = keys.create({ name: 'Off' });
  keys.patch(off.key.id, { active: false });
  const disabled = await call(gate, { 'x-api-key': off.secret });
  assert.equal(disabled.err.code, 'api_key_disabled');
  assert.equal(disabled.req.nexus.keyId, off.key.id);

  const narrow = keys.create({ name: 'Sempit', scopes: ['lain'] });
  assert.equal((await call(gate, { 'x-api-key': narrow.secret })).err.code, 'scope_denied');

  const ok = keys.create({ name: 'Ok' });
  state.setEnabled('notifier', false);
  const mati = await call(gate, { 'x-api-key': ok.secret });
  assert.equal(mati.err.status, 503);
  assert.equal(mati.err.code, 'module_disabled');
});

test('gate: melewati batas menghasilkan 429 dengan retry-after dan header limit', async () => {
  const { gate, keys } = setup();
  const { secret } = keys.create({ name: 'Cerewet', rateLimit: 1 });
  assert.equal((await call(gate, { 'x-api-key': secret })).ok, true);
  const second = await call(gate, { 'x-api-key': secret });
  assert.equal(second.err.status, 429);
  assert.equal(second.err.headers['x-ratelimit-remaining'], '0');
  assert.ok(Number(second.err.headers['retry-after']) >= 1);
});

test('adminGuard: token benar lolos, salah 401, setelah 10 salah jadi 429', async () => {
  const guard = createAdminGuard({ token: 'token-admin-panjang-sekali', failLimiter: createLimiter() });
  const run = (token) => guard({ headers: token === undefined ? {} : { 'x-admin-token': token }, ip: '1.2.3.4' });

  await assert.doesNotReject(run('token-admin-panjang-sekali'));
  await assert.rejects(run(undefined), (e) => e.code === 'admin_token_invalid' && /tidak dikirim/.test(e.message));
  await assert.rejects(run('salah'), (e) => e.status === 401 && /salah/.test(e.message));
  for (let i = 0; i < 8; i += 1) await assert.rejects(run('salah'), (e) => e.status === 401);
  await assert.rejects(run('salah'), (e) => e.status === 429 && Boolean(e.headers['retry-after']));
});
