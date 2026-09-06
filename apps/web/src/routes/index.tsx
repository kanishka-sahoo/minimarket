import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowUpRightIcon,
  PlusIcon,
  ArrowRightIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { categories, type Market, type Page } from '@minimarket/shared';
import { api, useSession } from '../lib';
import { Pagination, usePage } from '../components/pagination';
import { MarketCard, MarketCardSkeleton, Empty, Notice } from '../components/ui';
export const Route = createFileRoute('/')({
  loader: () => api<Page<Market>>('/api/pages/markets'),
  component: Markets,
});
function Markets() {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('All markets'),
    [sort, setSort] = useState('newest');
  const searchInput = useRef<HTMLInputElement>(null);
  const session = useSession();
  // Kept in the tree and toggled after mount: branching the SSR output on
  // client-only session state would break hydration.
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (session.data) setSignedOut(!session.data.user);
  }, [session.data]);
  const listing = usePage<Market>(
    'markets',
    { search, sort, ...(category === 'All markets' ? {} : { category }) },
    true,
    Route.useLoaderData(),
  );
  const shown = listing.data?.items ?? [];
  // The "/" hint in the search field is a real shortcut, not decoration.
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener('keydown', focus);
    return () => document.removeEventListener('keydown', focus);
  }, []);
  return (
    <>
      <section className="page-head">
        <div>
          <h1>What happens next?</h1>
          <p>Put your perspective to the test. Trade predictions with play money.</p>
        </div>
        <Link to="/create" className="button secondary">
          <PlusIcon size={17} /> Create a market
        </Link>
      </section>
      <section className="welcome-banner" hidden={!signedOut}>
        <div className="banner-symbol">
          <ArrowUpRightIcon size={28} weight="bold" />
        </div>
        <div>
          <h2>Real conviction. Zero financial risk.</h2>
          <p>Start with 10,000 free play dollars. Find your edge, one prediction at a time.</p>
        </div>
        <a href="/login">
          Start predicting <ArrowRightIcon size={18} />
        </a>
      </section>
      <section aria-label="Market filters" style={{ display: 'grid', gap: 14 }}>
        <div className="browse-toolbar">
          <div className="search-field">
            <MagnifyingGlassIcon size={18} />
            <input
              ref={searchInput}
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
          {listing.data?.total ?? 0} {listing.data?.total === 1 ? 'market' : 'markets'}
        </span>
      </div>
      {listing.error && <Notice error>{listing.error.message}</Notice>}
      {listing.isPending ? (
        <div className="market-grid" aria-busy="true" aria-label="Loading markets">
          {Array.from({ length: 6 }, (_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length ? (
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
      <Pagination data={listing.data} setPage={listing.setPage} label="Markets" />
    </>
  );
}
