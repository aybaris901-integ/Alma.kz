// Runs supabase/tests/live_test.sql VERBATIM on PGlite to prove the
// paste-in works before shipping it. Prints the results table and asserts
// every row is ok = true.
import { PGlite } from '/home/z/my-project/work/pglite-env/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const BACKEND = '/home/z/my-project/work/alma-backend/alma-fixed';
const stripPgcrypto = (s) => s.replace(/create extension if not exists pgcrypto;/i, '-- pgcrypto preinstalled on Supabase');
const sqlFile = (p) => stripPgcrypto(readFileSync(`${BACKEND}/${p}`, 'utf8'));

const db = new PGlite();

(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
    $$;
  `);
  await db.exec(sqlFile('supabase/migrations/0001_schema.sql'));
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant all on all tables in schema public to anon, authenticated;
    grant all on all sequences in schema public to anon, authenticated;
  `);
  await db.exec(sqlFile('supabase/migrations/0002_rls.sql'));
  await db.exec(sqlFile('supabase/seed.sql'));

  const suiteSql = sqlFile('supabase/tests/live_test.sql');
  const results = await db.exec(suiteSql); // verbatim, including begin/rollback

  // The results SELECT is the second-to-last statement (last is ROLLBACK)
  const stmts = results.filter((r) => Array.isArray(r.rows));
  const suiteRows = stmts[stmts.length - 2].rows;
  console.table(suiteRows);
  const failed = suiteRows.filter((r) => !r.ok);
  console.log(`\nlive_test.sql: ${suiteRows.length} checks, ${failed.length} failed`);
  if (failed.length) process.exit(1);

  // Post-rollback cleanliness: the suite must leave zero footprint
  const { rows } = await db.query(`select count(*)::int as n from public.orders where order_number like 'RLS-TEST%' or order_number = 'EXPIRE-TEST'`);
  console.log(`footprint check: ${rows[0].n} leftover test orders (expect 0)`);
  process.exit(rows[0].n === 0 ? 0 : 1);
})().catch((e) => { console.error('SUITE ERROR:', String(e.message).slice(0, 300)); process.exit(2); });
