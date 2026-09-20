-- =============================================================================
-- Alma.kz — paste-in verification suite for your LIVE Supabase project
-- =============================================================================
-- Run this whole file in the Supabase SQL editor AFTER
--   1) supabase/migrations/0001_schema.sql
--   2) supabase/migrations/0002_rls.sql
--   3) supabase/seed.sql          (also refreshes the demo pickup slots)
-- and with Anonymous sign-ins enabled (Auth -> Providers -> Anonymous).
--
-- Everything runs inside ONE transaction that is ROLLED BACK at the end,
-- so the suite leaves zero footprint and never touches real data.
--
-- It proves, on your live project, exactly what the backend promises:
--   * RLS: guests see only their own orders (table + orders_with_items view)
--   * pricing is computed server-side, tamper-proof
--   * slot lifecycle: no-slot / empty-cart / per-guest limit / full slot /
--     past slot rejected; cancel and expiry release capacity
--   * error codes are distinct SQLSTATEs, not one generic P0001
--
-- Results print as a table at the end — every row must show ok = true.
-- =============================================================================

begin;

create temp table suite_results (name text, ok boolean, detail text);

create temp table suite_ctx as
select r.id as rest_id, s.id as slot_ok, m.id as item_id, m.price as item_price
  from public.restaurants r
  join lateral (
    select id from public.pickup_slots
     where restaurant_id = r.id and is_active and slot_time > now()
     order by slot_time limit 1
  ) s on true
  join lateral (
    select id, price from public.menu_items
     where restaurant_id = r.id and is_available
     order by title limit 1
  ) m on true
  where r.name = 'Alma Kitchen'
  limit 1;

-- SECURITY DEFINER so recording works even while the session role is
-- switched to anon/authenticated for RLS tests.
create or replace function pg_temp.suite_record(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql security definer as $$
begin
  insert into suite_results values (p_name, p_ok, p_detail);
end;
$$;

create or replace function pg_temp.as_guest(p_sub text)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_sub, 'role', 'authenticated')::text,
                     true);
end;
$$;

create or replace function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;

create or replace function pg_temp.as_admin()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard: the demo data must exist with a future slot
-- ---------------------------------------------------------------------------
do $$
declare v_rows int;
begin
  perform pg_temp.as_admin();
  select count(*) into v_rows from suite_ctx;
  if v_rows = 0 then
    raise exception 'No active restaurant with a future slot and a menu item was found. Run 0001, 0002 and seed.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Catalog visibility
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  perform pg_temp.as_anon();
  select count(*) into v_count from public.restaurants;
  perform pg_temp.suite_record('anon can read restaurants', v_count >= 1, v_count::text);
end $$;

do $$
declare v_count int;
begin
  perform pg_temp.as_anon();
  select count(*) into v_count from public.orders;
  perform pg_temp.suite_record('anon cannot read orders', v_count = 0, v_count::text);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Direct inserts are blocked
-- ---------------------------------------------------------------------------
do $$
declare v_rest uuid;
begin
  perform pg_temp.as_admin();
  select rest_id into v_rest from suite_ctx;

  perform pg_temp.as_guest('11111111-1111-1111-1111-111111111111');
  insert into public.orders (order_number, restaurant_id, total_amount)
  values ('RLS-TEST-X', v_rest, 100);
  perform pg_temp.suite_record('direct insert into orders is blocked', false);
exception when insufficient_privilege or check_violation then
  perform pg_temp.suite_record('direct insert into orders is blocked', true, sqlstate);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Happy path: Order shape with items, server-side price, qr_token,
--    slot booking
-- ---------------------------------------------------------------------------
do $$
declare
  v_order jsonb;
  v_load int;
  v_rest uuid; v_slot uuid; v_item uuid; v_price numeric;
begin
  perform pg_temp.as_admin();
  select rest_id, slot_ok, item_id, item_price into v_rest, v_slot, v_item, v_price from suite_ctx;

  perform pg_temp.as_guest('11111111-1111-1111-1111-111111111111');
  select public.create_order(
    v_rest, v_slot,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 2)))
  into v_order;

  perform pg_temp.suite_record(
    'create_order returns jsonb with items array',
    v_order ? 'items' and jsonb_typeof(v_order->'items') = 'array'
             and jsonb_array_length(v_order->'items') = 1,
    left(v_order::text, 120));

  perform pg_temp.suite_record(
    'total is computed server-side (2 x menu price)',
    (v_order->>'total_amount')::numeric = v_price * 2,
    v_order->>'total_amount');

  perform pg_temp.suite_record('qr_token is set',
    coalesce(length(v_order->>'qr_token'), 0) > 10);

  perform pg_temp.suite_record('order_number looks like YYMMDD-XXXXXX',
    v_order->>'order_number' ~ '^\d{6}-[A-Z0-9]{6}$',
    v_order->>'order_number');

  perform pg_temp.as_admin();
  select booked_load into v_load from public.pickup_slots where id = v_slot;
  perform pg_temp.suite_record('slot booked_load incremented', v_load = 1, v_load::text);
