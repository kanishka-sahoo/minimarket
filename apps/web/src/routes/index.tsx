import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowUpRightIcon,
  PlusIcon,
  ArrowRightIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { categories, type Market } from '@minimarket/shared';
import { api } from '../lib';
import { MarketCard, Empty } from '../components/ui';
export const Route = createFileRoute('/')({
  loader: () => api<Market[]>('/api/markets'),
  component: Markets,
});
function Markets() {
  const initial = Route.useLoaderData();
  const { data = initial } = useQuery({
    queryKey: ['markets'],
    queryFn: () => api<Market[]>('/api/markets'),
    initialData: initial,
  });
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('All markets'),
    [sort, setSort] = useState('newest');
  let shown = data.filter(
    (m) =>
      (category === 'All markets' || m.category === category) &&
      m.title.toLowerCase().includes(search.toLowerCase()),
  );
  if (sort === 'volume') shown = [...shown].sort((a, b) => b.volume - a.volume);
  if (sort === 'closing')
    shown = [...shown].sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at));
  return (
    <>
      <section className="discovery-intro">
        <div>
          <span className="eyebrow">A MARKET FOR YOUR CURIOSITY</span>
          <h1>What happens next?</h1>
          <p>Put your perspective to the test. Trade predictions with play money.</p>
        </div>
        <Link to="/create" className="button secondary">
          <PlusIcon size={17} /> Create a market
        </Link>
      </section>
      <section className="welcome-banner">
        <div className="banner-symbol">
          <ArrowUpRightIcon size={38} weight="bold" />
        </div>
        <div>
          <h2>Real conviction. Zero financial risk.</h2>
          <p>Start with 10,000 free play dollars. Find your edge, one prediction at a time.</p>
        </div>
        <a href="/login">
          Start predicting <ArrowRightIcon size={18} />
        </a>
      </section>
      <section aria-label="Market filters">
        <div className="browse-toolbar">
          <div className="search-field">
            <MagnifyingGlassIcon size={19} />
            <input
              aria-label="Search markets"
              placeholder="Search for a question, idea, or possibility…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <label className="sort-select">
            <SlidersHorizontalIcon size={17} />
            <select
              aria-label="Sort markets"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest markets</option>
              <option value="volume">Most traded</option>
              <option value="closing">Closing soon</option>
            </select>
          </label>
        </div>
        <div className="category-tabs">
          {['All markets', ...categories].map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={category === c ? 'selected' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </section>
      <div className="section-heading">
        <h2>{category === 'All markets' ? 'Explore the possibilities' : category}</h2>
        <span>
          {shown.length} {shown.length === 1 ? 'market' : 'markets'}
        </span>
      </div>
      {shown.length ? (
        <div className="market-grid">
          {shown.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      ) : (
        <Empty title="No markets found">
          Try a different search or create the question you have in mind.
        </Empty>
      )}
      <aside className="discovery-note">
        <span className="status-dot" /> Fictional demo markets are labeled. Displayed quotes are
        executable asks, not forecasts. All balances are play money.
      </aside>
    </>
  );
}
