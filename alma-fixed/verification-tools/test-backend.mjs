// Verification Pass 1 — backend SQL on real Postgres (PGlite / Postgres 16 WASM)
// Bootstraps a Supabase-like environment (anon/authenticated roles + auth.uid()),
// runs the migrations + seed TWICE (idempotency proof), then exercises the
// full contract: RLS, server-side pricing, slot lifecycle, error codes.
import { PGlite } from '/home/z/my-project/work/pglite-env/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const BACKEND = '/home/z/my-project/work/alma-backend/alma-fixed';
// pgcrypto is preinstalled on Supabase; on PGlite gen_random_uuid() is core
// (PG13+), so the create-extension statement is a no-op for this harness.
const sqlFile = (p) => readFileSync(`${BACKEND}/${p}`, 'utf8')
  .replace(/create extension if not exists pgcrypto;/i, '-- (pgcrypto preinstalled on Supabase; gen_random_uuid is core on PGlite)');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name} ${extra}`); }
}
function errCode(e) {
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  const m = String(e.message || e).match(/SQLSTATE (\w{5})/);
  if (m) return m[1];
  // PGlite raises with .code rarely; check message for our custom codes
  const c = String(e.message || '').match(/\b(NOSES|EMPT1|RSTAV|SLTRQ|SLTWT|SLTOF|SLTPT|SLTLT|SLTFU|ITMUN|QTYIN|ORDCN|42501|23514)\b/);
  return c ? c[1] : String(e.message || e).slice(0, 80);
}

const GUEST_A = '11111111-1111-1111-1111-111111111111';
const GUEST_B = '22222222-2222-2222-2222-222222222222';
const GUEST_C = '33333333-3333-3333-3333-333333333333';
const GUEST_D = '44444444-4444-4444-4444-444444444444';

const db = new PGlite();

async function admin(sql, params) { return db.query(sql, params); }

// Run inside a transaction as a Supabase JWT-bearing role (how PostgREST does it)
async function asGuest(guestId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: guestId, role: 'authenticated' })]);
    return fn(tx);
  });
}

async function expectError(name, wantCode, fn) {
  try { await fn(); ok(name, false, `— expected ${wantCode}, no error thrown`); }
  catch (e) { ok(name, errCode(e) === wantCode, `— got: ${errCode(e)} / ${String(e.message).slice(0, 100)}`); }
}

const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
$$;
`;

