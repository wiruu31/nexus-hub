import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/core/config.js';

const TOKEN = 'token-admin-panjang-sekali';

test('loadConfig memakai nilai bawaan saat hanya ADMIN_TOKEN yang diisi', () => {
  const c = loadConfig({ ADMIN_TOKEN: TOKEN });
  assert.equal(c.port, 3000);
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.defaultRateLimit, 60);
  assert.equal(c.logKeepDays, 30);
  assert.equal(c.trustProxy, false);
  assert.deepEqual(c.corsOrigins, []);
  assert.equal(c.telegram.token, '');
  assert.match(c.dbPath, /data[\\/]nexus\.db$/);
});

test('loadConfig membaca env, memecah CORS_ORIGINS, dan menolak nilai buruk', () => {
  const c = loadConfig({ ADMIN_TOKEN: TOKEN, PORT: '8080', CORS_ORIGINS: 'https://a.com, https://b.com ,', TRUST_PROXY: 'true' });
  assert.equal(c.port, 8080);
  assert.deepEqual(c.corsOrigins, ['https://a.com', 'https://b.com']);
  assert.equal(c.trustProxy, true);

  assert.throws(() => loadConfig({ ADMIN_TOKEN: TOKEN, PORT: 'abc' }), /PORT harus/);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: TOKEN, DEFAULT_RATE_LIMIT: '0' }), /DEFAULT_RATE_LIMIT harus/);
});

test('loadConfig menolak ADMIN_TOKEN kosong atau pendek dengan petunjuk npm run token', () => {
  assert.throws(() => loadConfig({}), /npm run token/);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: 'pendek' }), /16 karakter/);
});
