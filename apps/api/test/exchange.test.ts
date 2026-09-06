import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DOLLAR, CENT, GRANT, orderSchema, pageQuerySchema } from '@minimarket/shared';
import { readPage } from '../src/pages.ts';
import { pool } from '../src/db.ts';
import { migrate, verifyMigrations } from '../src/migrate.ts';
import {
  createAccount,
  createMarket,
  completeSet,
  placeOrder,
  cancelOrder,
  settle,
  moderate,
  resetAccount,
  allocateBot,
  quoteBot,
  expireMarket,
} from '../src/exchange.ts';
import { portfolio, leaderboard, snapshot } from '../src/queries.ts';
import { buildApp } from '../src/server.ts';
let admin: string, a: string, b: string, m: string, outcomes: string[];
const key = () => randomUUID();
async function market(labels = ['Yes', 'No']) {
  const r = await createMarket(admin, key(), {
    title: 'Will this test market settle correctly?',
    category: 'Science',
    criteria: 'Resolves to the outcome selected by the test administrator after closing.',
    source: 'https://example.com/evidence',
    closesAt: new Date(Date.now() + 86400000).toISOString(),
    kind: labels.length === 2 ? 'binary' : 'multi',
    outcomes: labels,
  });
  return {
    id: r.id,
    outcomes: (
      await pool.query('SELECT id FROM outcomes WHERE market_id=$1 ORDER BY ordinal', [r.id])
    ).rows.map((r) => r.id),
  };
}
const mint = (actor: string, quantity = 10, id = m) =>
  completeSet(actor, key(), { marketId: id, quantity, action: 'mint' });
const order = (
  actor: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  extra: Record<string, unknown> = {},
) =>
  placeOrder(actor, key(), {
    marketId: m,
    outcomeId: outcomes[0],
    side,
    price: price * CENT,
    quantity,
    tif: 'GTC',
    ...extra,
  });
