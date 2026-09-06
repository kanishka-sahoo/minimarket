import { z } from 'zod';
export const DOLLAR = 1_000_000;
export const CENT = 10_000;
export const GRANT = 10_000 * DOLLAR;
export const categories = [
  'Technology',
  'Science',
  'Sports',
  'Culture',
  'World',
  'Finance',
] as const;
export const idSchema = z.string().uuid();
export const quantitySchema = z.number().int().min(1).max(100_000);
export const orderSchema = z
  .object({
    marketId: idSchema,
    outcomeId: idSchema,
    side: z.enum(['buy', 'sell']),
    price: z
      .number()
      .int()
      .min(CENT)
      .max(99 * CENT)
      .refine((n) => n % CENT === 0, 'Use whole cents'),
    quantity: quantitySchema,
    tif: z.enum(['GTC', 'IOC']).default('GTC'),
  })
  .strict();
export const marketSchema = z
  .object({
    title: z.string().trim().min(12).max(180),
    category: z.enum(categories),
    criteria: z.string().trim().min(30).max(4000),
    source: z
      .url()
      .max(1000)
      .refine((s) => /^https?:/.test(s), 'Use an HTTP(S) source'),
    closesAt: z.iso.datetime(),
    kind: z.enum(['binary', 'multi']),
    outcomes: z.array(z.string().trim().min(1).max(60)).min(2).max(8),
  })
  .strict()
  .superRefine((m, c) => {
    if (new Set(m.outcomes.map((x) => x.toLowerCase())).size !== m.outcomes.length)
      c.addIssue({ code: 'custom', message: 'Outcomes must be unique' });
    if (m.kind === 'binary' && JSON.stringify(m.outcomes) !== '["Yes","No"]')
      c.addIssue({ code: 'custom', message: 'Binary outcomes must be Yes and No' });
  });
export const setSchema = z
  .object({ marketId: idSchema, quantity: quantitySchema, action: z.enum(['mint', 'redeem']) })
  .strict();
export const resolutionSchema = z
  .object({
    marketId: idSchema,
    winnerId: idSchema.nullable(),
    evidence: z.string().trim().min(10).max(2000),
    confirm: z.literal(true),
  })
  .strict();
export const botSchema = z
  .object({
    marketId: idSchema,
    budget: z
      .number()
      .int()
      .min(10 * DOLLAR)
      .max(1_000_000 * DOLLAR),
    probabilities: z.array(z.number().int().min(1).max(9999)).min(2).max(8),
    spread: z.number().int().min(1).max(20).default(4),
    size: z.number().int().min(1).max(100).default(10),
  })
  .strict()
  .refine(
    (x) => x.probabilities.reduce((a, b) => a + b, 0) === 10000,
    'Probabilities must total 100%',
  );
export type OrderInput = z.infer<typeof orderSchema>;
export type MarketInput = z.infer<typeof marketSchema>;
export type SetInput = z.infer<typeof setSchema>;
export type BotInput = z.infer<typeof botSchema>;
export interface User {
  id: string;
  name: string;
  email: string;
  admin: boolean;
  cash: number;
  reserved: number;
  epoch: number;
  resetUsed: boolean;
}
export interface Outcome {
  id: string;
  market_id: string;
  label: string;
  ordinal: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  payout: number | null;
}
export interface Market {
  id: string;
  title: string;
  category: string;
  criteria: string;
  source: string;
  closes_at: string;
  status: 'open' | 'closed' | 'settled';
  kind: 'binary' | 'multi';
  demo: boolean;
  hidden: boolean;
  halted: boolean;
  version: number;
  volume: number;
  collateral: number;
  evidence: string | null;
  outcomes: Outcome[];
  bot: boolean;
}
export interface BookLevel {
  price: number;
  quantity: number;
}
export interface Trade {
  id: string;
  outcome_id: string;
  price: number;
  quantity: number;
  created_at: string;
}
export interface Snapshot {
  market: Market;
  books: Record<string, { bids: BookLevel[]; asks: BookLevel[] }>;
  trades: Trade[];
}
export interface Order {
  id: string;
  market_id: string;
  outcome_id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  remaining: number;
  status: string;
  title: string;
  label: string;
  created_at: string;
}
export interface Holding {
  market_id: string;
  outcome_id: string;
  title: string;
  label: string;
  quantity: number;
  reserved: number;
  mark: number | null;
  status: string;
}
export interface LedgerEntry {
  id: string;
  kind: string;
  delta: number;
  created_at: string;
  title: string | null;
  epoch: number;
}
export interface Portfolio {
  holdingsCount: number;
  openOrderCount: number;
  user: User;
  holdings: Holding[];
  orders: Order[];
  history: LedgerEntry[];
  estimatedValue: number;
  unpricedShares: number;
  settledProfit: number;
}
export interface OrderResult {
  id: string;
  filled: number;
  remaining: number;
  canceled: number;
  averagePrice: number | null;
  fills: { price: number; quantity: number }[];
}
export const money = (n: number, precision = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: precision,
  }).format(n / DOLLAR);
export const cents = (n: number | null) => (n === null ? '-' : `${Math.round(n / CENT)}¢`);

export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
    search: z.string().trim().max(180).default(''),
    category: z.enum(categories).optional(),
    sort: z.enum(['newest', 'volume', 'closing']).default('newest'),
    marketId: idSchema.optional(),
    outcomeId: idSchema.optional(),
    admin: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type PageQuery = z.infer<typeof pageQuerySchema>;
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}
export type Collection =
  | 'markets'
  | 'holdings'
  | 'orders'
  | 'open-orders'
  | 'activity'
  | 'trades'
  | 'leaderboard';
export interface Ranking {
  id: string;
  name: string;
  epoch: number;
  profit: number;
  markets: number;
}
