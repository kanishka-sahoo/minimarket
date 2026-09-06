import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TrophyIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { money } from '@minimarket/shared';
import { api } from '../lib';
import { Empty } from '../components/ui';
type Ranking = { id: string; name: string; epoch: number; profit: number; markets: number };
export const Route = createFileRoute('/leaderboard')({
  loader: () => api<Ranking[]>('/api/leaderboard'),
  component: Leaderboard,
});
function Leaderboard() {
  const initial = Route.useLoaderData();
  const { data = initial } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api<Ranking[]>('/api/leaderboard'),
    initialData: initial,
  });
  return (
    <>
      <section className="discovery-intro">
        <div>
          <span className="eyebrow">GOOD JUDGMENT ADDS UP</span>
          <h1>The leaderboard</h1>
          <p>Conviction is a start. Settled results tell the story.</p>
        </div>
        <TrophyIcon size={64} weight="duotone" className="trophy" />
      </section>
      <div className="leaderboard-layout">
        <section className="ranking-table">
          {data.length ? (
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Trader</th>
                  <th>Settled markets</th>
                  <th>Net profit</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <span className={`rank rank-${i + 1}`}>{String(i + 1).padStart(2, '0')}</span>
                    </td>
                    <td>
                      <span className="trader-avatar">{r.name.slice(0, 2).toUpperCase()}</span>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{r.markets}</td>
                    <td className={r.profit >= 0 ? 'green-text' : 'red-text'}>
                      <strong>
                        {r.profit > 0 ? '+' : ''}
                        {money(r.profit)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="The first chapter is still being written.">
              Rankings appear when a market settles. Until then, find a question worth taking a
              position on.
            </Empty>
          )}
        </section>
        <aside className="writing-guide">
          <h2>Results, without the noise.</h2>
          <p>
            Rankings count net cash profit from settled markets, including trades, complete sets,
            and payouts.
          </p>
          <p>
            Open-market price changes, starting grants, and bot accounts don’t count. Resetting your
            account starts a new record.
          </p>
          <Link to="/" className="text-button">
            Find your next market <ArrowUpRightIcon size={16} />
          </Link>
        </aside>
      </div>
    </>
  );
}