beforeAll(async () => {
  const db = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!db.endsWith('_test'))
    throw new Error('Integration tests require a dedicated database ending in _test');
  await migrate();
});
beforeEach(async () => {
  await pool.query('TRUNCATE accounts CASCADE');
  admin = (await createAccount('admin', 'admin@example.test', 'Admin', true)).id;
  a = (await createAccount('a', 'a@example.test', 'Alice')).id;
  b = (await createAccount('b', 'b@example.test', 'Bob')).id;
  const created = await market();
  m = created.id;
  outcomes = created.outcomes;
});
afterAll(() => pool.end());
test('market pagination covers old records, filters before slicing and breaks timestamp ties', async () => {
  await pool.query(
    `INSERT INTO markets(id,creator_id,title,category,criteria,source,closes_at,kind)
    SELECT gen_random_uuid(),$1,'Paged question ' || n,'Science','Criteria for pagination fixtures','https://example.com',now()+interval '1 day','binary' FROM generate_series(1,205) n`,
    [admin],
  );
  const first = await readPage('markets', pageQuerySchema.parse({ pageSize: 100 }), null);
  const second = await readPage('markets', pageQuerySchema.parse({ pageSize: 100, page: 2 }), null);
  const last = await readPage('markets', pageQuerySchema.parse({ pageSize: 100, page: 3 }), null);
  const ids = [...first.items, ...second.items, ...last.items].map((x) => (x as { id: string }).id);
  expect(new Set(ids).size).toBe(206);
  expect(last.items).toHaveLength(6);
  const filtered = await readPage(
    'markets',
    pageQuerySchema.parse({ search: 'Paged question 205', pageSize: 1 }),
    null,
  );
  expect(filtered.total).toBe(1);
  expect((filtered.items[0] as { title: string }).title).toBe('Paged question 205');
  expect(
    (await readPage('markets', pageQuerySchema.parse({ search: '%', category: 'Science' }), null))
      .total,
  ).toBe(0);
  expect((await readPage('markets', pageQuerySchema.parse({ page: 999 }), null)).page).toBe(9);
  await expect(
    readPage('markets', pageQuerySchema.parse({ admin: 'true' }), null),
  ).rejects.toMatchObject({ status: 403 });
});
test('paginated activity and orders preserve account isolation and reach past historical caps', async () => {
  const user = (await portfolio(a)).user;
  for (let i = 0; i < 205; i++) {
    const placed = await order(a, 'buy', 1, 1);
    await cancelOrder(a, key(), placed.id);
  }
  await order(b, 'buy', 2, 1);
  const last = await readPage('orders', pageQuerySchema.parse({ page: 3, pageSize: 100 }), user);
  expect(last.total).toBe(205);
  expect(last.items).toHaveLength(5);
  expect((await readPage('open-orders', pageQuerySchema.parse({}), user)).total).toBe(0);
  const activity = await readPage('activity', pageQuerySchema.parse({ pageSize: 1 }), user);
  expect(activity.total).toBe(1);
  expect((activity.items[0] as { kind: string }).kind).toBe('grant');
  await expect(readPage('activity', pageQuerySchema.parse({}), null)).rejects.toMatchObject({
    status: 401,
  });
  expect(pageQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(pageQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
});
test('admins may resolve their own markets and trade pages filter before pagination', async () => {
  await mint(b, 10);
  await order(b, 'sell', 50, 10);
  await order(a, 'buy', 50, 2);
  await order(a, 'buy', 50, 3);
  const q = { marketId: m, outcomeId: outcomes[0], pageSize: 1 };
  const first = await readPage('trades', pageQuerySchema.parse(q), null);
  const second = await readPage('trades', pageQuerySchema.parse({ ...q, page: 2 }), null);
  expect(first.total).toBe(2);
  expect(first.items).not.toEqual(second.items);
  expect(
    (await readPage('trades', pageQuerySchema.parse({ ...q, outcomeId: outcomes[1] }), null)).total,
  ).toBe(0);
  await moderate(admin, key(), m, 'halt');
  await settle(admin, key(), m, outcomes[0], 'Admin resolves their own published question');
  expect((await snapshot(m)).market.status).toBe('settled');
  const rankings = await readPage('leaderboard', pageQuerySchema.parse({ pageSize: 1 }), null);
  expect(rankings.total).toBeGreaterThan(1);
  expect(rankings.items).toHaveLength(1);
});
test('price-time priority, resting prices and partial fills preserve assets', async () => {
  await mint(a);
  const first = await order(a, 'sell', 40, 3);
  await order(a, 'sell', 40, 4);
  await order(a, 'sell', 45, 3);
  const result = await order(b, 'buy', 50, 5);
  expect(result.filled).toBe(5);
  expect(result.averagePrice).toBe(40 * CENT);
  expect(
    (await pool.query('SELECT status FROM orders WHERE id=$1', [first.id])).rows[0].status,
  ).toBe('filled');
  const bob = await portfolio(b);
  expect(bob.user.cash).toBe(GRANT - 2 * DOLLAR);
  expect(bob.user.reserved).toBe(0);
  expect(bob.holdings[0].quantity).toBe(5);
});
test('best price wins before age', async () => {
  await mint(a);
  await order(a, 'sell', 50, 2);
  await order(a, 'sell', 40, 2);
  const fill = await order(b, 'buy', 60, 1);
  expect(fill.averagePrice).toBe(40 * CENT);
});
test('sell into a resting buy executes at its price', async () => {
  await order(b, 'buy', 60, 2);
  await mint(a);
  expect((await order(a, 'sell', 40, 1)).averagePrice).toBe(60 * CENT);
  expect((await portfolio(b)).user.reserved).toBe(60 * CENT);
});
test('cancellation releases only remaining reservation', async () => {
  const r = await order(b, 'buy', 50, 10);
  await mint(a);
  await order(a, 'sell', 50, 3);
  await cancelOrder(b, key(), r.id);
  expect((await portfolio(b)).user.reserved).toBe(0);
  expect((await portfolio(b)).user.cash).toBe(GRANT - 150 * CENT);
});
test('IOC cancels unmatched quantity and respects fixed price', async () => {
  await mint(a);
  await order(a, 'sell', 50, 2);
  await order(a, 'sell', 60, 2);
  const r = await order(b, 'buy', 53, 5, { tif: 'IOC' });
  expect(r).toMatchObject({ filled: 2, canceled: 3, remaining: 0, averagePrice: 50 * CENT });
  expect((await portfolio(b)).user.reserved).toBe(0);
});
test('self-trade cancels incoming remainder without touching resting order', async () => {
  await mint(a);
  await order(a, 'sell', 40, 2);
  const r = await order(a, 'buy', 50, 3);
  expect(r).toMatchObject({ filled: 0, canceled: 3 });
  expect((await pool.query('SELECT * FROM trades')).rows).toHaveLength(0);
  expect((await portfolio(a)).user.reserved).toBe(0);
});
test('duplicate financial requests return the original result exactly once', async () => {
  const k = key(),
    input = {
      marketId: m,
      outcomeId: outcomes[0],
      side: 'buy' as const,
      price: 50 * CENT,
      quantity: 2,
      tif: 'GTC' as const,
    };
  const results = await Promise.all([placeOrder(a, k, input), placeOrder(a, k, input)]);
  expect(results[0]).toEqual(results[1]);
  expect((await portfolio(a)).user.reserved).toBe(DOLLAR);
  await expect(placeOrder(a, k, { ...input, quantity: 3 })).rejects.toThrow('different request');
});
test('concurrent spending across different markets cannot overspend', async () => {
  const second = await market();
  const result = await Promise.allSettled([
    order(a, 'buy', 99, 10000),
    placeOrder(a, key(), {
      marketId: second.id,
      outcomeId: second.outcomes[0],
      side: 'buy',
      price: 99 * CENT,
      quantity: 10000,
      tif: 'GTC',
    }),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await portfolio(a)).user.reserved).toBe(9900 * DOLLAR);
});
test('concurrent cancel and fill preserve nonnegative reservations', async () => {
  await mint(a);
  const resting = await order(a, 'sell', 50, 10);
  await Promise.all([cancelOrder(a, key(), resting.id), order(b, 'buy', 50, 10)]);
  const account = await portfolio(a);
  expect(account.user.reserved).toBeGreaterThanOrEqual(0);
  expect(account.holdings.every((h) => h.reserved <= h.quantity)).toBe(true);
});
test('complete-set redemption conserves collateral and rejects reserved shares', async () => {
  await mint(a, 7);
  const sell = await order(a, 'sell', 50, 1);
  await expect(
    completeSet(a, key(), { marketId: m, action: 'redeem', quantity: 7 }),
  ).rejects.toThrow('shares');
  await cancelOrder(a, key(), sell.id);
  await completeSet(a, key(), { marketId: m, action: 'redeem', quantity: 7 });
  expect((await portfolio(a)).user.cash).toBe(GRANT);
  expect((await snapshot(m)).market.collateral).toBe(0);
});
test('close time is enforced after sleep and releases resting orders', async () => {
  await order(a, 'buy', 50, 3);
  await pool.query("UPDATE markets SET closes_at=now()-interval '1 second' WHERE id=$1", [m]);
  await expect(order(b, 'buy', 50, 1)).rejects.toThrow('closed');
  expect((await portfolio(a)).user.reserved).toBe(0);
  expect((await snapshot(m)).market.status).toBe('closed');
});
test('settlement is atomic, final, idempotent, and correctly ranked', async () => {
  await mint(a, 10);
  await order(a, 'sell', 40, 5);
  await order(b, 'buy', 40, 5);
  await moderate(admin, key(), m, 'halt');
  const k = key();
  const result = await settle(admin, k, m, outcomes[0], 'https://example.com/result');
  expect(await settle(admin, k, m, outcomes[0], 'https://example.com/result')).toEqual(result);
  expect((await portfolio(b)).user.cash).toBe(GRANT + 3 * DOLLAR);
  expect((await leaderboard())[0]).toMatchObject({ id: b, profit: 3 * DOLLAR });
  expect((await snapshot(m)).market.collateral).toBe(0);
  await expect(settle(admin, key(), m, null, 'Another result')).rejects.toThrow('final');
});
test('three-outcome void distributes rounding without losing collateral', async () => {
  const multi = await market(['Red', 'Blue', 'Green']);
  await mint(a, 7, multi.id);
  await moderate(admin, key(), multi.id, 'halt');
  await settle(admin, key(), multi.id, null, 'Canceled fictional event');
  const s = await snapshot(multi.id);
  expect(s.market.outcomes.map((o) => o.payout)).toEqual([333334, 333333, 333333]);
  expect((await portfolio(a)).user.cash).toBe(GRANT);
});
test('reset cancels orders, requires no holdings, keeps audit and clears rank', async () => {
  await mint(a, 1);
  await expect(resetAccount(a, key())).rejects.toThrow('holdings');
  await completeSet(a, key(), { marketId: m, action: 'redeem', quantity: 1 });
  await order(a, 'buy', 40, 2);
  await resetAccount(a, key());
  const p = await portfolio(a);
  expect(p.user).toMatchObject({ cash: GRANT, reserved: 0, epoch: 1 });
  expect(p.history.some((l) => l.kind === 'mint')).toBe(true);
});
test('non-admin cannot moderate, allocate bots, or settle', async () => {
  await expect(moderate(a, key(), m, 'halt')).rejects.toThrow('Admin');
  await expect(settle(a, key(), m, null, 'Evidence here')).rejects.toThrow('Admin');
  await expect(
    allocateBot(a, key(), {
      marketId: m,
      budget: 100 * DOLLAR,
      probabilities: [5000, 5000],
      spread: 4,
      size: 10,
    }),
  ).rejects.toThrow('Admin');
});
test('bot reconciles existing orders without duplicates or extra grants', async () => {
  await allocateBot(admin, key(), {
    marketId: m,
    budget: 100 * DOLLAR,
    probabilities: [5000, 5000],
    spread: 4,
    size: 10,
  });
  await quoteBot(m);
  const before = (await pool.query("SELECT * FROM orders WHERE status='open'")).rowCount;
  await quoteBot(m);
  expect((await pool.query("SELECT * FROM orders WHERE status='open'")).rowCount).toBe(before);
  await pool.query("UPDATE bots SET last_tick=now()-interval '1 minute'");
  await quoteBot(m);
  expect((await pool.query("SELECT * FROM orders WHERE status='open'")).rowCount).toBe(before);
  expect((await pool.query("SELECT * FROM ledger WHERE kind='bot-grant'")).rowCount).toBe(1);
  await expect(
    allocateBot(admin, key(), {
      marketId: m,
      budget: 100 * DOLLAR,
      probabilities: [5000, 5000],
      spread: 4,
      size: 10,
    }),
  ).rejects.toThrow('already');
});
test('exhausted bot does not borrow or refill', async () => {
  await allocateBot(admin, key(), {
    marketId: m,
    budget: 10 * DOLLAR,
    probabilities: [5000, 5000],
    spread: 4,
    size: 10,
  });
  await quoteBot(m);
  const bot = (
    await pool.query(
      'SELECT a.* FROM accounts a JOIN bots b ON a.id=b.account_id WHERE b.market_id=$1',
      [m],
    )
  ).rows[0];
  expect(bot.cash).toBe(5 * DOLLAR);
  expect(bot.reserved).toBeLessThanOrEqual(bot.cash);
  await moderate(admin, key(), m, 'halt');
  await quoteBot(m);
  expect((await pool.query("SELECT * FROM orders WHERE status='open'")).rowCount).toBe(0);
});
test('invalid order prices and quantities are rejected by shared schema', () => {
  expect(
    orderSchema.safeParse({
      marketId: m,
      outcomeId: outcomes[0],
      side: 'buy',
      price: 12345,
      quantity: 1,
      tif: 'GTC',
    }).success,
  ).toBe(false);
});
test('HTTP authentication, CSRF, immutable terms and admin boundaries', async () => {
  const app = await buildApp();
  try {
    expect((await app.inject({ url: '/api/portfolio' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reset',
          headers: { origin: 'https://evil.test' },
        })
      ).statusCode,
    ).toBe(403);
    const login = await app.inject({
      method: 'POST',
      url: '/api/test/login',
      headers: { origin: 'http://localhost:4000' },
      payload: { name: 'visitor' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json().user.name).toBe(
      'visitor',
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/markets/' + m,
          headers: { cookie, origin: 'http://localhost:4000', 'idempotency-key': key() },
          payload: { action: 'halt' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/markets/' + m,
          headers: { cookie, origin: 'http://localhost:4000' },
          payload: { title: 'Changed terms' },
        })
      ).statusCode,
    ).toBe(404);
    await app.inject({
      method: 'POST',
      url: '/api/logout',
      headers: { cookie, origin: 'http://localhost:4000' },
    });
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json().user).toBeNull();
  } finally {
    await app.close();
  }
});
test('concurrent duplicate publication creates exactly one market', async () => {
  const k = key(),
    input = {
      title: 'Will concurrent publication remain unique?',
      category: 'Science' as const,
      criteria: 'The test administrator will choose an outcome after this test closes.',
      source: 'https://example.com/evidence',
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      kind: 'binary' as const,
      outcomes: ['Yes', 'No'],
    };
  const results = await Promise.all([createMarket(a, k, input), createMarket(a, k, input)]);
  expect(results[0]).toEqual(results[1]);
  expect((await pool.query('SELECT * FROM markets WHERE title=$1', [input.title])).rowCount).toBe(
    1,
  );
});
test('concurrent first login creates one grant and one identity', async () => {
  const results = await Promise.all([
    createAccount('concurrent', 'c@example.test', 'Concurrent'),
    createAccount('concurrent', 'c@example.test', 'Concurrent'),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(
    (await pool.query("SELECT * FROM ledger WHERE account_id=$1 AND kind='grant'", [results[0].id]))
      .rowCount,
  ).toBe(1);
});
test('bot scheduler stops database mutations after the visit expires', async () => {
  await allocateBot(admin, key(), {
    marketId: m,
    budget: 100 * DOLLAR,
    probabilities: [5000, 5000],
    spread: 4,
    size: 10,
  });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const app = await buildApp();
  try {
    await app.ready();
    const ws = await app.injectWS('/api/live/' + m, {
      headers: { origin: 'http://localhost:4000' },
    });
    await vi.waitFor(async () =>
      expect(
        (await pool.query('SELECT last_tick FROM bots WHERE market_id=$1', [m])).rows[0].last_tick,
      ).not.toBeNull(),
    );
    ws.close();
    const before = (await pool.query('SELECT version FROM markets WHERE id=$1', [m])).rows[0]
      .version;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pool.query('SELECT version FROM markets WHERE id=$1', [m])).rows[0].version).toBe(
      before,
    );
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await app.close();
  }
});
test('viewers receive commits from another process through PostgreSQL versions', async () => {
  const app = await buildApp();
  try {
    await app.ready();
    const ws = await app.injectWS('/api/live/' + m, {
      headers: { origin: 'http://localhost:4000' },
    });
    const versions: number[] = [];
    ws.on('message', (message) => versions.push(JSON.parse(message.toString()).version));
    await vi.waitFor(() => expect(versions.length).toBeGreaterThan(0));
    const initial = versions.at(-1)!;
    await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./remote-command.ts', import.meta.url)), admin, m],
      { env: process.env },
    );
    await vi.waitFor(() => expect(versions.some((version) => version > initial)).toBe(true), {
      timeout: 5000,
    });
    expect((await snapshot(m)).market.hidden).toBe(true);
    ws.close();
  } finally {
    await app.close();
  }
});
test('concurrent bot ticks share a database cooldown and create only one set of quotes', async () => {
  await allocateBot(admin, key(), {
    marketId: m,
    budget: 100 * DOLLAR,
    probabilities: [5000, 5000],
    spread: 4,
    size: 10,
  });
  const before = (await snapshot(m)).market.version;
  await Promise.all([quoteBot(m), quoteBot(m), quoteBot(m)]);
  expect((await snapshot(m)).market.version).toBe(before + 1);
  expect((await pool.query('SELECT id FROM orders WHERE market_id=$1', [m])).rowCount).toBe(4);
});
test('autoscaled startup refuses a schema that has not been prepared', async () => {
  await expect(verifyMigrations()).resolves.toBeUndefined();
  const applied = (await pool.query('DELETE FROM migrations RETURNING name')).rows;
  try {
    await expect(verifyMigrations()).rejects.toThrow('Run db:migrate before deploying');
  } finally {
    for (const row of applied)
      await pool.query('INSERT INTO migrations(name) VALUES($1)', [row.name]);
  }
});
