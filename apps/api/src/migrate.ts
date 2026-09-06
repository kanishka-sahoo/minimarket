import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(917731)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if ((await c.query('SELECT 1 FROM migrations WHERE name=$1', [name])).rowCount) continue;
      await c.query(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
      await c.query('INSERT INTO migrations(name) VALUES($1)', [name]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
/** Vercel instances only check the release schema; they never run DDL at cold start. */
export async function verifyMigrations() {
  const exists = (await pool.query("SELECT to_regclass('public.migrations') AS name")).rows[0].name;
  if (!exists) throw new Error('Database is not initialized. Run db:migrate before deploying.');
  const applied = new Set(
    (await pool.query('SELECT name FROM migrations')).rows.map((row) => row.name),
  );
  const pending = (await readdir(new URL('../migrations/', import.meta.url))).filter(
    (name) => name.endsWith('.sql') && !applied.has(name),
  );
  if (pending.length)
    throw new Error(`Run db:migrate before deploying. Pending migrations: ${pending.join(', ')}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  await pool.end();
  console.log('Migrations applied');
}
