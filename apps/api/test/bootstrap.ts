import { pool, assert } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
const db = (await pool.query('SELECT current_database() AS name')).rows[0].name;
assert(
  process.env.NODE_ENV === 'test' && db.endsWith('_e2e'),
  'Browser bootstrap requires a dedicated database ending in _e2e',
);
await migrate();
await pool.query('TRUNCATE accounts CASCADE');
await seed();
await pool.end();
