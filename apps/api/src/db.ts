import pg from 'pg';
import { EventEmitter } from 'node:events';
pg.types.setTypeParser(20, (s) => {
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new Error('Money exceeds safe integer range');
  return n;
});
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});
// Each live socket removes its subscription on close; more than ten viewers is normal.
export const events = new EventEmitter().setMaxListeners(0);
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new Fault(status, message);
}
export type Tx = pg.PoolClient;
export async function transaction<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      const dbError = e as { code: string; constraint?: string };
      const retryable =
        ['40001', '40P01'].includes(dbError.code) ||
        (dbError.code === '23505' &&
          ['commands_pkey', 'accounts_subject_key'].includes(dbError.constraint ?? ''));
      if (!retryable || attempt === 4) throw e;
    } finally {
      c.release();
    }
  }
  throw new Error('Transaction retry exhausted');
}
