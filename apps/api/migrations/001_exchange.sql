CREATE TABLE accounts (
 id uuid PRIMARY KEY, subject text UNIQUE, email text NOT NULL DEFAULT '', name text NOT NULL,
 admin boolean NOT NULL DEFAULT false, bot boolean NOT NULL DEFAULT false,
 cash bigint NOT NULL DEFAULT 0 CHECK(cash BETWEEN 0 AND 9000000000000000),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= cash),
 epoch integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE markets (
 id uuid PRIMARY KEY, creator_id uuid NOT NULL REFERENCES accounts(id), title text NOT NULL,
 category text NOT NULL, criteria text NOT NULL, source text NOT NULL, kind text NOT NULL CHECK(kind IN ('binary','multi')),
 closes_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','settled')),
 demo boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false, halted boolean NOT NULL DEFAULT false,
 collateral bigint NOT NULL DEFAULT 0 CHECK(collateral >= 0), version integer NOT NULL DEFAULT 0,
 evidence text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outcomes (
 id uuid PRIMARY KEY, market_id uuid NOT NULL REFERENCES markets(id), label text NOT NULL, ordinal integer NOT NULL,
 payout bigint CHECK(payout BETWEEN 0 AND 1000000), UNIQUE(market_id,ordinal), UNIQUE(market_id,label), UNIQUE(market_id,id)
);
CREATE TABLE holdings (
 account_id uuid REFERENCES accounts(id), outcome_id uuid REFERENCES outcomes(id),
 quantity bigint NOT NULL DEFAULT 0 CHECK(quantity >= 0), reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= quantity),
 PRIMARY KEY(account_id,outcome_id)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 account_id uuid NOT NULL REFERENCES accounts(id), market_id uuid NOT NULL REFERENCES markets(id), outcome_id uuid NOT NULL,
 side text NOT NULL CHECK(side IN ('buy','sell')), price bigint NOT NULL CHECK(price BETWEEN 10000 AND 990000 AND price % 10000 = 0),
 quantity integer NOT NULL CHECK(quantity > 0), remaining integer NOT NULL CHECK(remaining >= 0 AND remaining <= quantity),
 status text NOT NULL CHECK(status IN ('open','filled','canceled')), tif text NOT NULL CHECK(tif IN ('GTC','IOC')),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(market_id,outcome_id) REFERENCES outcomes(market_id,id)
);
CREATE INDEX book_orders ON orders(outcome_id,side,price,sequence) WHERE status='open';
CREATE INDEX account_orders ON orders(account_id,created_at);
CREATE TABLE trades (
 id uuid PRIMARY KEY, market_id uuid NOT NULL REFERENCES markets(id), outcome_id uuid NOT NULL REFERENCES outcomes(id),
 buy_order_id uuid NOT NULL REFERENCES orders(id), sell_order_id uuid NOT NULL REFERENCES orders(id),
 price bigint NOT NULL CHECK(price BETWEEN 10000 AND 990000), quantity integer NOT NULL CHECK(quantity > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX market_trades ON trades(market_id,created_at);
CREATE TABLE ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 market_id uuid REFERENCES markets(id), epoch integer NOT NULL, kind text NOT NULL,
 delta bigint NOT NULL, reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_ledger ON ledger(account_id,epoch,market_id);
CREATE TABLE commands (account_id uuid REFERENCES accounts(id), key uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(account_id,key));
CREATE TABLE sessions (token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), expires_at timestamptz NOT NULL);
CREATE TABLE oauth_states (state_hash text PRIMARY KEY, verifier text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE bots (
 market_id uuid PRIMARY KEY REFERENCES markets(id), account_id uuid UNIQUE NOT NULL REFERENCES accounts(id),
 budget bigint NOT NULL CHECK(budget > 0), probabilities integer[] NOT NULL, spread integer NOT NULL, size integer NOT NULL,
 last_tick timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
