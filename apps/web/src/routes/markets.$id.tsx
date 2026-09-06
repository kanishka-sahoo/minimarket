import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  InfoIcon,
  ArrowsLeftRightIcon,
} from '@phosphor-icons/react';
import {
  CENT,
  DOLLAR,
  cents,
  money,
  type Snapshot,
  type Trade,
  type Portfolio,
  type OrderResult,
} from '@minimarket/shared';
import { api, useAction, useLive, useSession } from '../lib';
import { Pagination, usePage } from '../components/pagination';
import { CategoryIcon, Closing, Notice, PriceChart, Empty, TableSkeleton } from '../components/ui';
export const Route = createFileRoute('/markets/$id')({
  loader: ({ params }) => api<Snapshot>('/api/markets/' + params.id),
  component: MarketDetail,
});
function MarketDetail() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const { data: s = initial } = useQuery({
    queryKey: ['market', id],
    queryFn: () => api<Snapshot>('/api/markets/' + id),
    initialData: initial,
  });
  const connected = useLive(id);
  const [outcomeId, setOutcome] = useState(s.market.outcomes[0].id);
  const [tab, setTab] = useState('Order book');
  const history = usePage<Trade>('trades', { marketId: id });
  const chart = usePage<Trade>('trades', { marketId: id, outcomeId, pageSize: '100' });
  const m = s.market,
    o = m.outcomes.find((o) => o.id === outcomeId) ?? m.outcomes[0],
    book = s.books[o.id];
  return (
    <>
      <Link to="/" className="back-link">
        <ArrowLeftIcon size={15} /> All markets
      </Link>
      <div className="market-layout">
        <div className="market-main">
          <header className="market-title">
            <CategoryIcon category={m.category} large />
            <div>
              <div className="market-meta">
                <span>{m.category}</span>
                {m.demo && <span className="tag">Fictional demo</span>}
                {m.bot && <span className="tag">Bot liquidity</span>}
                <span className={`live-state ${connected ? 'online' : ''}`}>
                  {connected ? 'Live updates' : 'Connecting…'}
                </span>
              </div>
              <h1>{m.title}</h1>
            </div>
          </header>
          <div className="market-stats">
            <Closing date={m.closes_at} />
            <span>{money(m.volume)} traded</span>
            <span>
              {m.status === 'settled'
                ? 'Settled'
                : m.halted
                  ? 'Halted'
                  : Date.parse(m.closes_at) <= Date.now()
                    ? 'Closed'
                    : m.status === 'closed'
                      ? 'Closed'
                      : 'Open for trading'}
            </span>
          </div>
          {m.demo && (
            <div className="demo-strip">
              <InfoIcon size={17} />
              <span>Fictional scenario. Quotes are demonstrations, not forecasts.</span>
            </div>
          )}
          <section className="chart-panel">
            <div className="chart-heading">
              <div>
                <span className="muted">{o.label} · Last trade</span>
                <strong>{o.last === null ? 'No trades' : `${Math.round(o.last / CENT)}%`}</strong>
              </div>
              <span className="tag">Executed trades</span>
            </div>
            <PriceChart trades={chart.data?.items ?? []} outcome={o} />
            {chart.error && <Notice error>{chart.error.message}</Notice>}
            <Pagination data={chart.data} setPage={chart.setPage} label="Chart trades" />
          </section>
          <section className="outcome-table">
            <div className="table-labels">
              <span>Outcome</span>
              <span>Last trade</span>
              <span>Bid / Ask</span>
            </div>
            {m.outcomes.map((outcome) => (
              <button
                key={outcome.id}
                className={`outcome-row ${o.id === outcome.id ? 'chosen' : ''}`}
                onClick={() => setOutcome(outcome.id)}
              >
                <span>
                  <i />
                  {outcome.label}
                </span>
                <strong>
                  {outcome.payout !== null
                    ? `${cents(outcome.payout)} payout`
                    : cents(outcome.last)}
                </strong>
                <span className="quote-pair">
                  {cents(outcome.bid)} <span>/</span> {cents(outcome.ask)}
                </span>
              </button>
            ))}
          </section>
          <section className="market-data">
            <div className="underlined-tabs">
              {['Order book', 'Recent trades', 'Resolution rules'].map((t) => (
                <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            {tab === 'Order book' ? (
              <div className="books">
                <Book side="Buy orders" levels={book.bids} />
                <Book side="Sell orders" levels={book.asks} />
              </div>
            ) : tab === 'Recent trades' ? (
              history.isPending ? (
                <TableSkeleton rows={4} />
              ) : history.error ? (
                <Notice error>{history.error.message}</Notice>
              ) : history.data?.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Outcome</th>
                        <th>Price</th>
                        <th>Shares</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.items.map((t) => (
                        <tr key={t.id}>
                          <td>{m.outcomes.find((o) => o.id === t.outcome_id)?.label}</td>
                          <td>{cents(t.price)}</td>
                          <td>{t.quantity}</td>
                          <td>{new Date(t.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No trades yet">The first matched order will appear here.</Empty>
              )
            ) : (
              <div className="rules">
                <h3>How this market resolves</h3>
                <p>{m.criteria}</p>
                <a href={m.source} target="_blank" rel="noreferrer">
                  Published evidence source <ArrowUpRightIcon size={15} />
                </a>
                {m.evidence && <Notice>Resolution evidence: {m.evidence}</Notice>}
              </div>
            )}
            {tab === 'Recent trades' && (
              <Pagination data={history.data} setPage={history.setPage} label="Trades" />
            )}
          </section>
        </div>
        <aside className="trade-sidebar">
          <TradePanel key={o.id} snapshot={s} outcomeId={o.id} connected={connected} />
        </aside>
      </div>
    </>
  );
}
function Book({ side, levels }: { side: string; levels: { price: number; quantity: number }[] }) {
  const [page, setPage] = useState(1);
  const current = Math.min(page, Math.max(1, Math.ceil(levels.length / 8)));
  return (
    <div>
      <h3 className={side === 'Buy orders' ? 'green-text' : ''}>{side}</h3>
      <div className="book-label">
        <span>Price</span>
        <span>Shares</span>
        <span>Total</span>
      </div>
      {levels.length ? (
        levels.slice((current - 1) * 8, current * 8).map((l) => (
          <div key={l.price} className="book-level">
            <strong>{cents(l.price)}</strong>
            <span>{l.quantity}</span>
            <span>{money(l.quantity * l.price)}</span>
          </div>
        ))
      ) : (
        <p className="book-empty">No resting orders</p>
      )}
      <Pagination
        data={{
          page: current,
          pages: Math.max(1, Math.ceil(levels.length / 8)),
          total: levels.length,
          pageSize: 8,
        }}
        setPage={setPage}
        label={side}
      />
    </div>
  );
}
function TradePanel({
  snapshot: s,
  outcomeId,
  connected,
}: {
  snapshot: Snapshot;
  outcomeId: string;
  connected: boolean;
}) {
  const { data: session } = useSession();
  const user = session?.user;
  const { data: p } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/api/portfolio'),
    enabled: !!user,
  });
  const [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [mode, setMode] = useState<'instant' | 'limit'>('instant'),
    [quantity, setQuantity] = useState(10),
    [price, setPrice] = useState(50),
    [slippage, setSlippage] = useState(3),
    [setQuantityValue, setSetQuantity] = useState(1);
  const [preview, setPreview] = useState<{
    price: number;
    quantity: number;
    side: 'buy' | 'sell';
    cost: number;
    filled: number;
  } | null>(null);
  const action = useAction<OrderResult>(),
    sets = useAction();
  const m = s.market,
    o = m.outcomes.find((o) => o.id === outcomeId)!;
  const levels = side === 'buy' ? s.books[o.id].asks : s.books[o.id].bids;
  const best = levels[0]?.price;
  const open = m.status === 'open' && !m.halted && Date.parse(m.closes_at) > Date.now();
  const holding = p?.holdings.find((h) => h.outcome_id === o.id);
  const available =
    side === 'buy'
      ? p
        ? money(p.user.cash - p.user.reserved)
        : null
      : `${holding ? holding.quantity - holding.reserved : 0} shares`;
  useEffect(() => {
    setPreview(null);
  }, [side, mode, quantity, price, slippage]);
  const prepare = () => {
    if (best === undefined) return;
    const limit = Math.max(
      CENT,
      Math.min(99 * CENT, best + (side === 'buy' ? 1 : -1) * slippage * CENT),
    );
    let left = quantity,
      cost = 0;
    for (const l of levels) {
      if (side === 'buy' ? l.price > limit : l.price < limit) break;
      const q = Math.min(left, l.quantity);
      cost += q * l.price;
      left -= q;
      if (!left) break;
    }
    setPreview({ price: limit, quantity, side, cost, filled: quantity - left });
  };
  const submit = () => {
    const current = mode === 'instant' ? preview : null;
    if (mode === 'instant' && !current) {
      prepare();
      return;
    }
    action.mutate(
      {
        path: '/api/orders',
        body: {
          marketId: m.id,
          outcomeId: o.id,
          side: current?.side ?? side,
          quantity: current?.quantity ?? quantity,
          price: current?.price ?? price * CENT,
          tif: mode === 'instant' ? 'IOC' : 'GTC',
        },
      },
      { onSuccess: () => setPreview(null) },
    );
  };
  return (
    <>
      <section className="trade-panel">
        <div className="trade-direction">
          {(['buy', 'sell'] as const).map((v) => (
            <button
              key={v}
              className={side === v ? 'selected' : ''}
              onClick={() => {
                setSide(v);
                action.reset();
              }}
            >
              {v === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
        <div className="trade-header">
          <h2>
            {side === 'buy' ? 'Buy' : 'Sell'} {o.label}
          </h2>
          <select
            aria-label="Order type"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'instant' | 'limit')}
          >
            <option value="instant">Instant</option>
            <option value="limit">Limit</option>
          </select>
        </div>
        {available !== null && (
          <div className="available">
            <span>Available</span>
            <strong>{available}</strong>
          </div>
        )}
        <label>
          Number of shares
          <input
            type="number"
            min="1"
            max="100000"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        {mode === 'limit' ? (
          <label>
            Limit price · cents
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </label>
        ) : (
          <label>
            Price protection · cents
            <input
              type="number"
              min="0"
              max="98"
              step="1"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
            />
            <small>Maximum movement beyond the best quoted price.</small>
          </label>
        )}
        <div className="trade-summary">
          <div>
            <span>{mode === 'instant' ? 'Best available price' : 'Limit price'}</span>
            <strong>{cents(mode === 'instant' ? (best ?? null) : price * CENT)}</strong>
          </div>
          <div>
            <span>{side === 'buy' ? 'Potential winning payout' : 'Shares to sell'}</span>
            <strong>{side === 'buy' ? money(quantity * DOLLAR) : quantity}</strong>
          </div>
          <div>
            <span>Trading fee</span>
            <span>$0.00</span>
          </div>
        </div>
        {preview && (
          <Notice>
            <strong>Review your trade</strong>
            <br />
            {preview.filled} of {preview.quantity} shares currently available for{' '}
            {money(preview.cost)} total. {side === 'buy' ? 'Maximum buy' : 'Minimum sell'} price:{' '}
            {cents(preview.price)}. Unfilled shares are canceled. Prices may change before
            execution.
          </Notice>
        )}
        {action.isError && <Notice error>{action.error.message}</Notice>}
        {action.isSuccess && (
          <Notice>
            {action.data.filled} shares filled at {cents(action.data.averagePrice)} average.{' '}
            {action.data.remaining} resting; {action.data.canceled} canceled.
          </Notice>
        )}
        {!user ? (
          <a className="button full" href="/login">
            Sign in to trade <ArrowUpRightIcon size={17} />
          </a>
        ) : (
          <button
            className="full"
            disabled={
              !open ||
              !connected ||
              action.isPending ||
              !Number.isInteger(quantity) ||
              quantity < 1 ||
              quantity > 100000 ||
              (mode === 'instant' && best === undefined)
            }
            onClick={submit}
          >
            {!open
              ? 'Trading closed'
              : !connected
                ? 'Connecting…'
                : action.isPending
                  ? 'Submitting…'
                  : mode === 'instant' && !preview
                    ? 'Preview trade'
                    : mode === 'instant'
                      ? 'Confirm trade'
                      : `Place ${side} order`}
          </button>
        )}
      </section>
      <details className="complete-sets">
        <summary>
          <ArrowsLeftRightIcon size={17} /> Mint or redeem complete sets
        </summary>
        <p>
          Lock $1 to receive one share of every outcome. Redeem one of each for $1 before closing.
          Shares reserved in orders cannot be redeemed.
        </p>
        <label>
          Number of sets
          <input
            type="number"
            min="1"
            max="100000"
            value={setQuantityValue}
            onChange={(e) => setSetQuantity(Number(e.target.value))}
          />
        </label>
        <div className="two-buttons">
          {(['mint', 'redeem'] as const).map((operation) => (
            <button
              key={operation}
              className="secondary"
              disabled={!user || !open || sets.isPending}
              onClick={() =>
                sets.mutate({
                  path: '/api/sets',
                  body: { marketId: m.id, quantity: setQuantityValue, action: operation },
                })
              }
            >
              {operation === 'mint' ? 'Mint' : 'Redeem'} {money(setQuantityValue * DOLLAR)}
            </button>
          ))}
        </div>
        {sets.isError && <Notice error>{sets.error.message}</Notice>}
        {sets.isSuccess && <Notice>Complete sets updated.</Notice>}
      </details>
    </>
  );
}
