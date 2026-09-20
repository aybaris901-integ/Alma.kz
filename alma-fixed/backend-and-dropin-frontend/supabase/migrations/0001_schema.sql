-- Alma.kz core schema
-- Run this in the Supabase SQL editor, or via `supabase db push` if you use the CLI.
--
-- This file is IDEMPOTENT: you can run it again on a project where it was
-- already applied and it will not fail and will not duplicate anything.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table if not exists public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title         text not null,
  description   text,
  price         numeric(10,2) not null check (price >= 0),
  category      text not null,
  image_url     text,
  is_available  boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists menu_items_restaurant_id_idx on public.menu_items(restaurant_id);

-- ---------------------------------------------------------------------------
-- pickup_slots
-- ---------------------------------------------------------------------------
create table if not exists public.pickup_slots (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  slot_time     timestamptz not null,
  capacity      int not null check (capacity > 0),
  booked_load   int not null default 0 check (booked_load >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint booked_load_within_capacity check (booked_load <= capacity)
);

create index if not exists pickup_slots_restaurant_id_idx on public.pickup_slots(restaurant_id);

-- ---------------------------------------------------------------------------
-- orders
-- 'Expired' was added to the status set: create_order() lazily expires
-- stale unpaid orders (see expire_stale_orders below) so their slot
-- capacity is released instead of being held forever.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   text not null unique,
  guest_id       uuid not null default auth.uid(),
  restaurant_id  uuid not null references public.restaurants(id),
  slot_id        uuid references public.pickup_slots(id),
  total_amount   numeric(10,2) not null check (total_amount >= 0),
  status         text not null default 'Created'
                   check (status in ('Created','Paid','Preparing','Ready','PickedUp','Cancelled','Expired')),
  qr_token       text,
  payment_status text not null default 'Pending'
                   check (payment_status in ('Pending','Paid','Failed')),
  -- Denormalized mirror of the order's line items for external consumers
  -- (e.g. the operations dashboard), format per element:
  --   { "menuItemId": "<uuid>", "title": "...", "price": 0.00, "quantity": 1 }
  -- Written by create_order(); the relational order_items table remains the
  -- source of truth. Nullable so legacy rows can be backfilled in place.
  items          jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists orders_restaurant_id_idx on public.orders(restaurant_id);
create index if not exists orders_guest_id_idx on public.orders(guest_id);
create index if not exists orders_slot_id_idx on public.orders(slot_id);

-- If this migration runs against a project where the OLD orders table
-- (without 'Expired' in the check) already exists, upgrade the constraint
-- in place. On a fresh install the constraint above already has 'Expired',
-- so this block is a no-op. Either way, re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname  = 'orders_status_check'
       and conrelid = 'public.orders'::regclass
       and pg_get_constraintdef(oid) like '%Expired%'
  ) then
    alter table public.orders drop constraint if exists orders_status_check;
    alter table public.orders
      add constraint orders_status_check
      check (status in ('Created','Paid','Preparing','Ready','PickedUp','Cancelled','Expired'));
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items (relational — one row per line item, matches OrderItem shape)
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id),
  title        text not null,
  price        numeric(10,2) not null check (price >= 0),
  quantity     int not null check (quantity > 0)
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- Legacy installs: the orders table may predate the items column. Add it in
-- place (a no-op on fresh installs, where the create table above already
-- includes it). Re-running is safe.
alter table public.orders add column if not exists items jsonb;

-- Backfill orders that were created before the column existed, so the
-- dashboard sees item details for historical rows too. Idempotent: it only
-- touches rows where items is still null (create_order always sets it going
-- forward), and it reads from order_items, the relational source of truth.
update public.orders o
   set items = coalesce((
         select jsonb_agg(jsonb_build_object(
                  'menuItemId', oi.menu_item_id,
                  'title',      oi.title,
                  'price',      oi.price,
                  'quantity',   oi.quantity
                ) order by oi.id)
           from public.order_items oi
          where oi.order_id = o.id), '[]'::jsonb)
 where o.items is null;