end $$;

-- ---------------------------------------------------------------------------
-- 3.5 Dashboard contract: the denormalized orders.items column
--     Runs on a fresh, isolated slot so it never interacts with the slot
--     state used by the other sections.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order jsonb;
  v_col   jsonb;
  v_view  jsonb;
  v_rest uuid; v_item uuid; v_dash uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, item_id into v_rest, v_item from suite_ctx;

  -- Isolated fresh slot between the seeded ones (90 min): it must never be
  -- the LATEST future slot, because section 7's cancel test books the latest
  -- slot and expects it to start empty.
  insert into public.pickup_slots (restaurant_id, slot_time, capacity)
  values (v_rest, now() + interval '90 minutes', 5) returning id into v_dash;

  perform pg_temp.as_guest('44444444-4444-4444-4444-444444444444');
  select public.create_order(
    v_rest, v_dash,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 3)))
  into v_order;

  perform pg_temp.as_admin();
  select items into v_col from public.orders where id = (v_order->>'id')::uuid;

  perform pg_temp.suite_record(
    'orders.items column filled in dashboard format (menuItemId)',
    v_col is not null
      and jsonb_typeof(v_col) = 'array'
      and jsonb_array_length(v_col) = 1
      and v_col->0 ? 'menuItemId' and v_col->0 ? 'title'
      and v_col->0 ? 'price'     and v_col->0 ? 'quantity'
      and (v_col->0->>'quantity')   = '3'
      and (v_col->0->>'menuItemId') = v_item::text,
    left(coalesce(v_col::text, 'null'), 120));

  select items into v_view from public.orders_with_items
   where id = (v_order->>'id')::uuid;

  perform pg_temp.suite_record(
    'orders_with_items view keeps frontend shape (items[].id)',
    jsonb_typeof(v_view) = 'array'
      and jsonb_array_length(v_view) = 1
      and v_view->0 ? 'id'
      and not (v_view->0 ? 'menuItemId'),
    left(coalesce(v_view::text, 'null'), 120));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Distinct error codes
-- ---------------------------------------------------------------------------
do $$
declare v_rest uuid; v_item uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, item_id into v_rest, v_item from suite_ctx;

  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  perform public.create_order(
    v_rest, null,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)));
  perform pg_temp.suite_record('no slot chosen -> SLTRQ', false);
exception when others then
  perform pg_temp.suite_record('no slot chosen -> SLTRQ', sqlstate = 'SLTRQ', sqlstate);
end $$;

do $$
declare v_rest uuid; v_slot uuid; v_item uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, slot_ok, item_id into v_rest, v_slot, v_item from suite_ctx;

  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  perform public.create_order(
    v_rest, v_slot,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 2.5)));
  perform pg_temp.suite_record('quantity 2.5 -> QTYIN (not a raw cast error)', false);
exception when others then
  perform pg_temp.suite_record('quantity 2.5 -> QTYIN (not a raw cast error)', sqlstate = 'QTYIN', sqlstate);
end $$;

do $$
declare v_rest uuid; v_slot uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, slot_ok into v_rest, v_slot from suite_ctx;

  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  perform public.create_order(v_rest, v_slot, '[]'::jsonb);
  perform pg_temp.suite_record('empty cart -> EMPT1', false);
exception when others then
  perform pg_temp.suite_record('empty cart -> EMPT1', sqlstate = 'EMPT1', sqlstate);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Per-guest limit: second open order on the same slot
-- ---------------------------------------------------------------------------
do $$
declare v_rest uuid; v_slot uuid; v_item uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, slot_ok, item_id into v_rest, v_slot, v_item from suite_ctx;

  perform pg_temp.as_guest('11111111-1111-1111-1111-111111111111');
  perform public.create_order(
    v_rest, v_slot,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)));
  perform pg_temp.suite_record('second open order per guest per slot -> SLTLT', false);
exception when others then
  perform pg_temp.suite_record('second open order per guest per slot -> SLTLT', sqlstate = 'SLTLT', sqlstate);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Full slot and past slot
