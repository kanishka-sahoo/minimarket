import type { Market, Snapshot, Portfolio } from '@minimarket/shared';
import { pool, transaction, assert, type Tx } from './db.ts';
import { expireMarket } from './exchange.ts';
export async function marketRows(c: Tx, id?: string | string[], admin = false): Promise<Market[]> {
  const rows = (
    await c.query(
      `SELECT m.*,EXISTS(SELECT 1 FROM bots b WHERE b.market_id=m.id) AS bot,COALESCE((SELECT SUM(t.price*t.quantity) FROM trades t WHERE t.market_id=m.id),0)::bigint AS volume FROM markets m WHERE ($1::uuid[] IS NULL OR m.id=ANY($1::uuid[])) AND ($1::uuid[] IS NOT NULL OR $2 OR NOT m.hidden) ORDER BY m.created_at DESC LIMIT 200`,
      [id ? (Array.isArray(id) ? id : [id]) : null, admin],
    )
  ).rows;
  if (rows.length) {
    const outcomes = (
      await c.query(
        `SELECT o.*,(SELECT price FROM trades WHERE outcome_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) AS last,(SELECT MAX(price) FROM orders WHERE outcome_id=o.id AND side='buy' AND status='open' AND m.status='open' AND NOT m.halted AND m.closes_at>now()) AS bid,(SELECT MIN(price) FROM orders WHERE outcome_id=o.id AND side='sell' AND status='open' AND m.status='open' AND NOT m.halted AND m.closes_at>now()) AS ask FROM outcomes o JOIN markets m ON m.id=o.market_id WHERE o.market_id=ANY($1::uuid[]) ORDER BY o.ordinal`,
        [rows.map((m) => m.id)],
      )
    ).rows;
    for (const m of rows) m.outcomes = outcomes.filter((o) => o.market_id === m.id);
  }
  return rows;
}
export const listMarkets = (admin = false) => transaction((c) => marketRows(c, undefined, admin));
export async function snapshot(id: string): Promise<Snapshot> {
  await expireMarket(id);
  return transaction(async (c) => {
    const market = (await marketRows(c, id))[0];
    assert(market, 'Market not found', 404);
    const books: Snapshot['books'] = {};
    for (const o of market.outcomes) {
      const levels = (
        await c.query(
          `SELECT side,price,SUM(remaining)::bigint AS quantity FROM orders WHERE outcome_id=$1 AND status='open' GROUP BY side,price ORDER BY price DESC`,
          [o.id],
        )
      ).rows;
      books[o.id] = {
        bids: levels.filter((x) => x.side === 'buy'),
        asks: levels.filter((x) => x.side === 'sell').reverse(),
      };
    }
    const trades = (
      await c.query(
        'SELECT id,outcome_id,price,quantity,created_at FROM trades WHERE market_id=$1 ORDER BY created_at DESC,id DESC LIMIT 300',
        [id],
      )
    ).rows;
    return { market, books, trades };
  });
}
export async function portfolio(id: string, summary = false): Promise<Portfolio> {
  const due = (
    await pool.query(
      "SELECT DISTINCT m.id FROM markets m JOIN orders o ON o.market_id=m.id WHERE o.account_id=$1 AND o.status='open' AND m.status='open' AND m.closes_at<=now()",
      [id],
    )
  ).rows;
  for (const m of due) await expireMarket(m.id);
  return transaction(async (c) => {
    const user = (
      await c.query('SELECT id,name,email,admin,cash,reserved,epoch FROM accounts WHERE id=$1', [
        id,
      ])
    ).rows[0];
    assert(user, 'Account not found', 404);
    const holdings = (
      await c.query(
        `SELECT h.*,o.market_id,o.label,m.title,m.status,(SELECT price FROM trades WHERE outcome_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) AS mark FROM holdings h JOIN outcomes o ON o.id=h.outcome_id JOIN markets m ON m.id=o.market_id WHERE h.account_id=$1 AND h.quantity>0 AND NOT $2 ORDER BY m.title,o.ordinal`,
        [id, summary],
      )
    ).rows;
    const orders = (
      await c.query(
        "SELECT o.*,m.title,oc.label FROM orders o JOIN markets m ON m.id=o.market_id JOIN outcomes oc ON oc.id=o.outcome_id WHERE o.account_id=$1 AND (o.status='open' OR o.id IN (SELECT id FROM orders WHERE account_id=$1 ORDER BY sequence DESC LIMIT 200)) ORDER BY o.sequence DESC LIMIT $2",
        [id, summary ? 0 : null],
      )
    ).rows;
    const history = (
      await c.query(
        'SELECT l.id,l.kind,l.delta,l.created_at,l.epoch,m.title FROM ledger l LEFT JOIN markets m ON m.id=l.market_id WHERE account_id=$1 ORDER BY l.id DESC LIMIT $2',
        [id, summary ? 0 : 200],
      )
    ).rows;
    const profit = (
      await c.query(
        "SELECT COALESCE(SUM(l.delta),0)::bigint AS total FROM ledger l JOIN markets m ON m.id=l.market_id WHERE l.account_id=$1 AND l.epoch=$2 AND m.status='settled' AND l.kind NOT IN ('grant','reset','bot-grant')",
        [id, user.epoch],
      )
    ).rows[0].total;
    const totals = (
      await c.query(
        `SELECT COUNT(*)::integer AS count,COALESCE(SUM(quantity*mark),0)::bigint AS value,COALESCE(SUM(quantity) FILTER (WHERE mark IS NULL),0)::bigint AS unpriced FROM (SELECT h.quantity,(SELECT price FROM trades WHERE outcome_id=h.outcome_id ORDER BY created_at DESC,id DESC LIMIT 1) AS mark FROM holdings h WHERE h.account_id=$1 AND h.quantity>0) h`,
        [id],
      )
    ).rows[0];
    const openOrderCount = Number(
      (
        await c.query(
          "SELECT COUNT(*) AS count FROM orders WHERE account_id=$1 AND status='open'",
          [id],
        )
      ).rows[0].count,
    );
    return {
      user,
      holdings,
      orders,
      history,
      estimatedValue: user.cash + totals.value,
      holdingsCount: totals.count,
      openOrderCount,
      unpricedShares: totals.unpriced,
      settledProfit: profit,
    };
  });
}
export async function leaderboard() {
  return (
    await pool.query(
      `SELECT a.id,a.name,a.epoch,COALESCE(SUM(l.delta),0)::bigint AS profit,COUNT(DISTINCT l.market_id)::integer AS markets FROM accounts a JOIN ledger l ON l.account_id=a.id AND l.epoch=a.epoch JOIN markets m ON m.id=l.market_id AND m.status='settled' WHERE NOT a.bot AND l.kind NOT IN ('grant','reset','bot-grant') GROUP BY a.id ORDER BY profit DESC,a.created_at LIMIT 100`,
    )
  ).rows;
}