-- View that reassembles orders + items into the exact shape types/shared.ts
-- expects (Order.items: OrderItem[]), so the frontend can query one thing.
--
-- security_invoker = true is NOT optional here. Without it, Postgres runs
-- the view's row-security checks as the view's OWNER (the postgres role,
-- which owns/bypasses RLS on the underlying tables) instead of as the
-- querying anon/authenticated user. That would make every guest's order
-- history readable by every other guest through this view, even though
-- 0002_rls.sql's "guests can read their own orders" policy looks correct
-- on the base table.
--
-- `alter view ... set` is used as well because CREATE OR REPLACE VIEW does
-- not reliably update the security_invoker reloption on older Postgres
-- versions; this way re-running the migration always lands in the right
-- state.
-- NOTE: the column list is EXPLICIT on purpose. orders now carries its own
-- items jsonb column (the DASHBOARD format: menuItemId/title/price/quantity),
-- so a bare `select o.*` would emit that column AND the aggregated `items`
-- alias below — a hard error ("column \"items\" specified more than once")
-- when the view is (re)created. The view keeps exposing the FRONTEND shape
-- (items[].id per OrderItem in types/shared.ts); dashboards read the base
-- orders table instead.
create or replace view public.orders_with_items
  with (security_invoker = true)
as
select
  o.id,
  o.order_number,
  o.guest_id,
  o.restaurant_id,
  o.slot_id,
  o.total_amount,
  o.status,
  o.qr_token,
  o.payment_status,
  o.created_at,
  o.updated_at,
  coalesce(
    (select json_agg(json_build_object(
              'id', oi.id,
              'title', oi.title,
              'price', oi.price,
              'quantity', oi.quantity
            ) order by oi.id)
     from public.order_items oi
     where oi.order_id = o.id),
    '[]'::json
  ) as items
from public.orders o;

alter view public.orders_with_items set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Lazy expiry: any order that stays 'Created' + 'Pending' for more than
-- UNPAID_ORDER_TTL minutes is marked 'Expired' and its slot capacity is
-- released. It is called at the start of every create_order(), so capacity
-- self-heals without needing pg_cron. The TTL is 30 minutes: long enough to
-- pay, short enough that a dead cart doesn't block a slot for hours.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with expired as (
    update public.orders
       set status = 'Expired'
     where status = 'Created'
       and payment_status = 'Pending'
       and created_at < now() - interval '30 minutes'
    returning slot_id
  )
  update public.pickup_slots s
     set booked_load = greatest(s.booked_load - 1, 0)
    from expired e
   where e.slot_id = s.id;
end;
$$;

-- Clients never need to call this directly — it runs inside create_order().
revoke execute on function public.expire_stale_orders()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic order creation: inserts the order + its items, books the slot and
-- expires stale orders in one transaction.
-- Call from the client with supabase.rpc('create_order', {...}).
--
-- Returns the created order as a single jsonb object in the EXACT shape of
-- the frontend `Order` type (types/shared.ts) — including `items` — so the
-- RPC result can be used as an Order directly. The old version returned a
-- bare `orders` row with no items, which did not match the frontend type.
--
-- The same line items are ALSO mirrored into the denormalized orders.items
-- jsonb column in the operations dashboard's format:
--   [{ "menuItemId": "...", "title": "...", "price": 0.00, "quantity": 1 }]
-- order_items stays the relational source of truth; the column is a read
-- model for consumers that do not join order_items.
--
-- Contract with the client:
--   p_restaurant_id  uuid   — the restaurant being ordered from
--   p_slot_id        uuid   — REQUIRED; a pickup slot at that restaurant
--   p_items          jsonb  — [{ "menu_item_id": "...", "quantity": 2 }, ...]
--
-- Only menu_item_id + quantity are accepted. Every price is looked up from
-- menu_items here, server-side, so the client can never set what a guest is
-- charged. The slot and every menu item must belong to p_restaurant_id, so
-- a request can't book a slot at one restaurant while billing items from
-- another.
--
-- Errors use distinct SQLSTATE codes (see README "Error codes") so the UI
-- can tell "slot full" from "item unavailable" — and messages are stable,
-- human-readable strings without raw UUIDs.
-- ---------------------------------------------------------------------------
drop function if exists public.create_order(uuid, uuid, jsonb, numeric);
drop function if exists public.create_order(uuid, uuid, jsonb);

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_slot_id       uuid,
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders;
  v_item      jsonb;
  v_menu_item public.menu_items;
  v_quantity  int;
  v_number    text;
  v_total     numeric(10,2) := 0;
  v_items     jsonb := '[]'::jsonb;
  v_guest     uuid;
  v_open_orders int;
