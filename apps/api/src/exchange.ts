import { randomUUID, createHash } from 'node:crypto';
import {
  DOLLAR,
  GRANT,
  CENT,
  type OrderInput,
  type MarketInput,
  type SetInput,
  type OrderResult,
  type BotInput,
} from '@minimarket/shared';
import { assert, events, pool, transaction, type Tx } from './db.ts';

type MarketRow = {
  id: string;
  status: string;
  closes_at: Date;
  halted: boolean;
  collateral: number;
};
type OrderRow = {
  id: string;
  account_id: string;
  outcome_id: string;
  market_id: string;
  side: 'buy' | 'sell';
  price: number;
  remaining: number;
};
async function command<T>(
  actor: string,
  key: string,
  payload: unknown,
  fn: (c: Tx, changed: Set<string>) => Promise<T>,
): Promise<T> {
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const done = await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [actor + key]);
    const previous = (
      await c.query('SELECT * FROM commands WHERE account_id=$1 AND key=$2', [actor, key])
    ).rows[0];
    if (previous) {
      assert(
        previous.fingerprint === fingerprint,
        'Idempotency key already used for a different request',
        409,
      );
      return { result: previous.result as T, updates: [] };
    }
    const changed = new Set<string>();
    const result = await fn(c, changed);
    const updates = [];
    for (const id of changed) {
      const row = (
        await c.query('UPDATE markets SET version=version+1 WHERE id=$1 RETURNING id,version', [id])
      ).rows[0];
      updates.push(row);
    }
    await c.query('INSERT INTO commands(account_id,key,fingerprint,result) VALUES($1,$2,$3,$4)', [
      actor,
      key,
      fingerprint,
      JSON.stringify(result),
    ]);
    return { result, updates };
  });
  for (const update of done.updates) events.emit('market', update);
  return done.result;
}
async function lockMarket(c: Tx, id: string): Promise<MarketRow> {
  const m = (await c.query('SELECT * FROM markets WHERE id=$1 FOR UPDATE', [id])).rows[0];
  assert(m, 'Market not found', 404);
  return m;
}
async function lockAccounts(c: Tx, marketId: string, actor?: string) {
  await c.query(
    `SELECT id FROM accounts WHERE id=$2 OR id IN (SELECT account_id FROM orders WHERE market_id=$1 AND status='open' UNION SELECT h.account_id FROM holdings h JOIN outcomes o ON o.id=h.outcome_id WHERE o.market_id=$1) ORDER BY id FOR UPDATE`,
    [marketId, actor ?? null],
  );
}
function requireOpen(m: MarketRow) {
  assert(
    m.status === 'open' && !m.halted && new Date(m.closes_at).getTime() > Date.now(),
    'This market is closed for trading',
    409,
  );
}
async function ledger(
  c: Tx,
  account: string,
  market: string | null,
  delta: number,
  kind: string,
  reference: string,
) {
  await c.query(
    'INSERT INTO ledger(account_id,market_id,epoch,delta,kind,reference) SELECT id,$2,epoch,$3,$4,$5 FROM accounts WHERE id=$1',
    [account, market, delta, kind, reference],
  );
}
async function cash(c: Tx, account: string, delta: number) {
  const r = await c.query(
    'UPDATE accounts SET cash=cash+$2 WHERE id=$1 AND cash+$2>=reserved RETURNING id',
    [account, delta],
  );
  assert(r.rowCount, 'Insufficient available cash', 409);
}
async function holding(c: Tx, account: string, outcome: string, delta: number) {
  if (delta >= 0)
    await c.query(
      'INSERT INTO holdings(account_id,outcome_id,quantity) VALUES($1,$2,$3) ON CONFLICT(account_id,outcome_id) DO UPDATE SET quantity=holdings.quantity+$3',
      [account, outcome, delta],
    );
  else {
    const r = await c.query(
      'UPDATE holdings SET quantity=quantity+$3 WHERE account_id=$1 AND outcome_id=$2 AND quantity+$3>=reserved RETURNING account_id',
      [account, outcome, delta],
    );
    assert(r.rowCount, 'Insufficient available shares', 409);
  }
}
async function cancelInTx(c: Tx, order: OrderRow) {
  if (order.side === 'buy')
    await c.query('UPDATE accounts SET reserved=reserved-$2 WHERE id=$1', [
      order.account_id,
      order.price * order.remaining,
    ]);
  else
    await c.query(
      'UPDATE holdings SET reserved=reserved-$3 WHERE account_id=$1 AND outcome_id=$2',
      [order.account_id, order.outcome_id, order.remaining],
    );
  await c.query("UPDATE orders SET status='canceled' WHERE id=$1", [order.id]);
}
async function cancelMarket(c: Tx, id: string) {
  for (const o of (
    await c.query("SELECT * FROM orders WHERE market_id=$1 AND status='open' ORDER BY sequence", [
      id,
    ])
  ).rows)
    await cancelInTx(c, o);
}
export async function expireMarket(id: string) {
  const update = await transaction(async (c) => {
    const m = await lockMarket(c, id);
    if (m.status !== 'open' || new Date(m.closes_at).getTime() > Date.now()) return null;
    await lockAccounts(c, id);
    await cancelMarket(c, id);
    return (
      await c.query(
        "UPDATE markets SET status='closed',version=version+1 WHERE id=$1 RETURNING id,version",
        [id],
      )
    ).rows[0];
  });
  if (update) events.emit('market', update);
}
export async function createAccount(subject: string, email: string, name: string, admin = false) {
  return transaction(async (c) => {
    const existing = (
      await c.query(
        'SELECT id,name,email,admin,cash,reserved,epoch,reset_used AS "resetUsed" FROM accounts WHERE subject=$1',
        [subject],
      )
    ).rows[0];
    if (existing) {
      return (
        await c.query(
          'UPDATE accounts SET email=$2,name=$3,admin=$4 WHERE id=$1 RETURNING id,name,email,admin,cash,reserved,epoch,reset_used AS "resetUsed"',
          [existing.id, email, name, admin],
        )
      ).rows[0];
    }
    const id = randomUUID();
    const a = (
      await c.query(
        'INSERT INTO accounts(id,subject,email,name,admin,cash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,admin,cash,reserved,epoch,reset_used AS "resetUsed"',
        [id, subject, email, name, admin, GRANT],
      )
    ).rows[0];
    await ledger(c, id, null, GRANT, 'grant', id);
    return a;
  });
}
export async function createMarket(actor: string, key: string, input: MarketInput, demo = false) {
  return command(actor, key, { action: 'market', input, demo }, async (c, changed) => {
    assert(new Date(input.closesAt).getTime() > Date.now(), 'Closing time must be in the future');
    const id = randomUUID();
    await c.query(
      'INSERT INTO markets(id,creator_id,title,category,criteria,source,closes_at,kind,demo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        actor,
        input.title,
        input.category,
        input.criteria,
        input.source,
        input.closesAt,
        input.kind,
        demo,
      ],
    );
    for (const [ordinal, label] of input.outcomes.entries())
      await c.query('INSERT INTO outcomes(id,market_id,label,ordinal) VALUES($1,$2,$3,$4)', [
        randomUUID(),
        id,
        label,
        ordinal,
      ]);
    changed.add(id);
    return { id };
  });
}
async function setInTx(c: Tx, actor: string, input: SetInput) {
  const outcomes = (
    await c.query('SELECT id FROM outcomes WHERE market_id=$1 ORDER BY ordinal', [input.marketId])
  ).rows;
  const delta = input.quantity * DOLLAR;
  const mint = input.action === 'mint';
  if (mint) await cash(c, actor, -delta);
  for (const o of outcomes) await holding(c, actor, o.id, mint ? input.quantity : -input.quantity);
  if (!mint) await cash(c, actor, delta);
  await c.query('UPDATE markets SET collateral=collateral+$2 WHERE id=$1', [
    input.marketId,
    mint ? delta : -delta,
  ]);
  await ledger(c, actor, input.marketId, mint ? -delta : delta, input.action, randomUUID());
  return { quantity: input.quantity };
}
export async function completeSet(actor: string, key: string, input: SetInput) {
  await expireMarket(input.marketId);
  return command(actor, key, { action: 'set', input }, async (c, changed) => {
    const m = await lockMarket(c, input.marketId);
    requireOpen(m);
    await lockAccounts(c, m.id, actor);
    const result = await setInTx(c, actor, input);
    changed.add(m.id);
    return result;
  });
}
async function placeInTx(c: Tx, actor: string, input: OrderInput): Promise<OrderResult> {
  const valid = await c.query('SELECT 1 FROM outcomes WHERE id=$1 AND market_id=$2', [
    input.outcomeId,
    input.marketId,
  ]);
  assert(valid.rowCount, 'Outcome does not belong to this market');
  const id = randomUUID();
  if (input.side === 'buy') {
    const r = await c.query(
      'UPDATE accounts SET reserved=reserved+$2 WHERE id=$1 AND cash-reserved >= $2 RETURNING id',
      [actor, input.price * input.quantity],
    );
    assert(r.rowCount, 'Insufficient available cash', 409);
  } else {
    const r = await c.query(
      'UPDATE holdings SET reserved=reserved+$3 WHERE account_id=$1 AND outcome_id=$2 AND quantity-reserved >= $3 RETURNING account_id',
      [actor, input.outcomeId, input.quantity],
    );
    assert(r.rowCount, 'Insufficient available shares', 409);
  }
  await c.query(
    "INSERT INTO orders(id,account_id,market_id,outcome_id,side,price,quantity,remaining,status,tif) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'open',$8)",
    [
      id,
      actor,
      input.marketId,
      input.outcomeId,
      input.side,
      input.price,
      input.quantity,
      input.tif,
    ],
  );
  const buy = input.side === 'buy';
  const matches = (
    await c.query(
      `SELECT * FROM orders WHERE outcome_id=$1 AND side=$2 AND status='open' AND price ${buy ? '<=' : '>='} $3 ORDER BY price ${buy ? 'ASC' : 'DESC'},sequence ASC FOR UPDATE`,
      [input.outcomeId, buy ? 'sell' : 'buy', input.price],
    )
  ).rows as OrderRow[];
  let remaining = input.quantity;
  let cancel = false;
  const fills: { price: number; quantity: number }[] = [];
  for (const resting of matches) {
    if (!remaining) break;
    if (resting.account_id === actor) {
      cancel = true;
      break;
    }
    const quantity = Math.min(remaining, resting.remaining),
      price = resting.price;
    const buyer = buy ? actor : resting.account_id,
      seller = buy ? resting.account_id : actor,
      buyLimit = buy ? input.price : resting.price;
    await c.query('UPDATE accounts SET reserved=reserved-$2,cash=cash-$3 WHERE id=$1', [
      buyer,
      buyLimit * quantity,
      price * quantity,
    ]);
    await c.query(
      'UPDATE holdings SET reserved=reserved-$3,quantity=quantity-$3 WHERE account_id=$1 AND outcome_id=$2',
      [seller, input.outcomeId, quantity],
    );
    await cash(c, seller, price * quantity);
    await holding(c, buyer, input.outcomeId, quantity);
    const tradeId = randomUUID();
    await c.query(
      'INSERT INTO trades(id,market_id,outcome_id,buy_order_id,sell_order_id,price,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tradeId,
        input.marketId,
        input.outcomeId,
        buy ? id : resting.id,
        buy ? resting.id : id,
        price,
        quantity,
      ],
    );
    await ledger(c, buyer, input.marketId, -price * quantity, 'buy', tradeId);
    await ledger(c, seller, input.marketId, price * quantity, 'sell', tradeId);
    await c.query(
      "UPDATE orders SET remaining=remaining-$2,status=CASE WHEN remaining=$2 THEN 'filled' ELSE 'open' END WHERE id=$1",
      [resting.id, quantity],
    );
    remaining -= quantity;
    fills.push({ price, quantity });
  }
  await c.query(
    "UPDATE orders SET remaining=$2,status=CASE WHEN $2=0 THEN 'filled' ELSE 'open' END WHERE id=$1",
    [id, remaining],
  );
  const canceled = remaining && (cancel || input.tif === 'IOC') ? remaining : 0;
  if (canceled)
    await cancelInTx(c, {
      id,
      account_id: actor,
      market_id: input.marketId,
      outcome_id: input.outcomeId,
      side: input.side,
      price: input.price,
      remaining,
    });
  const filled = input.quantity - remaining;
  return {
    id,
    filled,
    remaining: remaining - canceled,
    canceled,
    averagePrice: filled
      ? Math.round(fills.reduce((n, f) => n + f.price * f.quantity, 0) / filled)
      : null,
    fills,
  };
}
export async function placeOrder(actor: string, key: string, input: OrderInput) {
  await expireMarket(input.marketId);
  return command(actor, key, { action: 'order', input }, async (c, changed) => {
    const m = await lockMarket(c, input.marketId);
    requireOpen(m);
    await lockAccounts(c, m.id, actor);
    const result = await placeInTx(c, actor, input);
    changed.add(m.id);
    return result;
  });
}
export async function cancelOrder(actor: string, key: string, id: string) {
  return command(actor, key, { action: 'cancel', id }, async (c, changed) => {
    const o = (await c.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
    assert(o && o.account_id === actor, 'Order not found', 404);
    await lockMarket(c, o.market_id);
    await lockAccounts(c, o.market_id, actor);
    const current = (await c.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
    if (current.status === 'open') await cancelInTx(c, current);
    changed.add(o.market_id);
    return { id };
  });
}
async function requireAdmin(c: Tx, actor: string) {
  assert(
    (await c.query('SELECT admin FROM accounts WHERE id=$1', [actor])).rows[0]?.admin,
    'Admin access required',
    403,
  );
}
export async function moderate(
  actor: string,
  key: string,
  id: string,
  action: 'hide' | 'show' | 'halt',
) {
  return command(actor, key, { action, id }, async (c, changed) => {
    await requireAdmin(c, actor);
    await lockMarket(c, id);
    await lockAccounts(c, id, actor);
    if (action === 'halt') {
      await cancelMarket(c, id);
      await c.query('UPDATE markets SET halted=true WHERE id=$1', [id]);
    } else await c.query('UPDATE markets SET hidden=$2 WHERE id=$1', [id, action === 'hide']);
    changed.add(id);
    return { id };
  });
}
export async function settle(
  actor: string,
  key: string,
  id: string,
  winnerId: string | null,
  evidence: string,
) {
  return command(actor, key, { action: 'settle', id, winnerId, evidence }, async (c, changed) => {
    await requireAdmin(c, actor);
    const m = await lockMarket(c, id);
    assert(m.status !== 'settled', 'Settlement is final', 409);
    assert(
      m.halted || m.status === 'closed' || new Date(m.closes_at).getTime() <= Date.now(),
      'Close or halt this market before settlement',
      409,
    );
    await lockAccounts(c, id, actor);
    await cancelMarket(c, id);
    const outcomes = (
      await c.query('SELECT * FROM outcomes WHERE market_id=$1 ORDER BY ordinal', [id])
    ).rows;
    assert(winnerId === null || outcomes.some((o) => o.id === winnerId), 'Invalid winning outcome');
    let paid = 0;
    for (const [i, o] of outcomes.entries()) {
      const payout = winnerId
        ? o.id === winnerId
          ? DOLLAR
          : 0
        : Math.floor(DOLLAR / outcomes.length) + (i < DOLLAR % outcomes.length ? 1 : 0);
      await c.query('UPDATE outcomes SET payout=$2 WHERE id=$1', [o.id, payout]);
      for (const h of (
        await c.query('SELECT * FROM holdings WHERE outcome_id=$1 AND quantity>0', [o.id])
      ).rows) {
        const amount = h.quantity * payout;
        await cash(c, h.account_id, amount);
        await ledger(c, h.account_id, id, amount, winnerId ? 'settlement' : 'void', o.id);
        paid += amount;
      }
      await c.query('UPDATE holdings SET quantity=0,reserved=0 WHERE outcome_id=$1', [o.id]);
    }
    assert(paid === m.collateral, 'Collateral invariant failed', 500);
    await c.query("UPDATE markets SET status='settled',collateral=0,evidence=$2 WHERE id=$1", [
      id,
      evidence,
    ]);
    changed.add(id);
    return { id, paid };
  });
}
export async function resetAccount(actor: string, key: string) {
  return command(actor, key, { action: 'reset' }, async (c, changed) => {
    const markets = (
      await c.query(
        "SELECT id FROM markets WHERE id IN (SELECT market_id FROM orders WHERE account_id=$1 AND status='open') ORDER BY id FOR UPDATE",
        [actor],
      )
    ).rows;
    const account = (
      await c.query('SELECT cash,reset_used FROM accounts WHERE id=$1 FOR UPDATE', [actor])
    ).rows[0];
    assert(account, 'Account not found', 404);
    assert(!account.reset_used, 'The one-time account reset has already been used', 409);
    const h = await c.query('SELECT 1 FROM holdings WHERE account_id=$1 AND quantity>0 LIMIT 1', [
      actor,
    ]);
    assert(!h.rowCount, 'Sell or settle all holdings before resetting', 409);
    for (const o of (
      await c.query("SELECT * FROM orders WHERE account_id=$1 AND status='open'", [actor])
    ).rows)
      await cancelInTx(c, o);
    await c.query(
      'UPDATE accounts SET epoch=epoch+1,cash=$2,reserved=0,reset_used=true WHERE id=$1',
      [actor, GRANT],
    );
    await ledger(c, actor, null, GRANT - account.cash, 'reset', key);
    for (const m of markets) changed.add(m.id);
    return { cash: GRANT };
  });
}
export async function allocateBot(actor: string, key: string, input: BotInput) {
  return command(actor, key, { action: 'bot', input }, async (c, changed) => {
    await requireAdmin(c, actor);
    const m = await lockMarket(c, input.marketId);
    requireOpen(m);
    assert(
      !(await c.query('SELECT 1 FROM bots WHERE market_id=$1', [m.id])).rowCount,
      'This market already has a finite bot allocation',
      409,
    );
    const outcomes = (await c.query('SELECT id FROM outcomes WHERE market_id=$1', [m.id])).rows;
    assert(
      outcomes.length === input.probabilities.length,
      'Provide a probability for every outcome',
    );
    const id = randomUUID();
    await c.query('INSERT INTO accounts(id,name,bot,cash) VALUES($1,$2,true,$3)', [
      id,
      'Demo liquidity bot',
      input.budget,
    ]);
    await ledger(c, id, m.id, input.budget, 'bot-grant', key);
    await c.query(
      'INSERT INTO bots(market_id,account_id,budget,probabilities,spread,size) VALUES($1,$2,$3,$4,$5,$6)',
      [m.id, id, input.budget, input.probabilities, input.spread, input.size],
    );
    await setInTx(c, id, {
      marketId: m.id,
      action: 'mint',
      quantity: Math.floor(input.budget / DOLLAR / 2),
    });
    changed.add(m.id);
    return { id };
  });
}
export async function quoteBot(id: string) {
  await expireMarket(id);
  const update = await transaction(async (c) => {
    const m = await lockMarket(c, id);
    if (m.status !== 'open' || m.halted || new Date(m.closes_at).getTime() <= Date.now())
      return null;
    const b = (
      await c.query(
        "SELECT *, last_tick > clock_timestamp() - interval '15 seconds' AS cooling_down FROM bots WHERE market_id=$1",
        [id],
      )
    ).rows[0];
    if (!b || b.cooling_down) return null;
    await lockAccounts(c, id, b.account_id);
    for (const o of (
      await c.query("SELECT * FROM orders WHERE account_id=$1 AND status='open'", [b.account_id])
    ).rows)
      await cancelInTx(c, o);
    const outcomes = (
      await c.query(
        'SELECT o.*,COALESCE(h.quantity,0) AS quantity FROM outcomes o LEFT JOIN holdings h ON h.outcome_id=o.id AND h.account_id=$2 WHERE o.market_id=$1 ORDER BY ordinal',
        [id, b.account_id],
      )
    ).rows;
    const baseline = Math.floor(b.budget / DOLLAR / 2);
    for (const o of outcomes) {
      const skew = Math.max(
        -5,
        Math.min(5, Math.round(((baseline - o.quantity) / Math.max(1, baseline)) * 5)),
      );
      const fair = Math.round(b.probabilities[o.ordinal] / 100) + skew;
      const ask = Math.max(1, Math.min(99, fair + b.spread)) * CENT,
        bid = Math.max(1, Math.min(99, fair - b.spread)) * CENT;
      if (o.quantity > 0)
        await placeInTx(c, b.account_id, {
          marketId: id,
          outcomeId: o.id,
          side: 'sell',
          price: ask,
          quantity: Math.min(b.size, o.quantity),
          tif: 'GTC',
        });
      const available = (
        await c.query('SELECT cash-reserved AS available FROM accounts WHERE id=$1', [b.account_id])
      ).rows[0].available;
      const quantity = Math.min(b.size, Math.floor(available / bid));
      if (quantity > 0 && bid < ask)
        await placeInTx(c, b.account_id, {
          marketId: id,
          outcomeId: o.id,
          side: 'buy',
          price: bid,
          quantity,
          tif: 'GTC',
        });
    }
    await c.query('UPDATE bots SET last_tick=now() WHERE market_id=$1', [id]);
    return (
      await c.query('UPDATE markets SET version=version+1 WHERE id=$1 RETURNING id,version', [id])
    ).rows[0];
  });
  if (update) events.emit('market', update);
}
