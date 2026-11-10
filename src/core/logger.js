export const LEVELS = ['info', 'warn', 'error'];

export function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function createLogStore(db) {
  const insert = db.prepare(
    'INSERT INTO logs (ts, level, key_id, module, method, path, status, ms, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const stats = db.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END), 0) AS errors FROM logs WHERE ts >= ?",
  );
  const prune = db.prepare('DELETE FROM logs WHERE ts < ?');

  return {
    write({ keyId = null, module = null, method, path, status, ms, message = null }) {
      insert.run(
        new Date().toISOString(),
        levelFor(status),
        keyId,
        module,
        method,
        String(path).slice(0, 300),
        status,
        ms,
        message === null ? null : String(message).slice(0, 500),
      );
    },

    list({ level, limit = 50, before } = {}) {
      const where = [];
      const args = [];
      if (level) {
        where.push('l.level = ?');
        args.push(level);
      }
      if (before) {
        where.push('l.id < ?');
        args.push(before);
      }
      const sql = `SELECT l.*, k.name AS key_name FROM logs l LEFT JOIN api_keys k ON k.id = l.key_id${
        where.length ? ` WHERE ${where.join(' AND ')}` : ''
      } ORDER BY l.id DESC LIMIT ?`;
      return db.prepare(sql).all(...args, limit);
    },

    stats: (sinceIso) => stats.get(sinceIso),

    prune: (days) => prune.run(new Date(Date.now() - days * 864e5).toISOString()).changes,
  };
}