begin
  -- 0) Self-heal capacity: expire stale unpaid orders first, so a slot that
  --    looks full because of abandoned carts frees up before we check it.
  perform public.expire_stale_orders();

  v_guest := auth.uid();
  if v_guest is null then
    raise exception 'Sign-in is required to place an order.'
      using errcode = 'NOSES',
            hint    = 'Enable Anonymous sign-ins and call signInAnonymously() first.';
  end if;

  -- 1) Cart must be a non-empty array.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.'
      using errcode = 'EMPT1';
  end if;

  -- 2) Restaurant must exist and be active.
  if not exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and is_active
  ) then
    raise exception 'This restaurant is not available right now.'
      using errcode = 'RSTAV';
  end if;

  -- 3) A pickup slot is required for this app's capacity model.
  if p_slot_id is null then
    raise exception 'Please choose a pickup time.'
      using errcode = 'SLTRQ';
  end if;

  -- 4) Per-guest fairness: serialize concurrent attempts by the same guest
  --    for the same slot, then enforce at most 1 open order per guest per
  --    slot, so one browser can't book a slot to capacity by itself.
  perform pg_advisory_xact_lock(
    hashtextextended(v_guest::text || ':' || p_slot_id::text, 0)
  );

  select count(*) into v_open_orders
    from public.orders
   where guest_id = v_guest
     and slot_id  = p_slot_id
     and status in ('Created','Paid','Preparing','Ready');

  if v_open_orders >= 1 then
    raise exception 'You already have an open order for this pickup time.'
      using errcode = 'SLTLT';
  end if;

  -- 5) Atomically claim one unit of slot capacity. The claim is a single
  --    UPDATE guarded by all preconditions, so two concurrent guests can
  --    never overbook the last spot. Any later failure in this function
  --    aborts the whole transaction, which rolls the claim back.
  update public.pickup_slots
     set booked_load = booked_load + 1
   where id = p_slot_id
     and restaurant_id = p_restaurant_id
     and is_active
     and slot_time > now()
     and booked_load < capacity;

  if not found then
    -- Tell "which precondition failed" apart by re-checking in order.
    if exists (
      select 1 from public.pickup_slots
       where id = p_slot_id and restaurant_id = p_restaurant_id
    ) then
      if not exists (
        select 1 from public.pickup_slots
         where id = p_slot_id and restaurant_id = p_restaurant_id and is_active
      ) then
        raise exception 'This pickup time is no longer offered.'
          using errcode = 'SLTOF';
      end if;
      if exists (
        select 1 from public.pickup_slots
         where id = p_slot_id and restaurant_id = p_restaurant_id
           and slot_time <= now()
      ) then
        raise exception 'That pickup time has already passed.'
          using errcode = 'SLTPT';
      end if;
      raise exception 'This pickup time is fully booked.'
        using errcode = 'SLTFU';
    end if;
    raise exception 'That pickup time is not available at this restaurant.'
      using errcode = 'SLTWT';
  end if;

  -- 6) Human-friendly order number + QR token for pickup verification.
  v_number := to_char(now(), 'YYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders
    (order_number, guest_id, restaurant_id, slot_id, total_amount,
     status, qr_token, payment_status)
  values
    (v_number, v_guest, p_restaurant_id, p_slot_id, 0,
     'Created', gen_random_uuid()::text, 'Pending')
  returning * into v_order;

  -- 7) Price every line server-side.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- Reject non-integer quantities BEFORE casting, so '2.5' or 'abc'
    -- raises the friendly QTYIN error instead of a raw cast failure.
    if v_item->>'quantity' is null or v_item->>'quantity' !~ '^\d+$' then
      raise exception 'Item quantity must be a whole number between 1 and 99.'
        using errcode = 'QTYIN';
    end if;

    v_quantity := (v_item->>'quantity')::int;

    if v_quantity is null or v_quantity <= 0 or v_quantity > 99 then
      raise exception 'Item quantity must be a whole number between 1 and 99.'
        using errcode = 'QTYIN';
    end if;

    select * into v_menu_item
      from public.menu_items
     where id = (v_item->>'menu_item_id')::uuid
       and restaurant_id = p_restaurant_id
       and is_available;

    if not found then
      raise exception 'One of the items in your cart is no longer available.'
        using errcode = 'ITMUN';
    end if;

    insert into public.order_items (order_id, menu_item_id, title, price, quantity)
    values (v_order.id, v_menu_item.id, v_menu_item.title, v_menu_item.price, v_quantity);

    -- Mirror the line into orders.items in the DASHBOARD format.
    v_items := v_items || jsonb_build_object(
                 'menuItemId', v_menu_item.id,
                 'title',      v_menu_item.title,
                 'price',      v_menu_item.price,
                 'quantity',   v_quantity);

    v_total := v_total + v_menu_item.price * v_quantity;
  end loop;

  update public.orders
     set total_amount = v_total,
         items        = v_items
   where id = v_order.id
  returning * into v_order;

  -- 8) Return the EXACT frontend `Order` shape (items included).
  return jsonb_build_object(
    'id',             v_order.id,
    'order_number',   v_order.order_number,
    'guest_id',       v_order.guest_id,
    'restaurant_id',  v_order.restaurant_id,
    'slot_id',        v_order.slot_id,
    'items',          coalesce((
                        select jsonb_agg(
                                 jsonb_build_object(
                                   'id',       oi.id,
                                   'title',    oi.title,
                                   'price',    oi.price,
                                   'quantity', oi.quantity
                                 ) order by oi.id)
                          from public.order_items oi
                         where oi.order_id = v_order.id
                      ), '[]'::jsonb),
    'total_amount',   v_order.total_amount,
    'status',         v_order.status,
    'qr_token',       v_order.qr_token,
    'payment_status', v_order.payment_status,
    'created_at',     v_order.created_at,
    'updated_at',     v_order.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Guest-side cancellation. A guest may cancel their own order while it is
-- still 'Created' or 'Paid'; the slot capacity is released immediately.
-- Runs as security definer but only ever touches rows whose guest_id equals
-- the calling auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  perform public.expire_stale_orders();

  if auth.uid() is null then
    raise exception 'Sign-in is required to cancel an order.'
      using errcode = 'NOSES';
  end if;

  update public.orders
     set status = 'Cancelled'
   where id = p_order_id
     and guest_id = auth.uid()
     and status in ('Created', 'Paid');

  if not found then
    raise exception 'This order can no longer be cancelled.'
      using errcode = 'ORDCN';
  end if;

  update public.pickup_slots
     set booked_load = greatest(booked_load - 1, 0)
   where id = (select slot_id from public.orders where id = p_order_id)
     and booked_load > 0;

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'id',             v_order.id,
    'order_number',   v_order.order_number,
    'guest_id',       v_order.guest_id,
    'restaurant_id',  v_order.restaurant_id,
    'slot_id',        v_order.slot_id,
    'items',          coalesce((
                        select jsonb_agg(
                                 jsonb_build_object(
                                   'id',       oi.id,
                                   'title',    oi.title,
                                   'price',    oi.price,
                                   'quantity', oi.quantity
                                 ) order by oi.id)
                          from public.order_items oi
                         where oi.order_id = v_order.id
                      ), '[]'::jsonb),
    'total_amount',   v_order.total_amount,
    'status',         v_order.status,
    'qr_token',       v_order.qr_token,
    'payment_status', v_order.payment_status,
    'created_at',     v_order.created_at,
    'updated_at',     v_order.updated_at
  );
end;
$$;
