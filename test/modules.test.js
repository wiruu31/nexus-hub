import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.js';
import { createModuleState, loadModules, validateModule } from '../src/core/modules.js';

const valid = { id: 'demo', path: 'demo', name: 'Demo', description: 'Contoh.', version: '1.0.0', routes() {} };

test('validateModule menerima modul lengkap dan menyebut semua masalah di modul rusak', () => {
  assert.doesNotThrow(() => validateModule(valid, 'demo'));
  assert.throws(() => validateModule({ id: 'Besar', path: 'ok' }, 'rusak'), (err) => {
    assert.match(err.message, /rusak/);
    assert.match(err.message, /id hanya boleh/);
    assert.match(err.message, /name wajib/);
    assert.match(err.message, /routes harus/);
    return true;
  });
  assert.throws(() => validateModule(undefined, 'kosong'), /objek/);
});

test('loadModules menemukan notifier asli dan melewati folder berawalan underscore', async () => {
  const mods = await loadModules(fileURLToPath(new URL('../src/modules/', import.meta.url)));
  assert.deepEqual(mods.map((m) => m.id), ['notifier']);
  assert.equal(mods[0].path, 'notify');
});

test('loadModules menolak id kembar dan folder _ diabaikan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-mods-'));
  const body = (id) =>
    `export default { id: '${id}', path: '${id}', name: 'N', description: 'D', version: '1', routes() {} };`;
  for (const [folder, id] of [['a', 'sama'], ['b', 'sama'], ['_draf', 'draf']]) {
    mkdirSync(join(dir, folder));
    writeFileSync(join(dir, folder, 'index.js'), body(id));
  }
  await assert.rejects(loadModules(dir), /sama/);
});

test('createModuleState menyalakan modul baru, mengingat pilihan, dan menolak id asing', () => {
  const db = openDatabase(':memory:');
  const state = createModuleState(db, [valid]);
  assert.equal(state.isEnabled('demo'), true);
  assert.equal(state.setEnabled('demo', false), true);
  assert.equal(state.isEnabled('demo'), false);
  assert.equal(state.setEnabled('tidak-ada', true), false);

  const again = createModuleState(db, [valid]);
  assert.equal(again.isEnabled('demo'), false);
  assert.equal(again.isEnabled('tidak-ada'), false);
});
