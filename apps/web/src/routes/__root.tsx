import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  Link,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ChartBarIcon,
  ArrowUpRightIcon,
  PlusIcon,
  WalletIcon,
  TrophyIcon,
  SignOutIcon,
} from '@phosphor-icons/react';
import { money } from '@minimarket/shared';
import { useAction, useSession } from '../lib';
import { useState, useEffect, useRef } from 'react';
import styles from '../styles.css?url';
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'MiniMarket · Big ideas. Small stakes.' },
      {
        name: 'description',
        content:
          'A prediction exchange for curious minds. Trade outcome shares with free play money.',
      },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  component: Root,
  errorComponent: ({ error, reset }) => (
    <div className="error-page">
      <h1>We couldn’t load this page.</h1>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
      <a href="/">Back to markets</a>
    </div>
  ),
  notFoundComponent: () => (
    <main className="empty">
      <h1>This market is off the map.</h1>
      <Link to="/">Explore markets</Link>
    </main>
  ),
});
function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Shell />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
function Shell() {
  const session = useSession();
  const user = session.data?.user;
  const logout = useAction();
  const [help, setHelp] = useState(false);
  const helpDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (help) helpDialog.current?.showModal();
  }, [help]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="MiniMarket home">
            <span className="brand-mark">
              <ChartBarIcon weight="fill" size={22} />
            </span>
            mini<span>market</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link to="/" activeProps={{ className: 'active' }} activeOptions={{ exact: true }}>
              Markets
            </Link>
            <Link to="/portfolio" activeProps={{ className: 'active' }}>
              <WalletIcon size={17} /> Portfolio
            </Link>
            <Link to="/leaderboard" activeProps={{ className: 'active' }}>
              <TrophyIcon size={17} /> Leaderboard
            </Link>
          </nav>
          <div className="header-actions">
            <span className="play-label">PLAY MONEY</span>
            {user ? (
              <>
                <Link className="balance" to="/portfolio">
                  {money(user.cash)}
                </Link>
                <button
                  className="icon-button"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={() => logout.mutate({ path: '/api/logout', body: {} })}
                >
                  <SignOutIcon size={18} />
                </button>
              </>
            ) : (
              <a href="/login" className="button small">
                Sign in <ArrowUpRightIcon size={16} />
              </a>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page">
        <Outlet />
      </main>
      <footer>
        <Link to="/" className="footer-brand">
          minimarket
        </Link>
        <span>Big ideas. Small stakes. All play money.</span>
        <button className="text-button" onClick={() => setHelp(true)}>
          How it works
        </button>
        {user?.admin && <Link to="/admin">Admin</Link>}
        <Link to="/create">
          <PlusIcon size={14} /> Create a market
        </Link>
      </footer>
      {help && (
        <dialog
          ref={helpDialog}
          className="help-modal"
          onClose={() => setHelp(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelp(false);
          }}
        >
          <section
            className="help-dialog"
            aria-label="How MiniMarket works"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>A little conviction goes a long way.</h2>
            <p>
              Sign in with Google to receive 10,000 free play dollars. No deposits, withdrawals, or
              prizes.
            </p>
            <ol>
              <li>
                <strong>Choose an outcome.</strong> A winning share pays $1. Other outcomes pay
                zero.
              </li>
              <li>
                <strong>Name your price.</strong> Limit orders wait for a match. Instant trades fill
                available orders within your chosen price limit.
              </li>
              <li>
                <strong>Create shares.</strong> Lock $1 to mint a full set, one share of every
                outcome. Redeem a full set for $1 before closing.
              </li>
              <li>
                <strong>See it through.</strong> Admins resolve closed markets using their published
                rules. Voided markets divide $1 equally across outcomes; previous trades stand.
              </li>
            </ol>
            <p className="muted">
              Fictional markets and liquidity bots are clearly labeled. Bot quotes demonstrate
              trading, not forecasts. Rankings count settled profit only.
            </p>
            <button autoFocus onClick={() => setHelp(false)}>
              Got it
            </button>
          </section>
        </dialog>
      )}
    </>
  );
}
