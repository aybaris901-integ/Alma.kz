# How this backend works

No server. No API routes. The frontend talks to Supabase directly.

```
 ┌─────────────┐        reads/writes         ┌──────────────────┐
 │   Vite       │ ───────────────────────────▶│    Supabase       │
 │  frontend    │   (via anon key + RLS)       │  (Postgres + Auth)│
 └─────────────┘                              └──────────────────┘
```

That's the whole system. There is no Node/Express/Next server sitting in
the middle — Supabase *is* the backend. "The backend" = the SQL files in
`supabase/migrations/` plus the tables/policies they create once you run
them in your Supabase project.

## Why no server?

Two reasons this project doesn't need one:
1. Supabase's anon key is designed to be public. It's not a secret — it's
   meant to sit in frontend JS. Access control isn't "hide the key," it's
   Row Level Security (RLS) rules living in the database itself.
2. A server here would only ever do `select * from restaurants` and pass
   it through — i.e. it'd just be a slower way to call Supabase, with one
   more thing to deploy and one more thing to break.

If a real requirement shows up that a server is actually needed for
(e.g. calling a payment provider's secret API key, sending emails, doing
work the client can't be trusted to do honestly), that's when you add one
— not before.

## The three moving pieces

**1. Database (`supabase/migrations/*.sql`)**
Tables: `restaurants`, `menu_items`, `pickup_slots`, `orders`, `order_items`.
Run these once, in order, in the Supabase SQL editor. This is "deploying
the backend" — there's no `npm run deploy` because there's no server
process to deploy.

**2. Access rules (also in `0002_rls.sql`)**
Every table has RLS turned on. Public catalog data (restaurants, menu,
slots) is readable by anyone. Orders are only readable by the guest who
placed them (matched by an anonymous auth session, not a password). This
is the part that replaces "the backend checks permissions" — the database
checks them instead.

**3. Frontend code (`src/lib/api.ts`)**
Every function in here is a thin wrapper around one Supabase call. This
file is the entire "API layer." If someone on the team is looking for
"where do I add an endpoint" — you don't; you add a function to this file
that calls `supabase.from(...)` or `supabase.rpc(...)`, and the RLS
policies decide whether it's allowed.

## If someone says "it doesn't work"

Check, in order:
1. Did the migrations actually get run in Supabase? (Table Editor should
   show 5 tables with data in `restaurants`/`menu_items`/`pickup_slots`
   after `seed.sql`.)
2. Is `.env.local` filled in with the real project URL (no `/rest/v1/`)
   and the **anon** key (not service_role)?
3. Is Anonymous sign-in turned on in Supabase Auth settings? (Required for
   placing orders — order RLS is keyed off it.)
4. What's the actual error in the browser console / network tab? "Doesn't
   work" almost always has a specific Postgres or Supabase error message
   behind it — that message is what to paste to get a real fix.
