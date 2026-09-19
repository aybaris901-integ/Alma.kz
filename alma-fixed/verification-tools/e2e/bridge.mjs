// E2E bridge: HTTP endpoint in front of PGlite so the browser-side Supabase
// mock executes the REAL SQL (migrations, RLS, RPCs) against a real Postgres
// engine. This emulates the part of Supabase that matters for verification:
// PostgREST-ish role/JWT handling + the create_order/cancel_order RPCs.
import { PGlite } from '/home/z/my-project/work/pglite-env/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const BACKEND = '/home/z/my-project/work/alma-backend/alma-fixed';
const stripPgcrypto = (s) => s.replace(/create extension if not exists pgcrypto;/i, '-- pgcrypto preinstalled on Supabase');
const sqlFile = (p) => stripPgcrypto(readFileSync(`${BACKEND}/${p}`, 'utf8'));

const db = new PGlite();
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
console.log('[bridge] PGlite booted: migrations + seed applied');

async function runSql({ sql, params = [], role, sub }) {
  return db.transaction(async (tx) => {
    if (role) await tx.query(`select set_config('role', $1, true)`, [role]);
    if (sub) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub, role: role || 'authenticated' }),
      ]);
    }
    const res = await tx.query(sql, params);
    return { rows: res.rows };
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const { sql, params, role, sub } = JSON.parse(body);
    const out = await runSql({ sql, params, role, sub });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const code = (e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) ? e.code : 'XXERR';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code, message: e.message } }));
  }
});

server.listen(8911, () => console.log('[bridge] listening on :8911'));
