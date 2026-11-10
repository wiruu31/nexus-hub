import { HttpError } from '../../core/errors.js';

export function createNotifier({ token, chatId, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const configured = Boolean(token && chatId);

  async function send({ title, message }) {
    if (!configured) {
      throw new HttpError(503, 'notifier_not_configured', 'Telegram belum disambungkan.', {
        hint: 'Isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di .env, lalu restart Nexus.',
      });
    }

    const body = String(message ?? '').trim();
    if (!body) throw new HttpError(400, 'invalid_request', 'message tidak boleh kosong.');
    const heading = String(title ?? '').trim();

    let res;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: heading ? `${heading}\n\n${body}` : body,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Pesan error fetch bisa memuat URL berisi token bot, jadi tidak diteruskan.
      throw new HttpError(502, 'telegram_unreachable', 'Nexus tidak bisa menghubungi Telegram.', {
        hint: 'Cek koneksi internet server, lalu coba lagi.',
      });
    }

    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.ok) {
      throw new HttpError(502, 'telegram_rejected', result?.description ?? `Telegram membalas dengan status ${res.status}.`, {
        hint: 'Cek TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID. Chat id baru valid setelah kamu mengirim pesan ke bot.',
      });
    }
  }

  return { configured, send };
}

export default {
  id: 'notifier',
  path: 'notify',
  name: 'Notifier',
  description: 'Kirim pesan ke Telegram dari project mana pun lewat satu panggilan.',
  version: '1.0.0',

  status(ctx) {
    const { token, chatId } = ctx.config.telegram;
    if (token && chatId) return { ready: true, note: 'Telegram tersambung.' };
    const missing = [!token && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean).join(' dan ');
    return { ready: false, note: `${missing} belum diisi di .env.` };
  },

  async routes(app, ctx) {
    const notifier = createNotifier({
      token: ctx.config.telegram.token,
      chatId: ctx.config.telegram.chatId,
      fetchImpl: ctx.fetch,
    });

    app.get('/status', {
      schema: {
        tags: ['notifier'],
        summary: 'Cek apakah Telegram sudah disambungkan',
        security: [{ apiKey: [] }],
      },
    }, async () => ({ configured: notifier.configured }));

    app.post('/', {
      schema: {
        tags: ['notifier'],
        summary: 'Kirim notifikasi ke Telegram',
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 3800 },
            title: { type: 'string', maxLength: 200 },
          },
        },
      },
    }, async (req) => {
      await notifier.send(req.body);
      return { sent: true };
    });
  },
};
