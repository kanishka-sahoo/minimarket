# MiniMarket

A full-stack prediction exchange with free play money, independent outcome order books, a finite-budget liquidity bot, and a responsive TanStack Start interface.

**Production domain:** [minimarket.ksahoo.com](https://minimarket.ksahoo.com). Vercel is connected to this repository for deployments from `main`, with Neon PostgreSQL. Production credentials are managed in Vercel and are excluded from this repository. See the [deployment guide](docs/vercel.md) for configuration and verification.

## Run locally

Requirements: Node 24+, pnpm 10.30.3, Docker (or PostgreSQL 17+).

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d
node --env-file=.env --import tsx apps/api/src/seed.ts
pnpm dev
```

Open **http://localhost:4000**. Fastify owns the public origin and proxies page requests to TanStack Start on the internal port 3000. PostgreSQL persists data in a Docker volume. Ports 4000, 3000, 3001 (development HMR), and 54329 must be available.

The seed command is repeatable. It creates six explicitly fictional markets and funded bot quotes, without fabricating trades or price history. Existing markets, close dates, trades, and budgets are preserved. A seeded scenario closes 90 days after its initial creation; administrators must settle old demos or create new ones.

Public browsing works without Google credentials. Trading uses Google sign-in; there is intentionally no development authentication bypass. Automated tests use a separate test-only login, enabled only when both `NODE_ENV=test` and `ENABLE_TEST_AUTH=true`. Production refuses to start with that flag.

### Google login

Create a Google Cloud OAuth client of type **Web application**, configure its consent screen, and add test users if the consent app is in testing mode. Set these in `.env`:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAILS`: comma-separated verified Google email addresses
- `APP_ORIGIN=http://localhost:4000`

Register `http://localhost:4000/auth/google/callback` as an authorized redirect URI. The app requests only OpenID, email, and profile scopes. It verifies state, a browser-bound state cookie, PKCE, ID-token audience, nonce, and verified email. Session tokens are random; only their hashes are stored. Production cookies are Secure, HttpOnly, and SameSite=Lax. Admin permissions are refreshed on login.

## Verification

Create separate databases; tests never use the development database:

```sh
docker compose exec postgres createdb -U minimarket minimarket_test
docker compose exec postgres createdb -U minimarket minimarket_e2e
pnpm build
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

`TEST_DATABASE_URL` can override the integration database, but its name must end in `_test`. Tests truncate its accounts and dependent tables before each case. `E2E_DATABASE_URL` must point to a database ending in `_e2e`; browser bootstrap resets it and seeds fictional markets. Stop the development server before browser tests, which use ports 4000 and 3000.

Integration tests use real PostgreSQL transactions, not an in-memory substitute. Browser tests exercise the built SSR app behind the Fastify proxy, use server-created test sessions, and cover trading, complete sets, account reset, publication, admin settlement, reconnects, and responsive discovery.

## Deploy on Vercel + Neon

Use the root `Dockerfile.vercel` and follow the [Vercel deployment guide](docs/vercel.md). Set `PORT=8080` in Vercel, prepare the database before deployment, and configure the canonical origin and Google OAuth credentials. The container keeps Start and Fastify on the same public origin. Active viewers receive cross-instance changes through PostgreSQL version checks; bot quote cooldowns are shared in the database.

## Deploy on Render + Neon

1. Push this repository to your Git provider. Create a Neon free project and copy a TLS-enabled pooled PostgreSQL connection string for `DATABASE_URL`.
2. In Render, create a Blueprint from `render.yaml`. The Docker build creates a single service containing Start and Fastify. Configure `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ADMIN_EMAILS` as secret environment values.
3. The service uses Render's `RENDER_EXTERNAL_URL` as its canonical origin. For a custom domain, set `APP_ORIGIN` explicitly to that HTTPS origin. Add `<origin>/auth/google/callback` to the Google OAuth client's authorized redirects and configure its consent-screen audience.
4. Deploy. Startup runs versioned migrations and, with `SEED_DEMO=true`, the idempotent fictional seed. Schema migrations use an advisory lock. Never point test commands at the hosted database.
5. Sign in with an allowlisted Google account, open `/admin`, and verify the complete launch flow: grant, mint, buy/sell, cancel, create, fund, halt, settle, and leaderboard. Check browser console errors and a second browser session for live updates.

Free hosting is a demo constraint, not an uptime promise. Render can sleep after 15 minutes without inbound traffic; a cold start can take about a minute. Neon also scales to zero. No keepalive service is installed. Bot work runs only for actively viewed market pages, stops shortly after inactivity, and skips missed ticks after restarts. Persistent PostgreSQL state survives app restarts. Free-tier quotas and availability must be checked before provisioning: [Render](https://render.com/docs/free), [Neon](https://neon.com/pricing).

The public `/health` endpoint reports process readiness. Logs include request failures and bot errors without request URLs, OAuth codes, or cookie headers. Watch provider usage, database size, failed commands, and bot errors. Configure/export backups through Neon before retaining data you care about; no automatic backup service is provisioned here.

## Exchange contracts

- Whole shares; prices in one-cent ticks from 1¢ to 99¢. All stored money uses integer millionths of one play dollar. PostgreSQL constraints prevent negative cash, collateral, or available assets. JavaScript rejects bigint values outside its safe integer range.
- One dollar mints one share of each outcome; a complete set redeems for one dollar before closing. Cash is held as market collateral until redemption or settlement. There is no borrowing, fee, cross-outcome matching, or external wallet.
- Buy orders reserve cash at their limit; sell orders reserve shares. Matches consume best price, then insertion sequence, at the resting price. Partial fills release the appropriate reservations and any buy-price improvement. Self-matching cancels the incoming remainder without canceling the existing order.
- Instant trades are IOC limit orders. The preview fixes the absolute protected price; submission does not silently rebase it. A request reserves enough cash for the full requested quantity at its limit even if visible liquidity is smaller. Unfilled quantities are canceled.
- Every financial command has an account-scoped UUID idempotency key and payload fingerprint. Retries with the same payload return the original result; changing the payload with the same key returns HTTP 409. The browser retains the key after a failed request until a successful response or a different command.
- SERIALIZABLE transactions lock a market row and affected accounts in deterministic order, with up to five attempts for serialization/deadlock failures. Market versions increment in the same transaction; WebSocket notifications occur only after commit. Reconnects fetch authoritative snapshots. Active viewers also check PostgreSQL market versions every two seconds, so notifications converge across autoscaled API instances without Redis.
- Closing is enforced at command time, independent of timers. Market detail, portfolio access, and active bot ticks lazily close expired markets and release reservations. Hiding affects discovery only; halting stops trading and cancels orders.
- Admin settlement is immutable. A winner pays $1 per share. A void allocates one dollar equally across outcomes; leftover millionths go to outcomes in publication order. Settlement checks that total payments exactly equal collateral and clears holdings atomically. Old trades are never unwound.
- The ledger records grants, resets, trades, complete sets, and settlement cash movements. Rankings aggregate current-epoch market cash flows only after settlement. Portfolio marks are last trades, not liquidation guarantees; unpriced holdings are disclosed and excluded.

## Bot behavior

Each market has at most one admin-funded bot account and one grant. Half the budget mints complete sets; the remainder funds bids. Default quote size is 10 shares and half-spread is 4 cents. The admin provides initial probabilities in basis points totaling 10,000.

Every active tick reconciles old orders, then quotes each outcome around the initial probability. Inventory shortage raises the center by up to 5 cents; excess inventory lowers it by up to 5 cents. Prices clamp to 1–99¢. Quotes are limited to available funds and shares, use the normal matching engine, and never refill. Ticks run at most once per 15 seconds per market using a shared database-time cooldown. Active page heartbeats last 45 seconds; hidden tabs stop sending them. Opening a socket does not create a historical backfill.

## Repository map

- `apps/api`: Fastify routes, Google authentication, transaction engine, read models, SQL migrations, seeds, and real-database tests.
- `apps/web`: TanStack Start file routes, React Query, Tailwind, shared UI, and same-origin WebSocket client.
- `packages/shared`: Zod command schemas, wire types, and money units.
- `tests`: Playwright user journeys against the built app.
- `scripts`: local development, process supervision, and browser-test bootstrap.

API commands: `POST /api/markets`, `/api/orders`, `/api/orders/:id/cancel`, `/api/sets`, `/api/reset`, `/api/admin/markets/:id`, `/api/admin/bot`, `/api/admin/settle`. Commands require a session, matching `Origin`, and `Idempotency-Key`. Queries: `GET /api/me`, `/api/markets`, `/api/markets/:id`, `/api/portfolio`, `/api/leaderboard`. Market updates: `WS /api/live/:id`. Published market terms have no edit endpoint.

Intentionally omitted: real money, purchased credits, prizes, social features, external forecasts, automated resolution, settlement appeals.
