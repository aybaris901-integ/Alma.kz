-- order_events: one row per orders.status transition, written by the partner
-- dashboard right after each successful status update. Raw source for the
-- Average Pickup Waiting Time metric (Ready → PickedUp deltas) — no
-- aggregation lives in the DB yet.
--
-- Run in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  status     text not null,
  changed_at timestamptz not null default now()
);

-- The metric query will be "events for an order, in time order".
create index if not exists order_events_order_id_changed_at_idx
  on public.order_events (order_id, changed_at);

-- The dashboard writes with the publishable (anon) key, so RLS must let it
-- insert. Reads are left to the service role / future analytics job.
alter table public.order_events enable row level security;

drop policy if exists "partner dashboard can log order events" on public.order_events;
create policy "partner dashboard can log order events"
  on public.order_events
  for insert
  to anon, authenticated
  with check (true);
