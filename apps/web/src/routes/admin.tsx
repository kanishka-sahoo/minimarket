import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DOLLAR, type Market } from '@minimarket/shared';
import { api, useAction, useSession } from '../lib';
import { Notice, SignIn } from '../components/ui';
export const Route = createFileRoute('/admin')({ component: Admin });
function Admin() {
  const { data: session, isLoading } = useSession();
  const { data: markets = [] } = useQuery({
    queryKey: ['markets'],
    queryFn: () => api<Market[]>('/api/markets'),
    enabled: session?.user?.admin === true,
  });
  const [selected, setSelected] = useState('');
  if (isLoading) return <p>Loading account…</p>;
  if (!session?.user) return <SignIn />;
  if (!session.user.admin) return <Notice error>Administrator access is required.</Notice>;
  const market = markets.find((m) => m.id === selected);
  return (
    <>
      <section className="discovery-intro">
        <div>
          <span className="eyebrow">MARKET OPERATIONS</span>
          <h1>Admin controls</h1>
          <p>Curate discovery, allocate finite liquidity, and settle published questions.</p>
        </div>
      </section>
      <label className="admin-selector">
        Select a market
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose market…</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} · {m.status}
              {m.hidden ? ' · hidden' : ''}
            </option>
          ))}
        </select>
      </label>
      {market && <AdminMarket key={market.id} market={market} />}
    </>
  );
}
function AdminMarket({ market: m }: { market: Market }) {
  const action = useAction();
  const [winner, setWinner] = useState(m.outcomes[0].id),
    [evidence, setEvidence] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <h2>Market visibility</h2>
        <Link to="/markets/$id" params={{ id: m.id }}>
          {m.title}
        </Link>
        <p>
          Hiding removes a market from discovery. Halting stops trading and cancels open orders.
        </p>
        <div className="two-buttons">
          <button
            className="secondary"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: '/api/admin/markets/' + m.id,
                body: { action: m.hidden ? 'show' : 'hide' },
              })
            }
          >
            {m.hidden ? 'Show in discovery' : 'Hide from discovery'}
          </button>
          <button
            className="secondary"
            disabled={m.halted || m.status === 'settled' || action.isPending}
            onClick={() => {
              if (window.confirm('Halt trading and cancel every open order?'))
                action.mutate({ path: '/api/admin/markets/' + m.id, body: { action: 'halt' } });
            }}
          >
            Halt trading
          </button>
        </div>
      </section>
      <section className="admin-card">
        <h2>Bot allocation</h2>
        {m.bot ? (
          <Notice>This market already has a finite bot allocation. It cannot be refilled.</Notice>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action.mutate({
                path: '/api/admin/bot',
                body: {
                  marketId: m.id,
                  budget: Number(f.get('budget')) * DOLLAR,
                  spread: Number(f.get('spread')),
                  size: Number(f.get('size')),
                  probabilities: m.outcomes.map((o) => Math.round(Number(f.get(o.id)) * 100)),
                },
              });
            }}
          >
            <label>
              Budget · play dollars
              <input
                name="budget"
                type="number"
                min="10"
                max="1000000"
                defaultValue="1000"
                required
              />
            </label>
            <div className="form-row">
              <label>
                Half-spread · cents
                <input name="spread" type="number" min="1" max="20" defaultValue="4" required />
              </label>
              <label>
                Shares per quote
                <input name="size" type="number" min="1" max="100" defaultValue="10" required />
              </label>
            </div>
            {m.outcomes.map((o, i) => (
              <label key={o.id}>
                {o.label} · probability %
                <input
                  type="number"
                  name={o.id}
                  min="0.01"
                  max="99.99"
                  step="0.01"
                  defaultValue={
                    i === 0
                      ? (10000 - Math.floor(10000 / m.outcomes.length) * (m.outcomes.length - 1)) /
                        100
                      : Math.floor(10000 / m.outcomes.length) / 100
                  }
                  required
                />
              </label>
            ))}
            <small>
              Probabilities must total 100%. Half the budget creates complete sets; the remainder
              funds bids.
            </small>
            <button disabled={action.isPending || m.status !== 'open' || m.halted}>
              Allocate bot funds
            </button>
          </form>
        )}
      </section>
      <section className="admin-card">
        <h2>Final settlement</h2>
        {m.status === 'settled' ? (
          <Notice>This market is settled. Evidence: {m.evidence}</Notice>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate({
                path: '/api/admin/settle',
                body: {
                  marketId: m.id,
                  winnerId: winner === 'void' ? null : winner,
                  evidence,
                  confirm: true,
                },
              });
            }}
          >
            <label>
              Winning outcome
              <select value={winner} onChange={(e) => setWinner(e.target.value)}>
                {m.outcomes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} · $1 per share
                  </option>
                ))}
                <option value="void">Void · equal payout across outcomes</option>
              </select>
            </label>
            <label>
              Evidence reference and explanation
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                rows={4}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                required
              />{' '}
              I verified the published rules and understand this payout is final.
            </label>
            <button disabled={!confirmed || action.isPending}>Confirm final payout</button>
            <small>Close time must have passed, or trading must be halted first.</small>
          </form>
        )}
      </section>
      {action.isError && <Notice error>{action.error.message}</Notice>}
      {action.isSuccess && <Notice>Market updated successfully.</Notice>}
    </div>
  );
}
