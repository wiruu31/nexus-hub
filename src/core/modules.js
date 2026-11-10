import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ID_PATTERN = /^[a-z0-9-]+$/;

export function validateModule(mod, source) {
  const problems = [];
  if (!mod || typeof mod !== 'object') {
    problems.push('export default harus berupa objek');
  } else {
    for (const field of ['id', 'path', 'name', 'description', 'version']) {
      if (typeof mod[field] !== 'string' || !mod[field]) problems.push(`${field} wajib berupa teks`);
    }
    if (typeof mod.id === 'string' && !ID_PATTERN.test(mod.id)) problems.push('id hanya boleh huruf kecil, angka, tanda hubung');
    if (typeof mod.path === 'string' && !ID_PATTERN.test(mod.path)) problems.push('path hanya boleh huruf kecil, angka, tanda hubung');
    if (typeof mod.routes !== 'function') problems.push('routes harus berupa fungsi');
  }
  if (problems.length) throw new Error(`Modul "${source}" tidak valid: ${problems.join('; ')}.`);
}

// Folder berawalan _ atau . dilewati, jadi modul yang belum jadi bisa disimpan di sana.
export async function loadModules(dir) {
  const loaded = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const file = join(dir, entry.name, 'index.js');
    const mod = (await import(pathToFileURL(file).href)).default;
    validateModule(mod, entry.name);
    loaded.push(mod);
  }

  for (const field of ['id', 'path']) {
    const seen = new Set();
    for (const mod of loaded) {
      if (seen.has(mod[field])) throw new Error(`Dua modul memakai ${field} yang sama: "${mod[field]}".`);
      seen.add(mod[field]);
    }
  }
  return loaded.sort((a, b) => a.id.localeCompare(b.id));
}

export function createModuleState(db, mods) {
  const seed = db.prepare('INSERT OR IGNORE INTO modules (id, enabled) VALUES (?, 1)');
  for (const mod of mods) seed.run(mod.id);

  const enabled = new Map(db.prepare('SELECT id, enabled FROM modules').all().map((r) => [r.id, r.enabled === 1]));
  const write = db.prepare('UPDATE modules SET enabled = ? WHERE id = ?');

  return {
    isEnabled: (id) => enabled.get(id) === true,

    setEnabled(id, on) {
      if (!enabled.has(id)) return false;
      write.run(on ? 1 : 0, id);
      enabled.set(id, on);
      return true;
    },
  };
}
