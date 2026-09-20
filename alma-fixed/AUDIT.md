# AUDIT — Alma.kz backend & frontends
**Scope:** `alma-fixed.zip` (backend SQL + drop-in frontend A) and `frontend.rar` (Vite + Tailwind frontend B).
**Method:** every file read line-by-line; every claim below executed, not assumed — SQL run on a real Postgres 16 engine (PGlite with Supabase-like roles), both frontends type-checked, built, and driven end-to-end in real Chromium.
**Verdict:** original backend was structurally sound (RLS, server-side pricing, security_invoker view) but **not production-safe**: 5 backend gaps, 4 frontend-A bugs, 4 frontend-B launch blockers. All findings fixed and re-verified (4 passes, all green).

---

## 0. Security — act before anything else

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| S-1 | A `sb_secret_...` (secret-class) key was present in an earlier frontend env upload. If committed or shared, it grants service-level access. | **CRITICAL** | Removed from tree. **You must rotate it** (Dashboard → Project Settings → API) and purge git history (`git filter-repo`/BFG) if it was ever committed. |

No secret keys exist in the delivered tree. The only key present is the public `sb_publishable_...` in the Vite app's `.env.local` (public by design; `.gitignore` excludes `*.local`).

---

## 1. Backend findings (SQL) — all fixed

### B-1 · `create_order()` return shape mismatch — HIGH
Old: returned a bare `orders` row. Both frontends type the RPC result as `Order` **with `items: OrderItem[]`** → runtime shape error on every order.
**Fix:** returns one jsonb object in the exact `Order` shape, `items` included; `drop function if exists` before `create` (Postgres forbids changing a return type via `create or replace` — the old file could never even be re-applied).

### B-2 · No order lifecycle; `qr_token` never set — HIGH
Old: no cancel, no expiry; `qr_token` was never populated → pickup verification impossible; cancelled/abandoned orders held slot capacity forever.
**Fix:** `cancel_order(order_id)` (owner-only, `Created`/`Paid` only, releases capacity); `expire_stale_orders()` flips >30-min `Created`/`Pending` orders to `Expired` and releases capacity, run lazily at the start of every `create_order()` (no pg_cron needed); `qr_token = gen_random_uuid()::text` at creation; `status` check upgraded in place to include `'Expired'`.

### B-3 · Slot validation missing — HIGH
Old: slot optional (capacity-free orders), past slots bookable (seed slots are `now()+1..3h`, so 3h after seeding every slot was expired-but-bookable), no per-guest limit (one guest could book a slot to capacity alone), slot/restaurant ownership unchecked.
**Fix:** slot required (`SLTRQ`); past rejected (`SLTPT`); deactivated rejected (`SLTOF`); foreign-restaurant rejected (`SLTWT`); ≥1 open order per guest per slot enforced under an advisory lock (`SLTLT`); slot load incremented transactionally; full slot rejected (`SLTFU`).

### B-4 · Error handling unusable by UI — MEDIUM
Old: every failure was `P0001` with a message embedding **raw UUIDs**; quantities like `2.5` surfaced a raw Postgres cast error.
**Fix:** 12 distinct SQLSTATEs (`NOSES EMPT1 RSTAV SLTRQ SLTWT SLTOF SLTPT SLTLT SLTFU ITMUN QTYIN ORDCN`), human-readable messages, no UUIDs; `QTYIN` regex pre-check catches non-integer quantities before the cast.

### B-5 · Migrations not re-runnable; seed goes stale — MEDIUM
Old: README claimed "safe to re-run" but bare `create policy` fails on second run; seed slots expire permanently (~3h after seeding the demo has no bookable slots).
**Fix:** `drop policy if exists` before every policy; every function dropped before create; constraint upgrade conditional; seed is idempotent and calls new `refresh_demo_slots()` — re-run `seed.sql` any time and 3 future demo slots come back (function revoked from clients; operator-only).

### B-6 · What was already correct (kept as-is)
Server-side pricing (prices always from `menu_items`, never trusted from client — tamper-tested); RLS on all 5 tables keyed off `auth.uid()`; `orders_with_items` is a `security_invoker` view; direct-table writes revoked from `anon`/`authenticated`.

---

## 2. Frontend A (drop-in) findings — all fixed

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| F-1 | Blank-screen crash: switching restaurants kept the old menu rendered during load; a quantity tap built a cart key that `menuItems.find(...)!` could not resolve once the new menu landed → uncaught crash. | HIGH | Hook resets data on dependency change + explicit `refresh()`; cart builder skips ids absent from the current menu. Regression-tested in E2E: zero uncaught page errors. |
| F-2 | Stale slot counts: no refetch after ordering; past slots shown as bookable. | MEDIUM | Slots refetched after every order attempt (success or failure); past slots also filtered client-side. |
| F-3 | Lost error messages: only `Error.message` surfaced; supabase-js error shapes fell through to generic text. | MEDIUM | `getErrorMessage()` maps all 12 SQLSTATEs and handles every supabase-js error shape. |
| F-4 | No input validation: quantity accepted `2.5`; order allowed with no slot. | MEDIUM | Whole-number-only quantity inputs; order button disabled until a slot is chosen (backend re-validates both). |
| F-5 | Not runnable: the zip was only drop-in files — no `package.json`, `vite.config.ts`, `index.html`, `main.tsx`, `tsconfig.json`, `.gitignore`. | HIGH | All scaffolding added; `tsc` clean, `vite build` clean. |

