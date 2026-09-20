# Alma.kz — backend + both frontends, fixed and verified

This pass fixes the backend against the audit findings, fixes the drop-in
frontend, and wires the second (Vite + Tailwind) frontend — which previously
had **no Supabase integration at all** — to the same backend. Everything here
was executed and tested on a real Postgres 16 engine (not just read by eye),
and both frontends were driven end-to-end in a real browser against that
engine. See "What was verified" at the bottom.

## Security first — do this before anything else

An earlier upload of this project contained a key whose value started with
`sb_secret_...` (secret-class, not publishable) in a frontend env file. If
that key was ever committed or shared:

1. **Rotate/revoke it now** — Supabase Dashboard → Project Settings → API.
2. Purge it from git history if it was ever committed
   (`git filter-repo` or BFG, then force-push).

No secret keys exist anywhere in this tree. The only key present is the
`sb_publishable_...` value in the Vite app's `.env.local` — that is the
public key by design, and `.gitignore` already excludes `*.local` files.

## Run order (the backend is the SQL; deploying it = running it)

1. **Rotate the leaked key** (above).
2. Supabase SQL editor, in this order:
   `supabase/migrations/0001_schema.sql` → `supabase/migrations/0002_rls.sql`
   → `supabase/seed.sql`.
   **All three files are safe to re-run** — verified by executing each file
   three times in a row on a live Postgres. (The old README claimed this but
   it was false: bare `create policy` fails the second time, and changing
   `create_order`'s return type with `create or replace` is illegal in
   Postgres. Both are handled now: `drop policy if exists` before every
   policy, `drop function if exists` before every function, and the
   `orders_status_check` constraint is upgraded only when it is actually
   missing 'Expired'.)
3. Supabase Dashboard → Authentication → Providers → enable **Anonymous
   sign-ins**. Not enabling this is the #1 cause of "every order fails":
   both frontends call `signInAnonymously()` before the first order, and
   RLS keys order access off `auth.uid()`.
