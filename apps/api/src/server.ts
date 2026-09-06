import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import proxy from '@fastify/http-proxy';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import {
  idSchema,
  orderSchema,
  marketSchema,
  setSchema,
  resolutionSchema,
  botSchema,
} from '@minimarket/shared';
import { Fault, assert, events, pool } from './db.ts';
import { authenticated, currentUser, origin, registerAuth } from './auth.ts';
import {
  createMarket,
  placeOrder,
  cancelOrder,
  completeSet,
  resetAccount,
  moderate,
  settle,
  allocateBot,
  quoteBot,
} from './exchange.ts';
import { listMarkets, snapshot, portfolio, leaderboard } from './queries.ts';
import { migrate, verifyMigrations } from './migrate.ts';
export async function buildApp(frontend = false) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    disableRequestLogging: true,
    bodyLimit: 32 * 1024,
    trustProxy:
      process.env.NODE_ENV === 'production' ? (_address: string, hop: number) => hop === 0 : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 1024 } });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .header('X-Frame-Options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method))
      assert(req.headers.origin === origin, 'Request origin is not allowed', 403);
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: error.issues.map((i) => i.message).join('; ') });
    if (error instanceof Fault) return reply.code(error.status).send({ error: error.message });
    if ((error as { statusCode?: number }).statusCode === 429)
      return reply.code(429).send({ error: 'Too many requests. Please wait a minute.' });
    req.log.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Request failed',
    );
    return reply.code(500).send({
      error: 'The request could not be completed. Please retry with the same request key.',
    });
  });
  await registerAuth(app);
  const key = (req: { headers: Record<string, unknown> }) =>
    idSchema.parse(req.headers['idempotency-key']);
  const marketId = (req: { params: unknown }) => idSchema.parse((req.params as { id: string }).id);
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/markets', async (req) => listMarkets((await currentUser(req))?.admin === true));
  app.get('/api/markets/:id', async (req) => snapshot(marketId(req)));
  app.get('/api/portfolio', async (req) => portfolio((await authenticated(req)).id));
  app.get('/api/leaderboard', async () => leaderboard());
  app.post(
    '/api/markets',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req) =>
      createMarket((await authenticated(req)).id, key(req), marketSchema.parse(req.body)),
  );
  app.post(
    '/api/orders',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => placeOrder((await authenticated(req)).id, key(req), orderSchema.parse(req.body)),
  );
  app.post('/api/orders/:id/cancel', async (req) =>
    cancelOrder((await authenticated(req)).id, key(req), marketId(req)),
  );
  app.post('/api/sets', async (req) =>
    completeSet((await authenticated(req)).id, key(req), setSchema.parse(req.body)),
  );
  app.post('/api/reset', async (req) => resetAccount((await authenticated(req)).id, key(req)));
  app.post('/api/admin/markets/:id', async (req) =>
    moderate(
      (await authenticated(req)).id,
      key(req),
      marketId(req),
      z
        .object({ action: z.enum(['hide', 'show', 'halt']) })
        .strict()
        .parse(req.body).action,
    ),
  );
  app.post('/api/admin/settle', async (req) => {
    const b = resolutionSchema.parse(req.body);
    return settle((await authenticated(req)).id, key(req), b.marketId, b.winnerId, b.evidence);
  });
  app.post('/api/admin/bot', async (req) =>
    allocateBot((await authenticated(req)).id, key(req), botSchema.parse(req.body)),
  );
  const active = new Map<string, number>();
  const viewers = new Map<string, number>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const [id, until] of active) {
        if (until < Date.now()) {
          active.delete(id);
          continue;
        }
        try {
          await quoteBot(id);
        } catch (e) {
          app.log.error(e, 'Bot tick failed');
        }
      }
    } finally {
      running = false;
    }
  };
  // Other Vercel instances may commit trades without emitting to this process.
  // Poll only the small version rows for markets with an active local viewer.
  let checkingVersions = false;
  const checkVersions = async () => {
    if (checkingVersions) return;
    const ids = [...active]
      .filter(([id, until]) => until >= Date.now() && viewers.has(id))
      .map(([id]) => id);
    if (!ids.length) return;
    checkingVersions = true;
    try {
      const result = await pool.query(
        'SELECT id, version FROM markets WHERE id = ANY($1::uuid[])',
        [ids],
      );
      for (const update of result.rows) events.emit('market', update);
    } catch {
      app.log.error('Market version synchronization failed');
    } finally {
      checkingVersions = false;
    }
  };
  const versionTimer = setInterval(() => void checkVersions(), 2_000);
  versionTimer.unref();
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  app.get('/api/live/:id', { websocket: true }, (socket, req) => {
    let id: string;
    try {
      id = marketId(req);
      if (req.headers.origin !== origin) {
        socket.close(1008, 'Origin denied');
        return;
      }
    } catch {
      socket.close(1008, 'Invalid market');
      return;
    }
    let alive = true;
    let sentVersion = -1;
    viewers.set(id, (viewers.get(id) ?? 0) + 1);
    const visit = () => {
      active.set(id, Date.now() + 45_000);
      void tick();
    };
    visit();
    const update = (m: { id: string; version: number }) => {
      if (m.id === id && socket.readyState === 1 && m.version > sentVersion) {
        sentVersion = m.version;
        socket.send(JSON.stringify(m));
      }
    };
    events.on('market', update);
    socket.on('message', (raw) => {
      if (raw.toString() === 'active') visit();
    });
    socket.on('close', () => {
      alive = false;
      events.off('market', update);
      const remaining = (viewers.get(id) ?? 1) - 1;
      if (remaining > 0) viewers.set(id, remaining);
      else {
        viewers.delete(id);
        active.delete(id);
      }
    });
    void snapshot(id)
      .then((s) => {
        if (alive) update({ id, version: s.market.version });
      })
      .catch(() => socket.close(1008, 'Market unavailable'));
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(versionTimer);
    active.clear();
    viewers.clear();
  });
  if (frontend)
    await app.register(proxy, {
      upstream: process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000',
      prefix: '/',
      websocket: false,
    });
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') {
    assert(origin.startsWith('https://'), 'Production APP_ORIGIN must use HTTPS');
    assert(process.env.ENABLE_TEST_AUTH !== 'true', 'Test authentication cannot run in production');
  }
  if (process.env.RUN_MIGRATIONS === 'false') await verifyMigrations();
  else await migrate();
  const app = await buildApp(true);
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      void app
        .close()
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
}
