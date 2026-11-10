import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from './core/config.js';
import { openDatabase } from './core/database.js';
import { createLogStore } from './core/logger.js';
import { loadModules } from './core/modules.js';
import { buildApp } from './app.js';

loadDotEnv();

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Nexus tidak bisa start. ${err.message}`);
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const mods = await loadModules(fileURLToPath(new URL('./modules/', import.meta.url)));
const app = await buildApp({ config, db, mods });

const logs = createLogStore(db);
const prune = () => {
  const removed = logs.prune(config.logKeepDays);
  if (removed) app.log.info(`Log lama dihapus: ${removed} baris.`);
};
prune();
setInterval(prune, 3_600_000).unref();

async function shutdown() {
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Dashboard Nexus: http://localhost:${config.port}  |  Dokumentasi API: http://localhost:${config.port}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
