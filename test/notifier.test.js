import test from 'node:test';
import assert from 'node:assert/strict';
import notifierModule, { createNotifier } from '../src/modules/notifier/index.js';
import { HttpError } from '../src/core/errors.js';

const TOKEN = '123456:RAHASIA-TOKEN-BOT';

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return reply;
  };
  impl.calls = calls;
  return impl;
}

const telegram = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

test('send memanggil sendMessage dengan chat id, judul, dan isi pesan', async () => {
  const fetchImpl = fakeFetch(telegram(200, { ok: true }));
  const n = createNotifier({ token: TOKEN, chatId: '42', fetchImpl });
  await n.send({ title: 'Deploy', message: 'Selesai' });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.body, { chat_id: '42', text: 'Deploy\n\nSelesai', disable_web_page_preview: true });
});

test('send tanpa judul hanya mengirim isi pesan yang sudah dirapikan', async () => {
  const fetchImpl = fakeFetch(telegram(200, { ok: true }));
  await createNotifier({ token: TOKEN, chatId: '42', fetchImpl }).send({ message: '  halo  ' });
  assert.equal(fetchImpl.calls[0].body.text, 'halo');
});

test('belum dikonfigurasi menghasilkan 503 dan tidak memanggil jaringan', async () => {
  const fetchImpl = fakeFetch(telegram(200, { ok: true }));
  const n = createNotifier({ token: '', chatId: '42', fetchImpl });
  assert.equal(n.configured, false);
  await assert.rejects(n.send({ message: 'x' }), (e) => e instanceof HttpError && e.status === 503 && e.code === 'notifier_not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('pesan kosong setelah dirapikan ditolak 400', async () => {
  const n = createNotifier({ token: TOKEN, chatId: '42', fetchImpl: fakeFetch(telegram(200, { ok: true })) });
  await assert.rejects(n.send({ message: '   ' }), (e) => e.status === 400);
});

test('Telegram menolak: status 502 dengan deskripsi dari Telegram', async () => {
  const fetchImpl = fakeFetch(telegram(400, { ok: false, description: 'Bad Request: chat not found' }));
  const n = createNotifier({ token: TOKEN, chatId: '42', fetchImpl });
  await assert.rejects(n.send({ message: 'x' }), (e) => e.status === 502 && e.code === 'telegram_rejected' && /chat not found/.test(e.message));
});

test('Telegram membalas bukan JSON: tetap 502 dengan status HTTP', async () => {
  const fetchImpl = fakeFetch({ ok: false, status: 500, json: async () => { throw new Error('bukan json'); } });
  const n = createNotifier({ token: TOKEN, chatId: '42', fetchImpl });
  await assert.rejects(n.send({ message: 'x' }), (e) => e.status === 502 && /500/.test(e.message));
});

test('gagal jaringan: 502 dan token bot tidak bocor ke pesan error', async () => {
  const fetchImpl = async (url) => { throw new TypeError(`fetch failed ${url}`); };
  const n = createNotifier({ token: TOKEN, chatId: '42', fetchImpl });
  await assert.rejects(n.send({ message: 'x' }), (e) => {
    assert.equal(e.code, 'telegram_unreachable');
    assert.equal(JSON.stringify({ m: e.message, h: e.hint }).includes('RAHASIA'), false);
    return true;
  });
});

test('status modul menyebut variabel yang belum diisi', () => {
  const ctx = (telegramConfig) => ({ config: { telegram: telegramConfig } });
  assert.deepEqual(notifierModule.status(ctx({ token: 't', chatId: 'c' })), { ready: true, note: 'Telegram tersambung.' });
  assert.match(notifierModule.status(ctx({ token: '', chatId: 'c' })).note, /^TELEGRAM_BOT_TOKEN belum/);
  assert.match(notifierModule.status(ctx({ token: '', chatId: '' })).note, /TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID/);
});
