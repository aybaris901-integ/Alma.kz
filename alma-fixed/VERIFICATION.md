# Verification report — what was checked, three times over

Every claim below was **executed**, not just read. Tooling copies live in
`verification-tools/`; screenshots in `verification-screenshots/`.

## Pass 1 — the SQL, executed on a real Postgres engine

The three SQL files were applied to Postgres 16 (PGlite engine) inside a
Supabase-like environment (anon/authenticated roles, `auth.uid()` reading
JWT claims, Supabase-style grants), then **applied twice more** to prove the
README's re-run safety claim (the old README's claim was false — this one
was tested).

`node verification-tools/test-backend.mjs` → **31/31 assertions passed**:

- idempotency: 0001 + 0002 + seed applied 3× with no errors
- RLS: anon reads catalog but zero orders; direct INSERT into orders → 42501
- guest A vs guest B isolation on `orders` AND on the
  `orders_with_items` view (security_invoker working)
- `create_order`: returns jsonb in the exact `Order` shape with `items`;
  ALSO mirrors the line items into the denormalized `orders.items` jsonb
  column in the dashboard's format (`menuItemId`/`title`/`price`/`quantity`);
  server-side pricing (client cannot influence the total — tamper-tested);
  `qr_token` set; order number matches `YYMMDD-XXXXXX`; slot load incremented
- error codes are distinct SQLSTATEs: SLTRQ, EMPT1, SLTWT, SLTPT, QTYIN
  (for quantity 2.5 — no raw cast error), ITMUN, SLTLT, SLTFU
- lifecycle: same guest re-booking a slot → SLTLT; full slot → SLTFU;
  cancel releases capacity; stale unpaid orders → Expired and release
  capacity; `refresh_demo_slots` leaves ≥ 3 future slots

## Pass 1.5 — the paste-in live test, run verbatim

`supabase/tests/live_test.sql` (in `backend-and-dropin-frontend/`) was itself
executed verbatim on the same engine: **23/23 checks pass** and the suite
leaves zero footprint after its rollback. Run this same file in your
Supabase SQL editor to prove RLS/pricing/lifecycle on your live project.
(The results grid prints before the final ROLLBACK — that is intentional.)
The suite includes two dashboard-contract checks: `orders.items` is filled
in the dashboard format (`menuItemId`), and the `orders_with_items` view
still returns the frontend shape (`items[].id`).

## Pass 2 — static compliance re-read of every file

- RPC parameter names match on both sides (`p_restaurant_id`, `p_slot_id`,
  `p_items`, `p_order_id`) in both frontends
- the jsonb `Order` keys match `types/shared.ts` / `src/types/shared.ts`
- the error-code maps in both frontends cover exactly the 12 SQLSTATEs the
  SQL raises — 1:1, nothing missing, nothing extra
- no secret keys anywhere (the only key in the tree is the public
  `sb_publishable_` value in the Vite app's `.env.local`); placeholder
  values exist only in `.env.local.example` files
- both `.env.local.example` files match the env-var names their
  `supabaseClient.ts` actually reads

## Pass 3 — both frontends, type-checked, built, and driven in a browser

- `tsc` strict type-check: clean for both frontends
- `vite build` production build: clean for both
- Playwright (real Chromium) against the real backend SQL via a local
  bridge (Supabase auth/PostgREST emulation in `verification-tools/e2e/`):

  Frontend app (frontend-app): home shows DB restaurants → menu from DB →
  add to cart → live DB pickup slots → payment → **real order
  `260919-D914E3` created by `create_order`** → order status page shows the
  real state → **cancel works and flips status to Cancelled**.

  Drop-in frontend (backend-and-dropin-frontend): DB restaurants + menu →
  quantity → slot → **real order `260919-316922`** → slot list refetched
  after the order. Restaurant re-select race (the old blank-screen crash)
  produces **zero uncaught page errors**.

  **E2E result: 18/18.** Screenshots: `verification-screenshots/`.

## To re-run the verification yourself

- `node verification-tools/test-backend.mjs` — needs `@electric-sql/pglite`
  installed next to it (npm i @electric-sql/pglite); it reads the SQL files
  from `backend-and-dropin-frontend/supabase/`
- `supabase/tests/live_test.sql` — paste into your Supabase SQL editor
- `verification-tools/e2e/run-e2e.mjs` — needs `playwright` with Chromium;
  starts the bridge + both dev servers automatically