-- ---------------------------------------------------------------------------
do $$
declare v_rest uuid; v_item uuid; v_tight uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, item_id into v_rest, v_item from suite_ctx;

  insert into public.pickup_slots (restaurant_id, slot_time, capacity)
  values (v_rest, now() + interval '2 hours', 1) returning id into v_tight;

  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  perform public.create_order(
    v_rest, v_tight,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)));

  perform pg_temp.as_guest('33333333-3333-3333-3333-333333333301');
  perform public.create_order(
    v_rest, v_tight,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)));
  perform pg_temp.suite_record('full slot -> SLTFU', false);
exception when others then
  perform pg_temp.suite_record('full slot -> SLTFU', sqlstate = 'SLTFU', sqlstate);
end $$;

do $$
declare v_rest uuid; v_item uuid; v_past uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, item_id into v_rest, v_item from suite_ctx;

  insert into public.pickup_slots (restaurant_id, slot_time, capacity)
  values (v_rest, now() - interval '10 minutes', 5) returning id into v_past;

  perform pg_temp.as_guest('33333333-3333-3333-3333-333333333302');
  perform public.create_order(
    v_rest, v_past,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)));
  perform pg_temp.suite_record('past slot -> SLTPT', false);
exception when others then
  perform pg_temp.suite_record('past slot -> SLTPT', sqlstate = 'SLTPT', sqlstate);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Cancel: foreign cancel rejected, own cancel releases capacity
-- ---------------------------------------------------------------------------
do $$
declare
  v_order jsonb;
  v_load int;
  v_rest uuid; v_item uuid; v_late uuid;
begin
  perform pg_temp.as_admin();
  select rest_id, item_id into v_rest, v_item from suite_ctx;

  select id into v_late from public.pickup_slots
   where restaurant_id = v_rest and is_active and slot_time > now()
   order by slot_time desc limit 1;

  perform pg_temp.as_guest('11111111-1111-1111-1111-111111111111');
  select public.create_order(
    v_rest, v_late,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)))
  into v_order;

  -- another guest must not be able to cancel it
  begin
    perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
    perform public.cancel_order((v_order->>'id')::uuid);
    perform pg_temp.suite_record('foreign cancel -> ORDCN', false);
  exception when others then
    perform pg_temp.suite_record('foreign cancel -> ORDCN', sqlstate = 'ORDCN', sqlstate);
  end;

  -- the owner cancels their own order
  perform pg_temp.as_guest('11111111-1111-1111-1111-111111111111');
  perform public.cancel_order((v_order->>'id')::uuid);
  perform pg_temp.suite_record('own cancel succeeds', true);

  perform pg_temp.as_admin();
  select booked_load into v_load from public.pickup_slots where id = v_late;
  perform pg_temp.suite_record('cancel releases slot capacity', v_load = 0, v_load::text);
end $$;

-- ---------------------------------------------------------------------------
-- 8. RLS isolation on orders and orders_with_items
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  perform pg_temp.as_admin();
  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  select count(*) into v_count from public.orders
   where guest_id <> '22222222-2222-2222-2222-222222222222'::uuid;
  perform pg_temp.suite_record('orders table: guest B sees 0 foreign rows', v_count = 0, v_count::text);
end $$;

do $$
declare v_count int;
begin
  perform pg_temp.as_admin();
  perform pg_temp.as_guest('22222222-2222-2222-2222-222222222222');
  select count(*) into v_count from public.orders_with_items
   where guest_id <> '22222222-2222-2222-2222-222222222222'::uuid;
  perform pg_temp.suite_record('orders_with_items view: guest B sees 0 foreign rows (security_invoker)', v_count = 0, v_count::text);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Expiry releases capacity
-- ---------------------------------------------------------------------------
do $$
declare v_slot uuid; v_load int; v_status text;
begin
  perform pg_temp.as_admin();

  insert into public.pickup_slots (restaurant_id, slot_time, capacity, booked_load)
  values ((select rest_id from suite_ctx), now() + interval '3 hours', 5, 1)
  returning id into v_slot;

  insert into public.orders (order_number, guest_id, restaurant_id, slot_id, total_amount,
                             status, payment_status, created_at)
  values ('EXPIRE-TEST', '11111111-1111-1111-1111-111111111111',
          (select rest_id from suite_ctx), v_slot, 100,
          'Created', 'Pending', now() - interval '31 minutes');

  perform public.expire_stale_orders();

  select status into v_status from public.orders where order_number = 'EXPIRE-TEST';
  perform pg_temp.suite_record('stale unpaid order -> Expired', v_status = 'Expired', coalesce(v_status, '?'));

  select booked_load into v_load from public.pickup_slots where id = v_slot;
  perform pg_temp.suite_record('expired order releases capacity', v_load = 0, v_load::text);
end $$;

-- Results (inside the transaction — temp tables die with the rollback below)
select name, ok, detail from suite_results order by ok, name;

rollback;
