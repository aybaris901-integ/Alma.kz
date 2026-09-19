/**
 * Demo-data seeder for the Alma Partner dashboard.
 *
 *   npx tsx scripts/seed.ts            # write to Supabase
 *   npx tsx scripts/seed.ts --dry-run  # print the plan, write nothing
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (server-only — never NEXT_PUBLIC_) plus the
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_ALMA_RESTAURANT_ID the app already
 * uses. Reads them from the shell, then .env.local, then .env.
 *
 * What it does, per run:
 *   menu_items   — inserts any of the 10 demo dishes not already present (by title)
 *   pickup_slots — 8 slots from *now* (+2, +10, +20 … min); reuses a slot whose
 *                  slot_time already exists for the restaurant
 *   orders       — 8 fresh orders (ALMA-### continues from the current max) with
 *                  a status mix: 3 Created, 2 Preparing, 1 Ready, 1 PickedUp,
 *                  1 Cancelled (skipped if the DB rejects that status)
 *
 * Menu and slots are idempotent; orders are appended on every run.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const DRY_RUN = process.argv.includes("--dry-run");
const RESTAURANT_ID = process.env.NEXT_PUBLIC_ALMA_RESTAURANT_ID ?? "6218c103-8141-40aa-ab9f-e3cdaa1f58c5";
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

class SeedError extends Error {}

/** Abort with a clean one-line message (no stack). Exit code is set in the catch below. */
function fail(message: string): never {
  throw new SeedError(message);
}

function resolveApiKey(): string {
  if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (SERVICE_KEY.startsWith("sb_publishable_")) {
    fail("SUPABASE_SERVICE_ROLE_KEY is a publishable key; the seeder needs the secret / service_role key to bypass RLS.");
  }
  // A dry-run only reads, so it can preview the plan with the publishable key.
  const apiKey = SERVICE_KEY || (DRY_RUN ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" : "");
  if (!apiKey) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (NOT as NEXT_PUBLIC_*) — " +
        "Supabase → Project Settings → API Keys → secret / service_role.",
    );
  }
  if (DRY_RUN && !SERVICE_KEY) console.log("[dry-run] no SUPABASE_SERVICE_ROLE_KEY — previewing with the publishable key");
  return apiKey;
}

// ---------------------------------------------------------------------------
// Demo catalogue
// ---------------------------------------------------------------------------

type MenuSeed = { title: string; description: string; price: number; category: string };

const MENU: MenuSeed[] = [
  // The first two already exist in the backend seed; listed here so the
  // catalogue is complete and the script stays idempotent by title.
  { title: "Лагман домашний", description: "Свежая лапша с мясом и овощами", price: 2500, category: "Основные блюда" },
  { title: "Плов Ташкентский", description: "Ароматный плов с бараниной", price: 2200, category: "Основные блюда" },
  { title: "Бешбармак", description: "Конина и тесто, с луковым соусом", price: 3200, category: "Основные блюда" },
  { title: "Манты (6 шт)", description: "С говядиной и тыквой", price: 2100, category: "Основные блюда" },
  { title: "Куырдак", description: "Жареное мясо с картофелем и луком", price: 2800, category: "Основные блюда" },
  { title: "Шубат 0.5 л", description: "Кисломолочный верблюжий напиток", price: 900, category: "Напитки" },
  { title: "Чай с молоком", description: "Казахский чай, 400 мл", price: 500, category: "Напитки" },
  { title: "Компот из кураги", description: "Домашний, 400 мл", price: 600, category: "Напитки" },
  { title: "Баурсаки (8 шт)", description: "Тёплые, к чаю", price: 800, category: "Десерты" },
  { title: "Чак-чак", description: "С мёдом, порция 150 г", price: 1100, category: "Десерты" },
];

/** Minutes from now for each slot: the first one is inside the 5-minute urgency window. */
const SLOT_OFFSETS_MIN = [2, 10, 20, 30, 40, 55, 70, 85];

/** Order plan. `slot` indexes SLOT_OFFSETS_MIN. */
type OrderPlan = { status: string; slot: number; guest: string; urgentDemo?: boolean };

