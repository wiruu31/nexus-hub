import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// loadEnvFile tidak menimpa variabel yang sudah ada, jadi env asli hosting menang atas .env.
export function loadDotEnv(path = resolve(ROOT, '.env')) {
  if (existsSync(path)) process.loadEnvFile(path);
}

function integer(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} harus bilangan bulat ${min} sampai ${max}, sekarang "${raw}".`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const adminToken = env.ADMIN_TOKEN ?? '';
  if (adminToken.length < 16) {
    throw new Error('ADMIN_TOKEN belum diisi di .env atau kurang dari 16 karakter. Buat nilai acak dengan: npm run token');
  }

  return {
    host: env.HOST || '0.0.0.0',
    port: integer(env, 'PORT', 3000, 1, 65535),
    adminToken,
    dbPath: env.DB_PATH ? resolve(env.DB_PATH) : resolve(ROOT, 'data/nexus.db'),
    defaultRateLimit: integer(env, 'DEFAULT_RATE_LIMIT', 60, 1, 10000),
    logKeepDays: integer(env, 'LOG_KEEP_DAYS', 30, 1, 365),
    trustProxy: env.TRUST_PROXY === 'true',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: env.TELEGRAM_CHAT_ID ?? '',
    },
  };
}
