import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowUpRightIcon, WalletIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { money, cents, type Portfolio } from '@minimarket/shared';
import { api, useAction, useSession } from '../lib';
import { Empty, Notice, SignIn } from '../components/ui';
export const Route = createFileRoute('/portfolio')({ component: PortfolioPage });
function PortfolioPage() {
  const { data: session, isLoading } = useSession();
  const { data: p, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/api/portfolio'),
    enabled: !!session?.user,
  });
  const [tab, setTab] = useState('Holdings'),
    [reset, setReset] = useState(false);
  const action = useAction();
  if (isLoading) return <p>Loading account…</p>;
  if (!session?.user) return <SignIn />;
  if (error) return <Notice error>{error.message}</Notice>;
  if (!p) return <p>Loading portfolio…</p>;
  return (
    <>
      <section className="discovery-intro">
        <div>
          <span className="eyebrow">YOUR PERSPECTIVE, IN POSITIONS</span>
          <h1>Portfolio</h1>
          <p>Welcome back, {p.user.name}. Here’s where your conviction stands.</p>
        </div>
        <Link to="/" className="button secondary">
          Explore markets <ArrowUpRightIcon size={17} />
        </Link>
      </section>
      <div className="portfolio-stats">
        <div>
          <span>Estimated portfolio value</span>
          <strong>{money(p.estimatedValue)}</strong>
          <small>Cash + holdings at last-traded prices</small>
        </div>
        <div>
          <span>Available to trade</span>
          <strong>{money(p.user.cash - p.user.reserved)}</strong>
          <small>{money(p.user.reserved)} reserved in orders</small>
        </div>
        <div>
          <span>Settled profit</span>
          <strong className={p.settledProfit >= 0 ? 'green-text' : 'red-text'}>
            {p.settledProfit > 0 ? '+' : ''}
            {money(p.settledProfit)}
          </strong>
          <small>Current account history · {p.user.epoch + 1}</small>
        </div>
      </div>
      {p.unpricedShares > 0 && (
        <Notice>
          {p.unpricedShares} shares have no executed trade price and are excluded from the estimate.
          This estimate is not a liquidation quote.
        </Notice>
      )}
      <div className="underlined-tabs">
        {['Holdings', 'Open orders', 'Order history', 'Activity'].map((t) => (
          <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Open orders' && (
              <span className="count">{p.orders.filter((o) => o.status === 'open').length}</span>
            )}
          </button>
        ))}
      </div>
      {action.isError && <Notice error>{action.error.message}</Notice>}
      <div className="table-scroll">
        {tab === 'Holdings' ? (
          p.holdings.length ? (
            <table>
              <thead>
                <tr>
                  <th>Market / outcome</th>
                  <th>Shares</th>
                  <th>Reserved</th>
                  <th>Last trade</th>
                  <th>Est. value</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.map((h) => (
                  <tr key={h.outcome_id}>
                    <td>
                      <Link to="/markets/$id" params={{ id: h.market_id }}>
                        {h.title}
                      </Link>
                      <small>{h.label}</small>
                    </td>
                    <td>{h.quantity}</td>
                    <td>{h.reserved}</td>
                    <td>{cents(h.mark)}</td>
                    <td>{h.mark === null ? 'Unpriced' : money(h.mark * h.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="Your next idea could be your first position.">
              Explore a market and buy an outcome, or mint a complete set.
            </Empty>
          )
        ) : tab === 'Activity' ? (
          p.history.length ? (
            <table>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Market</th>
                  <th>Cash movement</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {p.history.map((h) => (
                  <tr key={h.id}>
                    <td className="capitalize">
                      {h.kind}
                      <small>History {h.epoch + 1}</small>
                    </td>
                    <td>{h.title ?? 'Account balance'}</td>
                    <td className={h.delta >= 0 ? 'green-text' : ''}>
                      {h.delta > 0 ? '+' : ''}
                      {money(h.delta, 6)}
                    </td>
                    <td>{new Date(h.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No activity yet" />
          )
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Market / outcome</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Remaining / total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.orders
                  .filter((o) => tab === 'Order history' || o.status === 'open')
                  .map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link to="/markets/$id" params={{ id: o.market_id }}>
                          {o.title}
                        </Link>
                        <small>{o.label}</small>
                      </td>
                      <td className="capitalize">{o.side}</td>
                      <td>{cents(o.price)}</td>
                      <td>
                        {o.remaining} / {o.quantity}
                      </td>
                      <td>{o.status}</td>
                      <td>
                        {o.status === 'open' && (
                          <button
                            className="text-button"
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate({ path: `/api/orders/${o.id}/cancel`, body: {} })
                            }
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!p.orders.some((o) => tab === 'Order history' || o.status === 'open') && (
              <Empty title="No orders here">Your orders will appear as you trade.</Empty>
            )}
          </>
        )}
      </div>
      <section className="reset-panel">
        <div>
          <h3>
            <ArrowCounterClockwiseIcon size={17} /> A fresh start
          </h3>
          <p>
            Reset to 10,000 play dollars once you have no holdings. Open orders are canceled and
            ranked performance starts over.
          </p>
        </div>
        <button className="secondary" onClick={() => setReset(!reset)}>
          Reset account
        </button>
        {reset && (
          <div className="reset-confirm">
            <p>
              Previous activity stays in your audit history. Your current leaderboard record will be
              cleared.
            </p>
            <button
              disabled={action.isPending || p.holdings.length > 0}
              onClick={() =>
                action.mutate(
                  { path: '/api/reset', body: {} },
                  { onSuccess: () => setReset(false) },
                )
              }
            >
              Confirm reset
            </button>
            {p.holdings.length > 0 && <small>Sell, redeem, or settle all holdings first.</small>}
          </div>
        )}
      </section>
    </>
  );
}
