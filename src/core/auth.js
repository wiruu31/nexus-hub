import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

export const KEY_PREFIX = 'nxs_';
const SCOPE_PATTERN = /^[a-z0-9-]+$/;

export function generateKey() {
  return KEY_PREFIX + randomBytes(24).toString('base64url');
}

// SHA-256 cukup karena key acak 192 bit; hash lambat seperti bcrypt cuma memperlambat tiap request.
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function safeEqual(a, b) {
  return timingSafeEqual(
    createHash('sha256').update(String(a)).digest(),
    createHash('sha256').update(String(b)).digest(),
  );
}

export function normalizeScopes(input) {
  if (input === undefined || input === null) return ['*'];
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(400, 'invalid_request', 'scopes harus berisi daftar id modul, atau ["*"] untuk semua modul.');
  }
  if (input.includes('*')) return ['*'];
  const unique = [...new Set(input.map(String))];
  if (!unique.every((s) => SCOPE_PATTERN.test(s))) {
    throw new HttpError(400, 'invalid_request', 'Id modul di scopes hanya boleh huruf kecil, angka, dan tanda hubung.');
  }
  return unique;
}

function present(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.split(','),
    rate_limit: row.rate_limit,
    active: row.active === 1,
    created_at: row.created_at,
    last_used_at: row.last_used_at ?? null,
  };
}

export function createKeyStore(db, { defaultRateLimit = 60 } = {}) {
  const insert = db.prepare(
    'INSERT INTO api_keys (name, prefix, key_hash, scopes, rate_limit, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
  );
  const byId = db.prepare('SELECT * FROM api_keys WHERE id = ?');
  const byHash = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?');
  const all = db.prepare('SELECT * FROM api_keys ORDER BY id DESC');
  const update = db.prepare('UPDATE api_keys SET name = ?, rate_limit = ?, active = ?, scopes = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM api_keys WHERE id = ?');
  const touch = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');

  return {
    create({ name, scopes, rateLimit }) {
      const cleanName = String(name ?? '').trim();
      if (!cleanName || cleanName.length > 60) {
        throw new HttpError(400, 'invalid_request', 'Nama key wajib diisi, maksimal 60 karakter.');
      }
      const secret = generateKey();
      const { lastInsertRowid } = insert.run(
        cleanName,
        secret.slice(0, 8),
        hashKey(secret),
        normalizeScopes(scopes).join(','),
        rateLimit ?? defaultRateLimit,
        new Date().toISOString(),
      );
      return { key: present(byId.get(lastInsertRowid)), secret };
    },

    verify(secret) {
      if (typeof secret !== 'string' || !secret.startsWith(KEY_PREFIX) || secret.length > 200) return null;
      const row = byHash.get(hashKey(secret));
      return row ? present(row) : null;
    },

    allows(key, moduleId) {
      return key.scopes.includes('*') || key.scopes.includes(moduleId);
    },

    list: () => all.all().map(present),

    patch(id, changes) {
      const row = byId.get(id);
      if (!row) return null;
      update.run(
        changes.name === undefined ? row.name : String(changes.name).trim() || row.name,
        changes.rate_limit ?? row.rate_limit,
        changes.active === undefined ? row.active : changes.active ? 1 : 0,
        changes.scopes === undefined ? row.scopes : normalizeScopes(changes.scopes).join(','),
        id,
      );
      return present(byId.get(id));
    },

    remove: (id) => remove.run(id).changes > 0,

    markUsed: (id) => touch.run(new Date().toISOString(), id),
  };
}
