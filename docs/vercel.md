# Deploy MiniMarket on Vercel

MiniMarket deploys as one container running TanStack Start and Fastify, with Neon PostgreSQL for persistent state. `vercel.json` explicitly selects `Dockerfile.vercel` as the app service entrypoint, routes all traffic to it, and enables Fluid compute. All page, API, OAuth, and WebSocket traffic uses the same public origin.

Vercel Container Images and native WebSockets are currently beta features available on all plans. Connections end at the function duration limit, and reconnects can land on different instances. The app resnapshots on reconnect and synchronizes committed market versions across instances. See [container images](https://vercel.com/docs/functions/container-images) and [WebSockets](https://vercel.com/docs/functions/websockets).

## 1. Prepare Neon

Create a Neon database and obtain its pooled TLS connection string. Use a separate branch/database for preview deployments so test users and preview code cannot change production balances.

On your machine, put the connection string in an ignored `.env.vercel` file as `DATABASE_URL`. Initialize the database **once before the first deployment**:

```sh
node --env-file=.env.vercel --import tsx apps/api/src/migrate.ts
# Optional: add the six fictional demo markets once.
node --env-file=.env.vercel --import tsx apps/api/src/seed.ts
```

Run the migration command again before deployments that add migrations. Use backward-compatible schema changes while old and new deployment instances overlap. These commands do not require Google credentials. Do not run the destructive test bootstrap against this database.

The Vercel image sets `RUN_MIGRATIONS=false` and checks that the required migrations are present before opening its public port. It does not run DDL during cold starts. `SEED_DEMO` must remain false on Vercel; the process refuses automatic seeding there because many instances can start concurrently.

## 2. Import the repository

The public repository is [kanishka-sahoo/minimarket](https://github.com/kanishka-sahoo/minimarket), connected to the `ksahooprojects/minimarket` Vercel project. Pushes to `main` trigger production deployments. The GitHub Actions workflow runs build, type, formatting, PostgreSQL integration, and browser checks. Production database migrations still run before code requiring the new schema is deployed.

Import this repository into Vercel with the **repository root** as the project root, not `apps/web`. Let Vercel detect `Dockerfile.vercel`; do not select a standalone TanStack deployment or override the Docker build with a frontend-only build command.

Configure these environment variables in Vercel Project Settings for the intended environment:

| Variable               | Value                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `PORT`                 | **`8080`**, required so Vercel routes to the image's HTTP port                            |
| `DATABASE_URL`         | Neon pooled connection string with TLS                                                    |
| `APP_ORIGIN`           | Your exact HTTPS production origin, such as `https://minimarket.vercel.app`, with no path |
| `GOOGLE_CLIENT_ID`     | Google Web application OAuth client ID                                                    |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                                                                |
| `ADMIN_EMAILS`         | Comma-separated verified Google email addresses                                           |

The image supplies `NODE_ENV=production`, `VERCEL=1`, `RUN_MIGRATIONS=false`, and `SEED_DEMO=false`. Keep those defaults. Never enable `ENABLE_TEST_AUTH` on a hosted deployment.

For previews, omit the production-scoped `APP_ORIGIN`; the app uses the exact HTTPS `VERCEL_URL` provided by Vercel. Enable Vercel's system environment variables if they are disabled. Preview OAuth needs a stable preview domain and its own explicitly registered callback, or can remain unconfigured for public browsing. No wildcard origin is trusted.

Keep Fluid compute enabled and choose a function region near Neon. Leave the supported default function duration unless you have a reason to change it; the client handles platform disconnections. Hobby quotas still apply, including compute, connection duration, and Neon usage. This setup does not promise unlimited free hosting.

## 3. Configure Google and deploy

This project's production origin is `https://minimarket.ksahoo.com`. Its Google redirect URI is `https://minimarket.ksahoo.com/auth/google/callback`. Cloudflare manages the DNS-only CNAME to Vercel's assigned target, and Vercel serves HTTPS.

Register `<APP_ORIGIN>/auth/google/callback` as an authorized redirect URI on the Google OAuth client. Configure the consent screen and test-user audience as appropriate. Scope production OAuth secrets to production; give previews separate credentials if they need sign-in.

### Google console walkthrough

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), select or create a project for MiniMarket, and click **Get started** if prompted.
2. Set the app name to **MiniMarket**, choose your support email, select an **External** audience for personal Google accounts, and enter your contact email. Review Google's terms yourself and complete registration.
3. In **Audience**, add your Google email as a test user while configuring the app. In **Data Access**, use only basic identity scopes: `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile`.
4. In **Clients → Create client**, choose **Web application** and name it **MiniMarket production**. Add the exact production callback under **Authorized redirect URIs**. Obtain the stable production domain from Vercel first; do not use a temporary deployment URL or a wildcard.
5. Leave **Authorized JavaScript origins** empty: this app exchanges authorization codes on the backend. Create the client and immediately save its client ID and secret; Google only shows the secret at creation.
6. Enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel's **Production** environment variables. Set `ADMIN_EMAILS` to the Google emails that should administer markets, and set `APP_ORIGIN` to the same HTTPS origin used in the callback. Redeploy for changed variables to take effect. On each authenticated request, the app reconciles Google accounts against the current allowlist, so a removed email loses administrator access without needing to sign in again.
7. Test sign-in from that production origin in your regular browser. Verify the 10,000-point grant and admin access. Before inviting the public, review the **Audience** publishing status and any requirements shown by Google.

For local development, create a separate Web application client with `http://localhost:4000/auth/google/callback` and store its credentials in `.env`. Keep production credentials separate. If sharing credentials with the local deployment workflow, place them in the ignored `.env.vercel` file or enter them directly in Vercel; do not paste secrets into chat.

Google references: [consent screen setup](https://developers.google.com/workspace/guides/configure-oauth-consent), [OAuth client creation](https://support.google.com/cloud/answer/15549257?hl=en).

Deploy from Vercel's Git integration or an authenticated current Vercel CLI:

```sh
vercel deploy
# After reviewing the preview and setting production-scoped variables:
vercel deploy --prod
```

No authenticated Vercel project or hosted database is bundled with the repository. A local Docker build verifies the image, not Vercel's deployment control plane or your live Google OAuth configuration.

## Runtime behavior

- PostgreSQL transactions, account reservations, idempotency records, sessions, and market versions are shared across instances. Matching and settlement do not depend on which container receives a command.
- Same-instance notifications are immediate. Each instance also checks versions for its actively viewed markets every two seconds in one small batched query. This delivers commits from other instances without Redis or a session-pinned `LISTEN` connection, and works with Neon's transaction pooler. Queries stop when no local viewers remain or their activity expires.
- The bot's 15-second cooldown uses PostgreSQL time under the market lock. Concurrent instances can request a quote tick, but only one updates the book in that cooldown period. Orders, inventory, and budgets remain durable. No missed ticks are replayed after suspension.
- In-memory activity only schedules work for current local viewers; losing it does not lose exchange state. Vercel may suspend or stop an idle container. The app needs no off-request background worker for correctness.
- The supervisor waits for the internal SSR listener before exposing Fastify's public port. `SIGTERM` stops both processes; the database retains committed state.
- Existing HTTP rate limits are per instance. For public traffic, configure Vercel Firewall rules for deployment-wide abuse limits; they are not provisioned by these files.

## Validate the deployment

1. Confirm `/health` returns `200` and `/` contains server-rendered market content.
2. Confirm `POST /api/test/login` is unavailable in production.
3. Verify Google login, the initial grant, and the admin allowlist.
4. Open one market in two browsers. Trade in one and verify the other's book/holdings refresh. Reconnect a browser and confirm trading is disabled until a fresh snapshot arrives.
5. Exercise complete-set mint/redemption, cancellation, market creation, admin funding, halt, and settlement.
6. Review function logs and Neon usage. Take/export database backups independently of container deployment.

To build the exact image locally:

```sh
docker build -f Dockerfile.vercel -t minimarket:vercel .
# Supply DATABASE_URL reachable from Docker and an APP_ORIGIN matching your local test origin.
docker run --rm -p 8080:8080 --env-file .env.vercel minimarket:vercel
```

For local HTTP testing only, set `NODE_ENV=development` and `APP_ORIGIN=http://localhost:8080` in the container environment; never apply those settings to Vercel. The usual `pnpm dev` workflow is unchanged. The original `Dockerfile` and `render.yaml` remain available for Render.
