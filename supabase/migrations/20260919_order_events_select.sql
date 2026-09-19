-- The partner dashboard's analytics summary reads today's order_events with
-- the publishable (anon) key, so it needs a SELECT policy alongside INSERT.
-- Run in Supabase → SQL Editor. Safe to re-run.

drop policy if exists "partner dashboard can read order events" on public.order_events;
create policy "partner dashboard can read order events"
  on public.order_events
  for select
  to anon, authenticated
  using (true);
