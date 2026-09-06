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
import { cents, money, CENT } from '@minimarket/shared';
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
    <span className={`category-icon ${category.toLowerCase()} ${large ? 'large' : ''}`}>
      <Icon size={large ? 36 : 25} weight="duotone" />
    </span>
  );
}
export function MarketCard({ market: m }: { market: Market }) {
  const open = m.status === 'open' && !m.halted && new Date(m.closes_at) > new Date();
  return (
    <Link to="/markets/$id" params={{ id: m.id }} className="market-card">
      <div className="card-top">
        <CategoryIcon category={m.category} />
        <span className="category-name">{m.category}</span>
        <ArrowUpRightIcon size={19} className="card-arrow" />
      </div>
      <h3>{m.title}</h3>
      {m.kind === 'binary' ? (
        <div className="binary-prices">
          {m.outcomes.map((o, i) => (
            <div key={o.id} className={i === 0 ? 'yes-price' : 'no-price'}>
              <span>{o.label}</span>
              <strong>{o.payout !== null ? cents(o.payout) : cents(o.ask)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="multi-prices">
          {m.outcomes.slice(0, 3).map((o) => (
            <div key={o.id}>
              <span>{o.label}</span>
              <strong>{o.payout !== null ? cents(o.payout) : cents(o.ask)}</strong>
            </div>
          ))}
          {m.outcomes.length > 3 && <small>+{m.outcomes.length - 3} more outcome</small>}
        </div>
      )}
      <div className="card-footer">
        <span>{m.demo ? 'Fictional demo' : m.bot ? 'Bot liquidity' : 'Community market'}</span>
        <span>
          {open ? 'Ask prices' : m.status === 'settled' ? 'Settled' : 'Closed'}{' '}
          <ArrowRightIcon size={13} />
        </span>
      </div>
    </Link>
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
      <ChartLineUpIcon size={34} weight="light" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function SignIn() {
  return (
    <section className="signin-panel">
      <span className="eyebrow">YOUR FIRST POSITION STARTS HERE</span>
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
        <ChartLineUpIcon size={38} weight="light" />
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
  return (
    <div className="price-chart">
      <svg
        viewBox="0 0 750 220"
        role="img"
        aria-label={`${outcome.label} executed trade prices, ${points.length} trades`}
      >
        {[0, 25, 50, 75, 100].map((n) => (
          <g key={n}>
            <line x1="40" y1={190 - n * 1.6} x2="690" y2={190 - n * 1.6} stroke="#e8ece8" />
            <text x="710" y={194 - n * 1.6} fill="#79827d" fontSize="11">
              {n}¢
            </text>
          </g>
        ))}
        <polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#21825d"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {coords.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={points.length === 1 ? 4 : 2} fill="#21825d">
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
