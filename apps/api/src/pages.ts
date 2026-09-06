import type { Collection, Page, PageQuery, User } from '@minimarket/shared';
import { assert, transaction } from './db.ts';
import { marketRows } from './queries.ts';

export async function readPage(
  collection: Collection,
  q: PageQuery,
  user: User | null,
): Promise<Page<unknown>> {
  return transaction(async (c) => {
    const values: unknown[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    let sql: string;
    let order: string;
    if (collection === 'markets') {
      if (q.admin === 'true') assert(user?.admin, 'Administrator access required', 403);
      sql = `SELECT m.id,m.created_at,m.closes_at,COALESCE((SELECT SUM(t.price*t.quantity) FROM trades t WHERE t.market_id=m.id),0)::bigint AS volume FROM markets m WHERE (${bind(q.admin === 'true')} OR NOT m.hidden) AND strpos(lower(m.title),lower(${bind(q.search)}))>0`;
      if (q.category) sql += ` AND m.category=${bind(q.category)}`;
      order =
        q.sort === 'volume'
          ? 'volume DESC,id DESC'
          : q.sort === 'closing'
            ? 'closes_at ASC,id DESC'
            : 'created_at DESC,id DESC';
    } else if (collection === 'trades') {
      assert(q.marketId, 'Market ID is required', 400);
      assert(
        (await c.query('SELECT 1 FROM markets WHERE id=$1', [q.marketId])).rowCount,
        'Market not found',
        404,
      );
      sql = `SELECT id,outcome_id,price,quantity,created_at FROM trades WHERE market_id=${bind(q.marketId)}`;
      if (q.outcomeId) sql += ` AND outcome_id=${bind(q.outcomeId)}`;
      order = 'created_at DESC,id DESC';
    } else if (collection === 'leaderboard') {
      sql = `SELECT a.id,a.name,a.epoch,a.created_at,COALESCE(SUM(l.delta),0)::bigint AS profit,COUNT(DISTINCT l.market_id)::integer AS markets FROM accounts a JOIN ledger l ON l.account_id=a.id AND l.epoch=a.epoch JOIN markets m ON m.id=l.market_id AND m.status='settled' WHERE NOT a.bot AND l.kind NOT IN ('grant','reset','bot-grant') GROUP BY a.id`;
      order = 'profit DESC,created_at ASC,id ASC';
    } else {
      assert(user, 'Sign in required', 401);
      const account = bind(user.id);
      if (collection === 'holdings') {
        sql = `SELECT h.*,o.market_id,o.label,m.title,m.status,(SELECT price FROM trades WHERE outcome_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1) AS mark FROM holdings h JOIN outcomes o ON o.id=h.outcome_id JOIN markets m ON m.id=o.market_id WHERE h.account_id=${account} AND h.quantity>0`;
        order = 'title ASC,market_id ASC,outcome_id ASC';
      } else if (collection === 'activity') {
        sql = `SELECT l.id,l.kind,l.delta,l.created_at,l.epoch,m.title FROM ledger l LEFT JOIN markets m ON m.id=l.market_id WHERE l.account_id=${account}`;
        order = 'id DESC';
      } else {
        sql = `SELECT o.*,m.title,oc.label FROM orders o JOIN markets m ON m.id=o.market_id JOIN outcomes oc ON oc.id=o.outcome_id WHERE o.account_id=${account}`;
        if (collection === 'open-orders') sql += ` AND o.status='open'`;
        order = 'sequence DESC';
      }
    }
    const total = Number(
      (await c.query(`SELECT COUNT(*) AS total FROM (${sql}) records`, values)).rows[0].total,
    );
    const pages = Math.max(1, Math.ceil(total / q.pageSize));
    const page = Math.min(q.page, pages);
    const rows = (
      await c.query(
        `${sql} ORDER BY ${order} LIMIT ${bind(q.pageSize)} OFFSET ${bind((page - 1) * q.pageSize)}`,
        values,
      )
    ).rows;
    let items = rows;
    if (collection === 'markets' && rows.length) {
      const markets = await marketRows(
        c,
        rows.map((r) => r.id),
      );
      const byId = new Map(markets.map((m) => [m.id, m]));
      items = rows.map((r) => byId.get(r.id)!);
    }
    return { items, page, pageSize: q.pageSize, total, pages };
  });
}