4. Frontend env files (see each project's `.env.local.example`):
   - drop-in frontend: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
   - Vite app: `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`
     (classic `VITE_SUPABASE_ANON_KEY` also accepted)
   URL is the bare project URL — no `/rest/v1/` suffix.
5. `npm install`, then `npm run dev` in whichever frontend you're using.

## Backend: what was wrong and what changed

### `supabase/migrations/0001_schema.sql`
- **`create_order()` now returns the exact frontend `Order` shape.** The old
  version returned a bare `orders` row with no `items`, while both frontends
  type the result as `Order` with `items: OrderItem[]`. It now returns one
  jsonb object with `items` included, so the RPC result can be used as an
  `Order` directly.
- **`orders.items` denormalized mirror (dashboard compatibility).** Line
  items are now written twice: relationally into `order_items` (the source
  of truth) AND as one jsonb array on the order row itself, in the
  operations dashboard's format:
  `[{ "menuItemId": "...", "title": "...", "price": 12.00, "quantity": 2 }]`.
  The migration also adds the column to existing installs
  (`alter table ... add column if not exists`) and backfills historical
  orders from `order_items`, so the dashboard shows item details for old
  rows too. The `orders_with_items` view keeps exposing the FRONTEND shape
  (`items[].id` per `OrderItem` in `types/shared.ts`) — its column list is
  now explicit so it cannot collide with the new base-table column.
- **`qr_token` is set at creation** (`gen_random_uuid()::text`). It was never
  populated before, so pickup verification was impossible.
- **A pickup slot is now required** (`SLTRQ`) — the old function accepted
  `null` and silently booked capacity-free orders.
- **Past slots are rejected** (`SLTPT`). Seed slots are `now()+1..3h`, so
  three hours after seeding every slot was expired-but-bookable.
- **Per-guest fairness** (`SLTLT`): one guest could previously book a slot to
  capacity alone. Now an advisory lock serializes same-guest attempts and at
  most one open order per guest per slot is allowed.
- **Order lifecycle:**
  - `expire_stale_orders()` — orders stuck at `Created`/`Pending` for over
    30 minutes become `Expired` and release their slot capacity. It runs
    lazily at the start of every `create_order()`, so no pg_cron needed.
  - `cancel_order(order_id)` — a guest cancels their own `Created`/`Paid`
    order; capacity is released immediately; other guests' orders are
    untouchable.
  - `status` check now includes `'Expired'` (constraint upgraded in place on
    pre-existing installs).
- **Distinct, stable error codes** — every failure raises its own SQLSTATE
  (`EMPT1`, `SLTRQ`, `SLTPT`, `SLTFU`, `SLTLT`, `ITMUN`, `QTYIN`, ...) with
  a human-readable message and **no raw UUIDs**, so the UI can tell "slot
  full" from "item unavailable". Quantities like `2.5` raise the friendly
  `QTYIN` instead of a raw cast error.
- Slot ownership, item availability and restaurant active-state are checked
  server-side; prices are always looked up from `menu_items`, never trusted
  from the client (verified by a tamper test).

### `supabase/migrations/0002_rls.sql`
- `drop policy if exists` before every policy → re-runnable.
- Explicit `revoke` of all writes on all five tables for `anon`/
  `authenticated` (defense in depth on top of RLS; orders/order_items were
  already revoked for insert, now update/delete too).
- `grant execute` on `create_order` and `cancel_order`.

### `supabase/seed.sql`
- Still idempotent (restaurant created once, menu untouched on re-run).
- **New: `refresh_demo_slots()`** — deletes past empty demo slots,
  deactivates past booked ones, and recreates 3 future slots when none are
  left. The seed calls it, so **if your demo is older than ~3 hours, run
  `seed.sql` again and the pickup times come back.** It is revoked from
  `anon`/`authenticated`: an operator tool, not a client API.

## Frontend A — the drop-in example (`src/`, `types/`)

Four reproduced bugs fixed:
1. **Blank-screen crash** — switching restaurants kept the old menu rendered
   while the new one loaded; a quantity tap produced a cart key that
   `menuItems.find(...)!` could not resolve once the fetch landed. The hook
   now resets data on dependency change and the cart builder skips ids that
   are not in the current menu.
2. **Stale slot counts** — slots are refetched after every order attempt
   (success or failure) and past slots are filtered out client-side too.
3. **Lost error messages** — `getErrorMessage()` maps the backend's SQLSTATE
   codes to readable text and handles every supabase-js error shape.
4. **Bad input** — quantity inputs produce whole numbers only; the order
   button is disabled until a slot is chosen (backend enforces both again).

It is also a **runnable app now** — `package.json`, `vite.config.ts`,
`index.html`, `src/main.tsx`, `tsconfig.json` and `.gitignore` were added
(the original zip was only drop-in files).

## Frontend B — the Vite + Tailwind app (`frontend/`)

This one could not talk to the backend at all: no Supabase client in the
dependencies, and every page rendered hardcoded mock data (a fake payment
always succeeded with order number "ALMA-105"). Fixed by:
- **Added the missing `src/types/shared.ts` contract fields** (this file
  existed but didn't match the backend: no `Expired` status, no
  `paymentStatus`, non-nullable slot/QR that the API can return null).
- **Fixed the launch-blocking import case bug** — `main.tsx` imported
  `./context/cartContext` while the file is `CartContext.tsx`; that breaks
  every case-sensitive filesystem (Linux CI, Docker).
- **Removed a duplicated `CartProvider`** (one in `main.tsx`, another in
  `App.tsx` — two independent cart states).
- **Added `@supabase/supabase-js`** and `src/lib/supabaseClient.ts`.
- **New `src/lib/api.ts`** — the whole API layer: snake_case → camelCase
  mapping, anonymous guest sessions, `create_order`/`cancel_order` RPCs,
  Russian error messages keyed off the backend's SQLSTATE codes.
- **All five pages wired to real data:** HomePage (restaurants table),
  MenuPage (menu_items, dynamic category tabs), CartPage (live pickup
  slots for the cart's restaurant), PaymentPage (real order creation, real
  order number), OrderStatusPage (real order fetch, live status, working
  cancel — which releases the slot, matching the backend lifecycle).

## Error codes (SQLSTATE → meaning)

| Code  | Meaning |
|-------|---------|
| NOSES | No guest session — enable Anonymous sign-ins |
| EMPT1 | Cart is empty |
| RSTAV | Restaurant inactive or unknown |
| SLTRQ | No pickup slot chosen |
| SLTWT | Slot belongs to another restaurant / does not exist |
| SLTOF | Slot deactivated |
| SLTPT | Slot is in the past |
| SLTLT | Guest already has an open order on this slot |
| SLTFU | Slot fully booked |
| ITMUN | Item unavailable / not at this restaurant |
| QTYIN | Quantity not an integer 1..99 |
| ORDCN | Order not cancellable (wrong owner or too late) |

## What was verified (three passes, all green)

1. **SQL executed on real Postgres 16** (PGlite engine, Supabase-like roles
   + `auth.uid()`): migrations + seed applied, then re-applied twice with no
   errors; 30 behavioural assertions passed — RLS isolation between guests
   (table and view), server-side pricing, price-tamper rejection, slot
   full/past/foreign/cancel/expiry flows, per-guest limit, direct-insert
   blocking, view row-shape.
2. **Static compliance re-check of every file**: RPC parameter names match
   on both sides, the jsonb `Order` keys match `types/shared.ts`, the error
   code map in each frontend covers exactly the codes the SQL raises, no
   secrets in the tree, README claims match behaviour.
3. **Both frontends type-checked (`tsc`), production-built (`vite build`),
   and driven in a real Chromium browser** against the same Postgres-backed
   Supabase emulation: browse → add to cart → pick slot → pay → real order
   number → status page, plus the restaurant-switch crash regression.

To prove the same on your **live** Supabase project, run
`supabase/tests/live_test.sql` in the SQL editor (after 0001 → 0002 → seed).
It runs inside a transaction and rolls back, leaving zero footprint.