const ORDERS: OrderPlan[] = [
  { status: "Preparing", slot: 0, guest: "guest_demo_aigerim", urgentDemo: true }, // due in 2 min, not Ready → red row
  { status: "Created", slot: 1, guest: "guest_demo_daniyar" },
  { status: "Created", slot: 2, guest: "guest_demo_madina" },
  { status: "Preparing", slot: 2, guest: "guest_demo_arman" },
  { status: "Ready", slot: 1, guest: "guest_demo_saule" },
  { status: "PickedUp", slot: 0, guest: "guest_demo_bekzat" },
  { status: "Created", slot: 4, guest: "guest_demo_dana" },
  { status: "Cancelled", slot: 3, guest: "guest_demo_nurlan" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Deterministic-enough picker so re-runs still look varied. */
function pickItems<T>(pool: T[], count: number, seed: number): T[] {
  const out: T[] = [];
  const used = new Set<number>();
  let x = seed * 2654435761 + 97;
  while (out.length < count && used.size < pool.length) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const i = (x >>> 16) % pool.length; // high bits — the low bits of an LCG cycle badly
    if (used.has(i)) continue;
    used.add(i);
    out.push(pool[i]);
  }
  return out;
}

function nextOrderNumberFrom(existing: string[]) {
  let max = 0;
  for (const n of existing) {
    const m = /^ALMA-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createClient(SUPABASE_URL, resolveApiKey(), { auth: { persistSession: false } });
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Seeding restaurant ${RESTAURANT_ID} at ${SUPABASE_URL}`);

  // Sanity: the restaurant must exist, otherwise every FK below fails.
  const { data: restaurant, error: rErr } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("id", RESTAURANT_ID)
    .maybeSingle();
  if (rErr) fail(`restaurants lookup failed: ${rErr.message}`);
  if (!restaurant) {
    if (DRY_RUN && !SERVICE_KEY) {
      // RLS hides `restaurants` from the publishable key; the service key will see it.
      console.log("Restaurant: (not visible with the publishable key — checked for real when run with the service key)");
    } else {
      fail(`restaurant ${RESTAURANT_ID} does not exist — create it first.`);
    }
  } else {
    console.log(`Restaurant: ${restaurant.name}`);
  }

  // ---- menu_items -----------------------------------------------------------
  const { data: existingMenu, error: mErr } = await supabase
    .from("menu_items")
    .select("id, title, price")
    .eq("restaurant_id", RESTAURANT_ID);
  if (mErr) fail(`menu_items read failed: ${mErr.message}`);

  const menuByTitle = new Map((existingMenu ?? []).map((m) => [m.title as string, m]));
  const missingMenu = MENU.filter((m) => !menuByTitle.has(m.title));
  let menuCreated = 0;
  if (missingMenu.length) {
    console.log(`menu_items: inserting ${missingMenu.length} (${missingMenu.map((m) => m.title).join(", ")})`);
    if (!DRY_RUN) {
      const { data, error } = await supabase
        .from("menu_items")
        .insert(missingMenu.map((m) => ({ ...m, restaurant_id: RESTAURANT_ID, is_available: true })))
        .select("id, title, price");
      if (error) fail(`menu_items insert failed: ${error.message}`);
      for (const row of data ?? []) menuByTitle.set(row.title, row);
      menuCreated = data?.length ?? 0;
    } else {
      // Fake ids so the dry-run can still plan orders.
      for (const m of missingMenu) menuByTitle.set(m.title, { id: `dry-${m.title}`, title: m.title, price: m.price });
      menuCreated = missingMenu.length;
    }
  } else {
    console.log("menu_items: all 10 demo dishes already present");
  }
  const menuPool = MENU.map((m) => menuByTitle.get(m.title)!);

  // ---- pickup_slots ---------------------------------------------------------
  const { data: existingSlots, error: sErr } = await supabase
    .from("pickup_slots")
    .select("id, slot_time")
    .eq("restaurant_id", RESTAURANT_ID);
  if (sErr) fail(`pickup_slots read failed: ${sErr.message}`);

  // Match whatever slot_time format the table already uses: plain "HH:MM"
  // (what the backend seed wrote) or a "HH:MM - HH:MM" range.
  const usesRange = (existingSlots ?? []).some((s) => String(s.slot_time).includes(" - "));
  const now = new Date();
  now.setSeconds(0, 0);
  const slotTimes = SLOT_OFFSETS_MIN.map((min) => {
    const start = new Date(now.getTime() + min * 60_000);
    if (!usesRange) return hhmm(start);
    const end = new Date(start.getTime() + 15 * 60_000);
    return `${hhmm(start)} - ${hhmm(end)}`;
  });

  const slotByTime = new Map((existingSlots ?? []).map((s) => [String(s.slot_time), s.id as string]));
  const missingSlots = slotTimes.filter((t) => !slotByTime.has(t));
  let slotsCreated = 0;
  console.log(`pickup_slots: ${slotTimes.join(", ")}${missingSlots.length ? "" : " (all already exist)"}`);
  if (missingSlots.length && !DRY_RUN) {
    const { data, error } = await supabase
      .from("pickup_slots")
      .insert(
        missingSlots.map((slot_time) => ({
          restaurant_id: RESTAURANT_ID,
          slot_time,
          capacity: 10,
          booked_load: 0,
          is_active: true,
        })),
      )
      .select("id, slot_time");
    if (error) fail(`pickup_slots insert failed: ${error.message}`);
    for (const row of data ?? []) slotByTime.set(String(row.slot_time), row.id);
    slotsCreated = data?.length ?? 0;
  } else if (DRY_RUN) {
    for (const t of missingSlots) slotByTime.set(t, `dry-${t}`);
    slotsCreated = missingSlots.length;
  }
  const slotIds = slotTimes.map((t) => slotByTime.get(t)!);

  // ---- orders -----------------------------------------------------------------
  const { data: existingOrders, error: oErr } = await supabase
    .from("orders")
    .select("order_number")
    .eq("restaurant_id", RESTAURANT_ID);
  if (oErr) fail(`orders read failed: ${oErr.message}`);
  let seq = nextOrderNumberFrom((existingOrders ?? []).map((o) => String(o.order_number)));

  let ordersCreated = 0;
  let urgentOrderNumber: string | null = null;
  const skipped: string[] = [];
  const slotLoad = new Map<string, number>();

  for (let i = 0; i < ORDERS.length; i++) {
    const plan = ORDERS[i];
    const items = pickItems(menuPool, 1 + ((i * 7) % 3), i + seq).map((m, j) => ({
      menuItemId: m.id,
      title: m.title,
      price: Number(m.price),
      quantity: 1 + ((i + j) % 2),
    }));
    const total_amount = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const order_number = `ALMA-${String(++seq).padStart(3, "0")}`;
    const row = {
      order_number,
      guest_id: plan.guest,
      restaurant_id: RESTAURANT_ID,
      slot_id: slotIds[plan.slot],
      items,
      total_amount,
      status: plan.status,
      qr_token: `qr_${randomBytes(8).toString("hex")}`,
      payment_status: "Paid",
    };
    const label = `${order_number} ${plan.status.padEnd(9)} slot ${slotTimes[plan.slot].padEnd(13)} ${items.map((it) => `${it.title}×${it.quantity}`).join(", ")} = ${total_amount} ₸`;

    if (DRY_RUN) {
      console.log(`  ${label}`);
      ordersCreated++;
      if (plan.urgentDemo) urgentOrderNumber = order_number;
      continue;
    }

    const { error } = await supabase.from("orders").insert(row);
    if (error) {
      // "Cancelled" may be outside the DB's status check constraint — skip, don't abort.
      console.warn(`  ⚠ skipped ${order_number} (${plan.status}): ${error.message}`);
      skipped.push(`${order_number} (${plan.status})`);
      seq--; // don't burn the number
      continue;
    }
    console.log(`  ${label}`);
    ordersCreated++;
    slotLoad.set(row.slot_id, (slotLoad.get(row.slot_id) ?? 0) + 1);
    if (plan.urgentDemo) urgentOrderNumber = order_number;
  }

  // Keep booked_load honest for the slots we just filled.
  if (!DRY_RUN) {
    for (const [slotId, added] of Array.from(slotLoad)) {
      const { data } = await supabase.from("pickup_slots").select("booked_load").eq("id", slotId).single();
      await supabase
        .from("pickup_slots")
        .update({ booked_load: Number(data?.booked_load ?? 0) + added })
        .eq("id", slotId);
    }
  }

  // ---- summary ----------------------------------------------------------------
  console.log("");
  console.log("Summary" + (DRY_RUN ? " (dry-run — nothing written)" : ""));
  console.log(`  menu_items   created: ${menuCreated}  (total for restaurant: ${menuByTitle.size})`);
  console.log(`  pickup_slots created: ${slotsCreated}  (${slotTimes.length} demo slots, base time ${hhmm(now)})`);
  console.log(`  orders       created: ${ordersCreated}${skipped.length ? `  skipped: ${skipped.join(", ")}` : ""}`);
  if (urgentOrderNumber) {
    console.log(
      `\n  ➜ Rush-hour demo: ${urgentOrderNumber} is Preparing with pickup at ${slotTimes[0]} (${SLOT_OFFSETS_MIN[0]} min from now) — ` +
        `open /partner/orders → «Сейчас» and it should be the red row.`,
    );
  }
}

main().catch((err) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  if (!(err instanceof SeedError) && err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
