// Runs in a separate OS process to prove notifications do not rely on an in-process emitter.
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { moderate } from '../src/exchange.ts';
const [actor, market] = process.argv.slice(2);
try {
  await moderate(actor, randomUUID(), market, 'hide');
} finally {
  await pool.end();
}
