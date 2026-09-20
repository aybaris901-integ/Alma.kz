-- Row Level Security
-- With a Vite frontend calling Supabase directly (no server), RLS is the
-- only thing standing between the anon key and your data — it must be on
-- for every table.
--
-- This file is IDEMPOTENT: every policy is preceded by `drop policy if
-- exists`, so re-running it on an already-migrated project succeeds (the
-- previous version used bare `create policy`, which fails the second time
-- with "policy already exists").

alter table public.restaurants  enable row level security;
alter table public.menu_items   enable row level security;
alter table public.pickup_slots enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;

-- ---------------------------------------------------------------------------
-- Public catalog: anyone (anon key) can read active/available rows.
-- No one can write via the client — only via the SQL editor / a future
-- restaurant-dashboard app with its own auth. RLS alone already blocks
-- writes (there are no insert/update/delete policies); the explicit
-- REVOKEs below are belt-and-braces on top of that.
-- ---------------------------------------------------------------------------
drop policy if exists "restaurants are publicly readable"
  on public.restaurants;
create policy "restaurants are publicly readable"
  on public.restaurants for select
  using (is_active = true);

drop policy if exists "menu items are publicly readable"
  on public.menu_items;
create policy "menu items are publicly readable"
  on public.menu_items for select
  using (is_available = true);

drop policy if exists "pickup slots are publicly readable"
  on public.pickup_slots;
create policy "pickup slots are publicly readable"
  on public.pickup_slots for select
  using (is_active = true);

revoke insert, update, delete on public.restaurants  from anon, authenticated;
revoke insert, update, delete on public.menu_items   from anon, authenticated;
revoke insert, update, delete on public.pickup_slots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Orders: guests only see their own order history.
-- This assumes Supabase Anonymous Sign-Ins are enabled (Auth -> Providers
-- -> Anonymous), so every visitor gets a stable auth.uid() without a
-- login form. guest_id defaults to auth.uid() on insert (see 0001).
-- ---------------------------------------------------------------------------
drop policy if exists "guests can read their own orders"
  on public.orders;
create policy "guests can read their own orders"
  on public.orders for select
  using (guest_id = auth.uid());

-- Direct writes are blocked; orders must go through create_order() /
-- cancel_order(), which run as security definer and keep the slot
-- bookkeeping (booked_load, capacity) correct.
revoke insert, update, delete on public.orders      from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

grant execute on function public.create_order(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.cancel_order(uuid)              to anon, authenticated;

drop policy if exists "guests can read items on their own orders"
  on public.order_items;
create policy "guests can read items on their own orders"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.guest_id = auth.uid()
    )
  );