## 3. Frontend B (Vite + Tailwind) findings — all fixed

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| G-1 | **Zero backend integration**: no `@supabase/supabase-js`; every page hardcoded mock data; "payment" always succeeded with fake order `ALMA-105`. | CRITICAL | Added supabase-js + `supabaseClient.ts`; new `src/lib/api.ts` (snake→camel mapping, anonymous guest sessions, `create_order`/`cancel_order` RPCs, Russian error texts keyed off SQLSTATEs); all 5 pages wired to real data (restaurants, menu + dynamic tabs, live slots, real order creation, real status + working cancel). |
| G-2 | Launch-blocking import case bug: `main.tsx` imported `./context/cartContext` but the file is `CartContext.tsx` — breaks on every case-sensitive FS (Linux CI, Docker). | HIGH | Import corrected. |
| G-3 | `types/shared.ts` mismatch: no `Expired` status, no `paymentStatus`, non-nullable slot/QR where the API returns null. | MEDIUM | Contract file aligned with backend. |
| G-4 | Duplicated `CartProvider` (in both `main.tsx` and `App.tsx`) → two independent cart states. | MEDIUM | Duplicate removed. |

---

## 4. Verification — 4 passes, all green

1. **SQL executed on Postgres 16** (PGlite, Supabase-like roles + `auth.uid()`): `node verification-tools/test-backend.mjs` → **30/30**. Idempotency (all 3 SQL files ×3 runs), RLS isolation between guests on table **and** view, direct-insert blocking (`42501`), server-side pricing + price-tamper rejection, full/past/foreign/duplicate-slot flows, cancel releases capacity, stale orders expire and release capacity, `refresh_demo_slots` keeps ≥3 future slots.
2. **Paste-in live test run verbatim**: `backend-and-dropin-frontend/supabase/tests/live_test.sql` → **21/21**, zero footprint after rollback. Run this same file in your Supabase SQL editor to prove RLS/pricing/lifecycle on your **live** project.
3. **Static compliance re-read of every file**: RPC parameter names match on both sides; jsonb `Order` keys match `types/shared.ts`; error-code maps in both frontends cover exactly the 12 SQLSTATEs (1:1); no secrets in tree; `.env.local.example` names match what `supabaseClient.ts` reads.
4. **Runtime + packaged audit**: `tsc` strict clean and `vite build` clean for both frontends; Playwright/Chromium E2E against the same backend SQL → **18/18** (real orders `260919-D914E3`, `260919-316922`, cancel flow, restaurant-switch crash regression, zero page errors); final sweep of the packaged ZIP confirmed every fix marker present, no `node_modules`/`dist` leaks.

## 5. Deployment runbook

1. Rotate the leaked `sb_secret_` key (§0).
2. Supabase SQL editor, in order: `supabase/migrations/0001_schema.sql` → `supabase/migrations/0002_rls.sql` → `supabase/seed.sql`. All three re-runnable.
3. Dashboard → Authentication → Providers → enable **Anonymous sign-ins** (the #1 cause of "every order fails" — RLS keys orders off `auth.uid()`).
4. Copy `.env.local.example` → `.env.local` in your frontend; set `VITE_SUPABASE_URL` (bare project URL, no `/rest/v1/`) + the publishable/anon key.
5. `npm install && npm run dev`.
6. Optional proof on live: paste `supabase/tests/live_test.sql` into the SQL editor (23 checks, rolls back).

## Addendum — dashboard compatibility (`orders.items`)

Requested after the initial delivery: the operations dashboard reads line
items from the `orders.items` jsonb column (`{menuItemId, title, price,
quantity}`), while `create_order()` wrote them only to `order_items`.

**Fixed in `0001_schema.sql`:**
- `orders` gained an `items jsonb` column; `create_order()` mirrors every
  line into it in the dashboard's exact format (same transaction as the
  `order_items` insert — atomic; `order_items` stays the source of truth).
- Existing installs get the column via idempotent
  `alter table ... add column if not exists`, plus a one-time backfill of
  historical orders from `order_items` (only touches rows where `items is null`).
- Trap handled: the `orders_with_items` view used `select o.*, ... as items`;
  with the new base column that recreates as a duplicate-column error. The
  view now uses an explicit column list and STILL returns the frontend
  shape (`items[].id`), verified by a dedicated check.
- Re-verified: backend suite 31/31, paste-in suite 23/23 (both include new
  dashboard-contract assertions), zero footprint, idempotent re-runs.

## 6. Error codes (SQLSTATE → meaning)

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
