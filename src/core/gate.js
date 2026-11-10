import { HttpError } from './errors.js';
import { safeEqual } from './auth.js';

export function extractKey(headers) {
  const direct = headers['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

// Satpam /v1: dipasang sebagai hook onRequest supaya key dicek sebelum body diurai.
export function createGate({ keys, limiter, state }) {
  return (mod) =>
    async function gate(req, reply) {
      req.nexus = { keyId: null, module: mod.id };

      const secret = extractKey(req.headers);
      if (!secret) {
        throw new HttpError(401, 'api_key_missing', 'API key tidak dikirim.', {
          hint: 'Tambahkan header x-api-key berisi key dari dashboard.',
        });
      }

      const key = keys.verify(secret);
      if (!key) {
        throw new HttpError(401, 'api_key_invalid', 'API key tidak dikenal.', {
          hint: 'Key hanya tampil sekali saat dibuat. Kalau hilang, buat key baru di dashboard.',
        });
      }
      req.nexus.keyId = key.id;

      if (!key.active) {
        throw new HttpError(403, 'api_key_disabled', `Key "${key.name}" sedang dinonaktifkan.`, {
          hint: 'Aktifkan lagi di halaman API Keys.',
        });
      }
      if (!keys.allows(key, mod.id)) {
        throw new HttpError(403, 'scope_denied', `Key "${key.name}" tidak punya akses ke modul ${mod.id}.`, {
          hint: 'Buat key baru yang mencakup modul ini.',
        });
      }
      if (!state.isEnabled(mod.id)) {
        throw new HttpError(503, 'module_disabled', `Modul ${mod.id} sedang dimatikan.`, {
          hint: 'Nyalakan di halaman Modul.',
        });
      }

      const verdict = limiter.hit(`key:${key.id}`, key.rate_limit);
      const limitHeaders = {
        'x-ratelimit-limit': String(verdict.limit),
        'x-ratelimit-remaining': String(verdict.remaining),
        'x-ratelimit-reset': String(Math.ceil(verdict.resetAt / 1000)),
      };
      if (!verdict.allowed) {
        throw new HttpError(429, 'rate_limited', `Batas ${verdict.limit} request per menit untuk key ini sudah tercapai.`, {
          headers: { ...limitHeaders, 'retry-after': String(verdict.retryAfterS) },
          hint: `Coba lagi dalam ${verdict.retryAfterS} detik.`,
        });
      }

      reply.headers(limitHeaders);
      keys.markUsed(key.id);
    };
}

// Hanya token salah yang dihitung, supaya tebakan brute force dari satu IP cepat tertahan.
export function createAdminGuard({ token, failLimiter, maxFailsPerMinute = 10 }) {
  return async function adminGuard(req) {
    const sent = req.headers['x-admin-token'];
    if (typeof sent === 'string' && sent && safeEqual(sent, token)) return;

    const verdict = failLimiter.hit(`admin:${req.ip}`, maxFailsPerMinute);
    if (!verdict.allowed) {
      throw new HttpError(429, 'too_many_attempts', 'Terlalu banyak token salah dari alamat ini.', {
        headers: { 'retry-after': String(verdict.retryAfterS) },
        hint: `Tunggu ${verdict.retryAfterS} detik sebelum mencoba lagi.`,
      });
    }
    throw new HttpError(401, 'admin_token_invalid', sent ? 'Token admin salah.' : 'Token admin tidak dikirim.', {
      hint: 'Kirim nilai ADMIN_TOKEN dari file .env di header x-admin-token.',
    });
  };
}
