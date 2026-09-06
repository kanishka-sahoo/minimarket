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
  MoonIcon,
  SunIcon,
  CompassIcon,
} from '@phosphor-icons/react';
import { money } from '@minimarket/shared';
import { useAction, useSession } from '../lib';
import { useState, useEffect } from 'react';
import styles from '../styles.css?url';

// Runs before first paint so a stored theme never flashes the wrong palette.
const themeScript = `(function(){try{var t=localStorage.getItem('mm-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}})()`;

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
    <main className="page">
      <div className="empty">
        <h1>This market is off the map.</h1>
        <p>The question you followed has moved or never existed.</p>
        <Link to="/">Explore markets</Link>
      </div>
    </main>
  ),
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem('mm-theme');
    setTheme(
      stored === 'light' || stored === 'dark'
        ? stored
        : matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light',
    );
  }, []);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mm-theme', next);
    } catch {
      // Storage can be unavailable; the toggle still applies for this page view.
    }
    setTheme(next);
  };
  return (
    <button
      className="theme-toggle"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title="Switch theme"
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 18, height: 18 }}>
        {theme === 'dark' ? <SunIcon size={18} /> : theme ? <MoonIcon size={18} /> : null}
      </span>
    </button>
  );
}

function Shell() {
  const session = useSession();
  const user = session.data?.user;
  const logout = useAction();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="MiniMarket home">
            <span className="brand-mark">
              <ChartBarIcon weight="fill" size={19} />
            </span>
            <span className="wordmark">
              mini<span>market</span>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <Link to="/" activeProps={{ className: 'active' }} activeOptions={{ exact: true }}>
              <CompassIcon size={17} /> <span>Markets</span>
            </Link>
            <Link to="/portfolio" activeProps={{ className: 'active' }}>
              <WalletIcon size={17} /> <span>Portfolio</span>
            </Link>
            <Link to="/leaderboard" activeProps={{ className: 'active' }}>
              <TrophyIcon size={17} /> <span>Leaderboard</span>
            </Link>
          </nav>
          <div className="header-actions">
            <span className="play-label">Play money</span>
            <ThemeToggle />
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
        <div className="footer-inner">
          <Link to="/" className="footer-brand">
            minimarket
          </Link>
          <span>Play money only. No deposits, withdrawals, or prizes.</span>
          <span className="footer-spacer" />
          {user?.admin && <Link to="/admin">Admin</Link>}
          <Link to="/create">
            <PlusIcon size={14} /> Create a market
          </Link>
        </div>
      </footer>
    </>
  );
}
