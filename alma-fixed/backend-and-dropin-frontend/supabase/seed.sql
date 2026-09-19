-- Seed data so the frontend catalog isn't empty.
--
-- Safe to re-run:
--   * the restaurant/menu insert is skipped when 'Alma Kitchen' exists
--   * refresh_demo_slots() (defined below) retires past demo slots and
--     tops the demo back up to 3 future slots whenever it runs
--
-- So if your demo is older than ~3 hours and shows no pickup times,
-- just run this file again in the SQL editor — the slots refresh.

-- ---------------------------------------------------------------------------
-- Demo-slot refresh. Deletes past demo slots that nobody booked, deactivates
-- past slots that are fully booked, and recreates 3 future slots (+1h/+2h/+3h)
-- if none are left. SECURITY DEFINER so it can manage slots regardless of the
-- calling role, but it is intentionally NOT executable by anon/authenticated —
-- it is an operator tool for the SQL editor, not a client API.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_demo_slots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  select id into v_restaurant_id
    from public.restaurants
   where name = 'Alma Kitchen';

  if v_restaurant_id is null then
    raise notice 'refresh_demo_slots: Alma Kitchen not found, nothing to do';
    return;
  end if;

  -- Free the capacity of any 'Created' demo orders that went stale, then
  -- clean up past slots: delete the empty ones, deactivate the booked ones.
  perform public.expire_stale_orders();

  delete from public.pickup_slots
   where restaurant_id = v_restaurant_id
     and slot_time < now()
     and booked_load = 0;

  update public.pickup_slots
     set is_active = false
   where restaurant_id = v_restaurant_id
     and slot_time < now()
     and is_active;

  if not exists (
    select 1 from public.pickup_slots
     where restaurant_id = v_restaurant_id
       and is_active
       and slot_time > now()
  ) then
    insert into public.pickup_slots (restaurant_id, slot_time, capacity, booked_load, is_active)
    values
      (v_restaurant_id, now() + interval '1 hour',  5, 0, true),
      (v_restaurant_id, now() + interval '2 hours', 5, 0, true),
      (v_restaurant_id, now() + interval '3 hours', 5, 0, true);
    raise notice 'refresh_demo_slots: 3 future slots recreated';
  else
    raise notice 'refresh_demo_slots: future slots already exist';
  end if;
end;
$$;

revoke execute on function public.refresh_demo_slots()
  from public, anon, authenticated;

do $$
declare
  v_restaurant_id uuid;
begin
  select id into v_restaurant_id
    from public.restaurants
   where name = 'Alma Kitchen';

  if v_restaurant_id is null then
    insert into public.restaurants (name, address, is_active)
    values ('Alma Kitchen', 'ул. Абая 10, Алматы', true)
    returning id into v_restaurant_id;

    insert into public.menu_items (restaurant_id, title, description, price, category, is_available)
    values
      (v_restaurant_id, 'Beshbarmak',      'Traditional beef beshbarmak with noodles', 3200, 'Main',     true),
      (v_restaurant_id, 'Plov',            'Uzbek-style rice pilaf with lamb',          2400, 'Main',     true),
      (v_restaurant_id, 'Shashlik',        'Grilled lamb skewers, 2 pcs',                2800, 'Grill',    true),
      (v_restaurant_id, 'Achichuk Salad',  'Tomato, onion, cilantro salad',              900,  'Salad',    true),
      (v_restaurant_id, 'Baursak (5 pcs)', 'Fried dough, served with honey',             700,  'Dessert',  true),
      (v_restaurant_id, 'Ayran',           'Chilled yogurt drink, 0.3L',                 500,  'Drink',    true);

    raise notice 'seed: Alma Kitchen created with 6 menu items';
  else
    raise notice 'seed: Alma Kitchen already exists (id=%), menu untouched', v_restaurant_id;
  end if;

  perform public.refresh_demo_slots();
end $$;
