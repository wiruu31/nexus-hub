import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { fileURLToPath } from 'node:url';
import { VERSION } from './core/config.js';
import { HttpError } from './core/errors.js';
import { createKeyStore } from './core/auth.js';
import { createLimiter } from './core/ratelimit.js';
import { createLogStore, LEVELS } from './core/logger.js';
import { createModuleState } from './core/modules.js';
import { createAdminGuard, createGate } from './core/gate.js';

const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/', import.meta.url));
const CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const ADMIN_SECURITY = [{ adminToken: [] }];

export async function buildApp({ config, db, mods, fetchImpl = fetch, logger = true }) {
  const keys = createKeyStore(db, { defaultRateLimit: config.defaultRateLimit });
  const logs = createLogStore(db);
  const state = createModuleState(db, mods);
  const limiter = createLimiter();
  const failLimiter = createLimiter();
  const gateFor = createGate({ keys, limiter, state });
  const adminGuard = createAdminGuard({ token: config.adminToken, failLimiter });
  const startedAt = Date.now();
  const ctx = { config, fetch: fetchImpl };

  const app = Fastify({
    logger: logger ? { level: 'info' } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest('nexus', null);
  app.decorateRequest('note', null);

  const sweeper = setInterval(() => {
    limiter.sweep();
    failLimiter.sweep();
  }, 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  await app.register(fastifyCors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-api-key', 'authorization'],
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Nexus Hub',
        version: VERSION,
        description: 'API pribadi modular. Rute /v1 memakai header x-api-key, rute /admin memakai header x-admin-token.',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          adminToken: { type: 'apiKey', in: 'header', name: 'x-admin-token' },
        },
      },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    // Swagger UI memakai skrip dan gaya inline, jadi /docs tidak diberi CSP.
    if (!req.url.startsWith('/docs')) {
      reply.header('content-security-policy', CSP);
      reply.header('x-frame-options', 'DENY');
    }
    return payload;
  });

  // Log mencatat semua panggilan /v1 dan penolakan di /admin. Polling dashboard yang sukses tidak dicatat.
  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0];
    const isApi = path.startsWith('/v1');
    const isAdminRejection = path.startsWith('/admin') && reply.statusCode >= 400;
    if (!isApi && !isAdminRejection) return;
    try {
      logs.write({
        keyId: req.nexus?.keyId ?? null,
        module: req.nexus?.module ?? null,
        method: req.method,
        path,
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
        message: req.note,
      });
    } catch (err) {
      req.log.error(err, 'gagal menulis log');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      req.note = err.code;
      reply.headers(err.headers);
      return reply.code(err.status).send({ error: err.code, message: err.message, hint: err.hint });
    }
    if (err.validation) {
      req.note = 'invalid_request';
      return reply.code(400).send({ error: 'invalid_request', message: err.message });
    }
    if (err.statusCode && err.statusCode < 500) {
      req.note = 'bad_request';
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error(err);
    req.note = err.message;
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Terjadi kesalahan di server.',
      hint: 'Detailnya ada di halaman Log pada dashboard.',
    });
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    reply.code(404).send({ error: 'not_found', message: `Rute ${req.method} ${path} tidak ada.`, hint: 'Daftar rute ada di /docs.' });
  });

  app.get('/health', { schema: { tags: ['system'], summary: 'Cek server hidup' } }, async () => ({
    status: 'ok',
    version: VERSION,
  }));

  const describeModules = () =>
    mods.map((mod) => {
      const status = mod.status ? mod.status(ctx) : { ready: true, note: '' };
      return {
        id: mod.id,
        name: mod.name,
        description: mod.description,
        version: mod.version,
        path: `/v1/${mod.path}`,
        enabled: state.isEnabled(mod.id),
        ready: status.ready,
        note: status.note,
      };
    });

  await app.register(
    async (admin) => {
      admin.addHook('onRequest', adminGuard);

      admin.get('/summary', {
        schema: { tags: ['admin'], summary: 'Ringkasan hub', security: ADMIN_SECURITY },
      }, async () => {
        const stats = logs.stats(new Date(Date.now() - 864e5).toISOString());
        const keyList = keys.list();
        const moduleList = describeModules();
        return {
          version: VERSION,
          default_rate_limit: config.defaultRateLimit,
          uptime_s: Math.round((Date.now() - startedAt) / 1000),
          keys: { total: keyList.length, active: keyList.filter((k) => k.active).length },
          modules: { total: moduleList.length, enabled: moduleList.filter((m) => m.enabled).length },
          requests_24h: stats.total,
          errors_24h: stats.errors,
        };
      });

      admin.get('/keys', {
        schema: { tags: ['admin'], summary: 'Daftar API key', security: ADMIN_SECURITY },
      }, async () => ({ keys: keys.list() }));

      admin.post('/keys', {
        schema: {
          tags: ['admin'],
          summary: 'Buat API key baru. Isi key lengkap hanya muncul di jawaban ini.',
          security: ADMIN_SECURITY,
          body: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 60 },
              scopes: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 40 } },
              rate_limit: { type: 'integer', minimum: 1, maximum: 10000 },
            },
          },
        },
      }, async (req, reply) => {
        const unknown = (req.body.scopes ?? []).filter((s) => s !== '*' && !mods.some((m) => m.id === s));
        if (unknown.length) {
          throw new HttpError(400, 'unknown_module', `Modul tidak ada: ${unknown.join(', ')}.`, {
            hint: `Modul yang terpasang: ${mods.map((m) => m.id).join(', ')}.`,
          });
        }
        const { key, secret } = keys.create({
          name: req.body.name,
          scopes: req.body.scopes,
          rateLimit: req.body.rate_limit,
        });
        return reply.code(201).send({ key, secret });
      });

      admin.patch('/keys/:id', {
        schema: {
          tags: ['admin'],
          summary: 'Ubah nama, batas, status, atau akses modul sebuah key',
          security: ADMIN_SECURITY,
          params: { type: 'object', properties: { id: { type: 'integer' } } },
          body: {
            type: 'object',
            minProperties: 1,
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 60 },
              scopes: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 40 } },
              rate_limit: { type: 'integer', minimum: 1, maximum: 10000 },
              active: { type: 'boolean' },
            },
          },
        },
      }, async (req) => {
        const key = keys.patch(req.params.id, req.body);
        if (!key) throw new HttpError(404, 'key_not_found', 'Key tidak ditemukan.', { hint: 'Segarkan daftar key di dashboard.' });
        return { key };
      });

      admin.delete('/keys/:id', {
        schema: {
          tags: ['admin'],
          summary: 'Hapus key permanen',
          security: ADMIN_SECURITY,
          params: { type: 'object', properties: { id: { type: 'integer' } } },
        },
      }, async (req, reply) => {
        if (!keys.remove(req.params.id)) {
          throw new HttpError(404, 'key_not_found', 'Key tidak ditemukan.', { hint: 'Segarkan daftar key di dashboard.' });
        }
        return { deleted: true };
      });

      admin.get('/modules', {
        schema: { tags: ['admin'], summary: 'Daftar modul dan statusnya', security: ADMIN_SECURITY },
      }, async () => ({ modules: describeModules() }));

      admin.patch('/modules/:id', {
        schema: {
          tags: ['admin'],
          summary: 'Nyalakan atau matikan modul',
          security: ADMIN_SECURITY,
          params: { type: 'object', properties: { id: { type: 'string', maxLength: 40 } } },
          body: {
            type: 'object',
            required: ['enabled'],
            additionalProperties: false,
            properties: { enabled: { type: 'boolean' } },
          },
        },
      }, async (req) => {
        if (!state.setEnabled(req.params.id, req.body.enabled)) {
          throw new HttpError(404, 'module_not_found', `Modul ${req.params.id} tidak terpasang.`);
        }
        return { module: describeModules().find((m) => m.id === req.params.id) };
      });

      admin.get('/logs', {
        schema: {
          tags: ['admin'],
          summary: 'Log request terbaru',
          security: ADMIN_SECURITY,
          querystring: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: LEVELS },
              limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              before: { type: 'integer', minimum: 1 },
            },
          },
        },
      }, async (req) => {
        const { level, limit, before } = req.query;
        const rows = logs.list({ level, limit, before });
        return { logs: rows, next_before: rows.length === limit ? rows[rows.length - 1].id : null };
      });
    },
    { prefix: '/admin' },
  );

  for (const mod of mods) {
    await app.register(
      async (scope) => {
        scope.addHook('onRequest', gateFor(mod));
        await mod.routes(scope, ctx);
      },
      { prefix: `/v1/${mod.path}` },
    );
  }

  await app.register(fastifyStatic, { root: DASHBOARD_DIR });

  return app;
}
