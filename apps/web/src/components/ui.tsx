import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowUpRightIcon,
  FlaskIcon,
  RobotIcon,
  SoccerBallIcon,
  GlobeHemisphereWestIcon,
  PaletteIcon,
  ChartLineUpIcon,
  ArrowRightIcon,
  ClockIcon,
} from '@phosphor-icons/react';
import type { Market, Trade, Outcome } from '@minimarket/shared';
import { cents, CENT } from '@minimarket/shared';

export function CategoryIcon({ category, large = false }: { category: string; large?: boolean }) {
  const Icon =
    (
      {
        Science: FlaskIcon,
        Technology: RobotIcon,
        Sports: SoccerBallIcon,
        World: GlobeHemisphereWestIcon,
        Culture: PaletteIcon,
        Finance: ChartLineUpIcon,
      } as Record<string, typeof FlaskIcon>
    )[category] ?? GlobeHemisphereWestIcon;
  return (
    <span className={`category-icon ${large ? 'large' : ''}`} aria-hidden="true">
      <Icon size={large ? 26 : 17} weight="regular" />
    </span>
  );
}

/** Percentage implied by a quoted price. Returns null when nothing is quoted. */
function implied(price: number | null) {
  return price === null ? null : Math.max(0, Math.min(100, Math.round(price / CENT)));
}

function OddsBar({ price }: { price: number | null }) {
  const percent = implied(price);
  if (percent === null) return null;
  return (
    <div className="odds-bar" aria-hidden="true">
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function MarketCard({ market: m }: { market: Market }) {
  const open = m.status === 'open' && !m.halted && new Date(m.closes_at) > new Date();
  return (
    <Link to="/markets/$id" params={{ id: m.id }} className="market-card">
      <div className="card-top">
        <CategoryIcon category={m.category} />
        <span className="category-name">{m.category}</span>
        <ArrowUpRightIcon size={17} className="card-arrow" />
      </div>
      <h3>{m.title}</h3>
      {m.kind === 'binary' ? (
        <div className="binary-prices">
          {m.outcomes.map((o) => (
            <div key={o.id} className="binary-row">
              <span>{o.label}</span>
              <OddsBar price={o.payout ?? o.ask} />
              <strong>{o.payout !== null ? cents(o.payout) : cents(o.ask)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="multi-prices">
          {m.outcomes.slice(0, 3).map((o) => (
            <div key={o.id}>
              <span>{o.label}</span>
              <OddsBar price={o.payout ?? o.ask} />
              <strong>{o.payout !== null ? cents(o.payout) : cents(o.ask)}</strong>
            </div>
          ))}
          {m.outcomes.length > 3 && (
            <small>
              +{m.outcomes.length - 3} more outcome{m.outcomes.length > 4 ? 's' : ''}
            </small>
          )}
        </div>
      )}
      <div className="card-footer">
        <span>{m.demo ? 'Fictional demo' : m.bot ? 'Bot liquidity' : 'Community market'}</span>
        <span>
          {open ? 'Trade' : m.status === 'settled' ? 'Settled' : 'Closed'}{' '}
          <ArrowRightIcon size={13} />
        </span>
      </div>
    </Link>
  );
}

/** Loading placeholders shaped like the market grid they stand in for. */
export function MarketCardSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="card-top">
        <span className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <span className="skeleton skeleton-line" style={{ width: 74 }} />
      </div>
      <div className="skeleton-rows">
        <span className="skeleton skeleton-line" style={{ height: 15 }} />
        <span className="skeleton skeleton-line" style={{ height: 15, width: '72%' }} />
      </div>
      <div className="skeleton-rows">
        <span className="skeleton skeleton-line" style={{ width: '56%' }} />
        <span className="skeleton skeleton-line" style={{ width: '48%' }} />
        <span className="skeleton" style={{ height: 5, borderRadius: 999 }} />
      </div>
      <div className="card-footer">
        <span className="skeleton skeleton-line" style={{ width: 92 }} />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-scroll" aria-hidden="true">
      <div style={{ padding: 18, display: 'grid', gap: 16 }}>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="skeleton skeleton-line" style={{ width: `${92 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <ChartLineUpIcon size={30} weight="light" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function SignIn() {
  return (
    <section className="signin-panel">
      <h1>
        A little conviction.
        <br />
        10,000 play dollars.
      </h1>
      <p>Sign in to trade, create your own markets, and see how your predictions play out.</p>
      <a className="button" href="/login">
        Continue with Google <ArrowUpRightIcon size={18} />
      </a>
      <small>Free points only. No purchases. No cash-out.</small>
    </section>
  );
}

export function PriceChart({ trades, outcome }: { trades: Trade[]; outcome: Outcome }) {
  const points = trades
    .filter((t) => t.outcome_id === outcome.id)
    .slice()
    .reverse();
  if (!points.length)
    return (
      <div className="chart-empty">
        <ChartLineUpIcon size={32} weight="light" />
        <strong>A fresh market. An open question.</strong>
        <span>The chart begins with the first real trade.</span>
      </div>
    );
  const first = Date.parse(points[0].created_at),
    last = Date.parse(points.at(-1)!.created_at);
  const coords = points.map((p, i) => ({
    x:
      40 +
      (last === first
        ? i / Math.max(1, points.length - 1)
        : (Date.parse(p.created_at) - first) / (last - first)) *
        650,
    y: 190 - (p.price / (100 * CENT)) * 160,
    p,
  }));
  const line = coords.map((p) => `${p.x},${p.y}`).join(' ');
  const gradientId = `mm-area-${outcome.id}`;
  return (
    <div className="price-chart">
      <svg
        viewBox="0 0 750 220"
        role="img"
        aria-label={`${outcome.label} executed trade prices, ${points.length} trades`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((n) => (
          <g key={n}>
            <line x1="40" y1={190 - n * 1.6} x2="690" y2={190 - n * 1.6} stroke="var(--line)" />
            <text x="706" y={194 - n * 1.6} fill="var(--text-3)" fontSize="11">
              {n}¢
            </text>
          </g>
        ))}
        <polygon
          points={`${coords[0].x},190 ${line} ${coords.at(-1)!.x},190`}
          fill={`url(#${gradientId})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={points.length === 1 ? 4 : 2.25} fill="var(--accent)">
            <title>
              {cents(p.p.price)} · {p.p.quantity} shares ·{' '}
              {new Date(p.p.created_at).toLocaleString()}
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-dates">
        <span>{new Date(first).toLocaleDateString()}</span>
        <span>{new Date(last).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function Closing({ date }: { date: string }) {
  return (
    <span className="inline-meta">
      <ClockIcon size={14} /> Closes{' '}
      {new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })}{' '}
      UTC
    </span>
  );
}