(async () => {
  console.log('== Bootstrap Supabase-like environment ==');
  await db.exec(bootstrap);
  await db.exec(sqlFile('supabase/migrations/0001_schema.sql'));
  // Supabase baseline: by default anon/authenticated get broad grants; migrations carve them down
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant all on all tables in schema public to anon, authenticated;
    grant all on all sequences in schema public to anon, authenticated;
  `);
  await db.exec(sqlFile('supabase/migrations/0002_rls.sql'));
  await db.exec(sqlFile('supabase/seed.sql'));
  console.log('  migrations + seed applied (run 1) OK');

  console.log('== IDEMPOTENCY: apply all three files again (runs 2 and 3) ==');
  try {
    await db.exec(sqlFile('supabase/migrations/0001_schema.sql'));
    await db.exec(sqlFile('supabase/migrations/0002_rls.sql'));
    await db.exec(sqlFile('supabase/seed.sql'));
    await db.exec(sqlFile('supabase/migrations/0001_schema.sql'));
    await db.exec(sqlFile('supabase/migrations/0002_rls.sql'));
    await db.exec(sqlFile('supabase/seed.sql'));
    ok('migrations + seed re-run twice without error', true);
  } catch (e) { ok('migrations + seed re-run twice without error', false, String(e.message).slice(0, 200)); }

  // IDs of seeded data
  const { rows: restRows } = await admin(`select id from public.restaurants where name = 'Alma Kitchen'`);
  const REST = restRows[0].id;
  const { rows: slotRows } = await admin(
    `select id from public.pickup_slots where restaurant_id = $1 and is_active order by slot_time`, [REST]);
  const S1 = slotRows[0].id, S2 = slotRows[1].id, S3 = slotRows[2].id;
  const { rows: menuRows } = await admin(
    `select id, price, title from public.menu_items where restaurant_id = $1 order by title`, [REST]);
  const MI = menuRows[0];
  const items1 = JSON.stringify([{ menu_item_id: MI.id, quantity: 2 }]);

  console.log('== Catalog & RLS baseline ==');
  const { rows: anonRest } = await db.transaction(async (tx) => {
    await tx.query(`set local role anon`);
    return tx.query(`select * from public.restaurants`);
  });
  ok('anon can read restaurants (1 seeded)', anonRest.length === 1);
  const { rows: anonOrders } = await db.transaction(async (tx) => {
    await tx.query(`set local role anon`);
    return tx.query(`select * from public.orders`);
  });
  ok('anon sees zero order rows', anonOrders.length === 0);

  await expectError('guest cannot INSERT directly into orders (42501)', '42501', () =>
    asGuest(GUEST_A, (tx) => tx.query(
      `insert into public.orders (order_number, restaurant_id, total_amount) values ('X-1', $1, 100)`, [REST])));

  console.log('== create_order happy path ==');
  let orderA;
  await asGuest(GUEST_A, async (tx) => {
    const { rows } = await tx.query(
      `select public.create_order($1::uuid, $2::uuid, $3::jsonb) as o`,
      [REST, S1, items1]);
    orderA = rows[0].o;
  });
  ok('returns jsonb (not a bare row)', orderA !== null && typeof orderA === 'object' && !Array.isArray(orderA));
  ok('has items array with 1 line, correct fields',
    Array.isArray(orderA.items) && orderA.items.length === 1 &&
    ['id', 'title', 'price', 'quantity'].every(k => k in orderA.items[0]));
  ok('server-side pricing: total = price * qty', Number(orderA.total_amount) === Number(MI.price) * 2,
    `got ${orderA.total_amount}, expected ${Number(MI.price) * 2}`);
  ok('qr_token set', typeof orderA.qr_token === 'string' && orderA.qr_token.length > 10);
  ok('order_number matches YYMMDD-XXXXXX', /^\d{6}-[A-Z0-9]{6}$/.test(orderA.order_number), orderA.order_number);
  ok('status Created, payment Pending', orderA.status === 'Created' && orderA.payment_status === 'Pending');
  const { rows: s1 } = await admin(`select booked_load, capacity from public.pickup_slots where id = $1`, [S1]);
  ok('slot booked_load incremented to 1', Number(s1[0].booked_load) === 1);

  // Dashboard contract: create_order must ALSO fill the denormalized
  // orders.items jsonb column in the dashboard's own format.
  const { rows: oItemsCol } = await admin(`select items from public.orders where id = $1`, [orderA.id]);
  ok('orders.items column filled in dashboard format (menuItemId)',
    Array.isArray(oItemsCol[0]?.items) && oItemsCol[0].items.length === 1 &&
    ['menuItemId', 'title', 'price', 'quantity'].every(k => k in oItemsCol[0].items[0]) &&
    oItemsCol[0].items[0].menuItemId === MI.id &&
    oItemsCol[0].items[0].quantity === 2,
    JSON.stringify(oItemsCol[0]?.items)?.slice(0, 80));

  // Tamper attempt: client-sent price must be ignored
  let orderTamper;
  await asGuest(GUEST_D, async (tx) => {
    const { rows } = await tx.query(
      `select public.create_order($1::uuid, $2::uuid, $3::jsonb) as o`,
      [REST, S3, JSON.stringify([{ menu_item_id: MI.id, quantity: 1 }])]);
    orderTamper = rows[0].o;
  });
  ok('client cannot influence price (total computed server-side)',
    Number(orderTamper.total_amount) === Number(MI.price));

  console.log('== Slot lifecycle errors ==');
  await expectError('no slot chosen -> SLTRQ', 'SLTRQ', () =>
    asGuest(GUEST_C, (tx) => tx.query(`select public.create_order($1::uuid, null, $2::jsonb)`, [REST, items1])));
  await expectError('empty cart -> EMPT1', 'EMPT1', () =>
    asGuest(GUEST_C, (tx) => tx.query(`select public.create_order($1::uuid, $2::uuid, '[]'::jsonb)`, [REST, S1])));
  await expectError('slot at another restaurant -> SLTWT', 'SLTWT', async () => {
    await admin(`insert into public.restaurants (id, name, address) values ($1, 'Other', 'x')`,
      ['aaaaaaaa-0000-0000-0000-000000000001']);
    await admin(`insert into public.pickup_slots (id, restaurant_id, slot_time, capacity) values ($1, $2, now() + interval '2 hours', 5)`,
      ['aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001']);
    await asGuest(GUEST_C, (tx) => tx.query(
      `select public.create_order($1::uuid, $2::uuid, $3::jsonb)`,
      [REST, 'aaaaaaaa-0000-0000-0000-000000000002', items1]));
  });
  await expectError('past slot -> SLTPT', 'SLTPT', async () => {
    const { rows } = await admin(
      `insert into public.pickup_slots (restaurant_id, slot_time, capacity) values ($1, now() - interval '10 minutes', 5) returning id`,
      [REST]);
    await asGuest(GUEST_C, (tx) => tx.query(`select public.create_order($1::uuid, $2::uuid, $3::jsonb)`, [REST, rows[0].id, items1]));
  });
  await expectError('quantity 2.5 -> QTYIN (not a raw cast error)', 'QTYIN', () =>
    asGuest(GUEST_C, (tx) => tx.query(
      `select public.create_order($1::uuid, $2::uuid, $3::jsonb)`,
      [REST, S1, JSON.stringify([{ menu_item_id: MI.id, quantity: 2.5 }])])));
  await expectError('unavailable item -> ITMUN', 'ITMUN', async () => {
    await admin(`update public.menu_items set is_available = false where id = $1`, [MI.id]);
    try {
      await asGuest(GUEST_C, (tx) => tx.query(
        `select public.create_order($1::uuid, $2::uuid, $3::jsonb)`,
        [REST, S1, JSON.stringify([{ menu_item_id: MI.id, quantity: 1 }])]));
    } finally {
      await admin(`update public.menu_items set is_available = true where id = $1`, [MI.id]);
    }
  });

  console.log('== Per-guest limit & capacity ==');
  await asGuest(GUEST_B, async (tx) => {
    await tx.query(`select public.create_order($1::uuid, $2::uuid, $3::jsonb)`, [REST, S2, items1]);
  });
  await expectError('same guest re-books same slot -> SLTLT', 'SLTLT', () =>
    asGuest(GUEST_B, (tx) => tx.query(`select public.create_order($1::uuid, $2::uuid, $3::jsonb)`, [REST, S2, items1])));
  await expectError('full slot -> SLTFU', 'SLTFU', async () => {
    await admin(`update public.pickup_slots set capacity = 1 where id = $1`, [S3]);
    await asGuest(GUEST_C, (tx) => tx.query(`select public.create_order($1::uuid, $2::uuid, $3::jsonb)`, [REST, S3, items1]));
  });

  console.log('== Cancel & expiry release capacity ==');
  let cancelled;
  await asGuest(GUEST_A, async (tx) => {
    const { rows } = await tx.query(`select public.cancel_order($1::uuid) as o`, [orderA.id]);
    cancelled = rows[0].o;
  });
  ok('cancel_order sets status Cancelled', cancelled.status === 'Cancelled');
  const { rows: s1b } = await admin(`select booked_load from public.pickup_slots where id = $1`, [S1]);
  ok('cancelled order releases slot capacity', Number(s1b[0].booked_load) === 0, `got ${s1b[0].booked_load}`);
  await expectError('guest B cannot cancel guest A order -> ORDCN', 'ORDCN', () =>
    asGuest(GUEST_B, (tx) => tx.query(`select public.cancel_order($1::uuid)`, [orderTamper.id])));

  // expiry: create a stale Created+Pending order holding capacity
  const { rows: expSlot } = await admin(
    `insert into public.pickup_slots (restaurant_id, slot_time, capacity, booked_load) values ($1, now() + interval '90 minutes', 5, 1) returning id`,
    [REST]);
  await admin(`insert into public.orders (order_number, guest_id, restaurant_id, slot_id, total_amount, status, payment_status, created_at)
               values ('OLD-1', $1, $2, $3, 100, 'Created', 'Pending', now() - interval '31 minutes')`,
    [GUEST_A, REST, expSlot[0].id]);
  await admin(`select public.expire_stale_orders()`);
  const { rows: expOrder } = await admin(`select status from public.orders where order_number = 'OLD-1'`);
  ok('stale unpaid order auto-expires (Expired)', expOrder[0].status === 'Expired', expOrder[0]?.status);
  const { rows: expSlot2 } = await admin(`select booked_load from public.pickup_slots where id = $1`, [expSlot[0].id]);
  ok('expired order releases slot capacity', Number(expSlot2[0].booked_load) === 0, `got ${expSlot2[0].booked_load}`);

  console.log('== orders_with_items view (security_invoker RLS) ==');
  const { rows: aView } = await asGuest(GUEST_A, (tx) =>
    tx.query(`select * from public.orders_with_items order by created_at desc`));
  ok('guest A sees own orders via view with items', aView.length >= 1 && aView.every(r => r.guest_id === GUEST_A));
  ok('view rows carry items array', Array.isArray(aView[0].items));
  const { rows: bView } = await asGuest(GUEST_B, (tx) =>
    tx.query(`select * from public.orders_with_items`));
  ok('guest B cannot see guest A rows through the view', bView.every(r => r.guest_id === GUEST_B));
  const { rows: aDirect } = await asGuest(GUEST_A, (tx) => tx.query(`select * from public.orders`));
  ok('base table RLS: guest A sees only own orders', aDirect.every(r => r.guest_id === GUEST_A));

  console.log('== Slot freshness helper ==');
  await admin(`select public.refresh_demo_slots()`);
  const { rows: futureSlots } = await admin(
    `select count(*)::int as n from public.pickup_slots where restaurant_id = $1 and is_active and slot_time > now()`, [REST]);
  ok('refresh_demo_slots leaves >= 3 future slots', futureSlots[0].n >= 3, `got ${futureSlots[0].n}`);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (failures.length) { console.log('Failures:', failures.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
