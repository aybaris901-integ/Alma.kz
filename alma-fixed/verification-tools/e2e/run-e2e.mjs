// Verification Pass 3 — real browser E2E of BOTH frontends against the
// real backend SQL (PGlite bridge emulating Supabase auth/PostgREST).
// Screenshots land in /home/z/my-project/work/screenshots/.
import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';

const SHOTS = '/home/z/my-project/work/screenshots';
mkdirSync(SHOTS, { recursive: true });

// Copy the bridge-backed mock INTO each frontend (in-root so vite dev can
// serve it); removed again at the end.
const MOCK_SRC = '/home/z/my-project/scripts/e2e/mockSupabase.ts';
const MOCK_B = '/home/z/my-project/work/frontend/frontend/src/lib/supabaseClient.e2e.ts';
const MOCK_A = '/home/z/my-project/work/alma-backend/alma-fixed/src/lib/supabaseClient.e2e.ts';
copyFileSync(MOCK_SRC, MOCK_B);
copyFileSync(MOCK_SRC, MOCK_A);
process.on('exit', () => { try { rmSync(MOCK_B); rmSync(MOCK_A); } catch {} });

let pass = 0, fail = 0;
const failures = [];
const pageErrors = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name} ${extra}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.status < 500) return true; } catch {}
    await sleep(500);
  }
  return false;
}

function start(cmd, args, cwd, name) {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; process.stdout.write(`[${name}] ${d}`); });
  p.stderr.on('data', (d) => { buf += d; process.stderr.write(`[${name}!] ${d}`); });
  p._buf = () => buf;
  return p;
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// SQL BRIDGE (PGlite behind HTTP) on :8911 — started FIRST
// ---------------------------------------------------------------------------
console.log('\n===== SQL BRIDGE =====');
const bridge = start('node', ['/home/z/my-project/scripts/e2e/bridge.mjs'], '/home/z/my-project/work/pglite-env', 'bridge');
ok('bridge up', await waitHttp('http://localhost:8911/sql'));

// ---------------------------------------------------------------------------
// FRONTEND B (Vite + Tailwind app) on :8912
// ---------------------------------------------------------------------------
console.log('\n===== FRONTEND B: full guest flow =====');
{
  const viteB = start('node', ['node_modules/vite/bin/vite.js', '--config', 'vite.config.e2e.ts', '--port', '8912', '--strictPort'],
    '/home/z/my-project/work/frontend/frontend', 'viteB');
  ok('frontend B dev server up', await waitHttp('http://localhost:8912/'));

  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  page.on('pageerror', (e) => pageErrors.push(`B: ${e.message}`));

  try {
    await page.goto('http://localhost:8912/', { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Alma Kitchen', { timeout: 20000 });
    ok('HomePage shows restaurants from the DATABASE (Alma Kitchen)', true);
    await page.screenshot({ path: `${SHOTS}/B1-home.png`, fullPage: true });

    await page.click('text=Alma Kitchen');
    await page.waitForSelector('text=Beshbarmak', { timeout: 20000 });
    ok('MenuPage shows menu_items from the DATABASE (Beshbarmak)', true);
    ok('category tabs derived from DB categories', await page.isVisible('text=Основные блюда'));
    await page.screenshot({ path: `${SHOTS}/B2-menu.png`, fullPage: true });

    await page.click('[aria-label="Добавить Beshbarmak"]');
    await page.waitForSelector('text=Перейти в корзину', { timeout: 10000 });
    ok('cart sticky bar appears after adding an item', true);

    await page.click('text=Перейти в корзину');
    await page.waitForSelector('text=Время получения', { timeout: 10000 });
    await page.waitForSelector('text=мест:', { timeout: 20000 });
    ok('CartPage shows LIVE pickup slots from the DATABASE', true);
    await page.screenshot({ path: `${SHOTS}/B3-cart.png`, fullPage: true });

    await page.click('button:has-text("мест:")');
    await page.click('text=Перейти к оплате');
    await page.waitForSelector('text=Способ оплаты', { timeout: 10000 });
    ok('PaymentPage reached with a chosen slot', true);
    await page.screenshot({ path: `${SHOTS}/B4-payment.png`, fullPage: true });

    // Pick cash explicitly, then submit via the UNIQUE CTA text
    await page.click('text=Оплата на месте');
    await page.click('button:has-text("Подтвердить заказ")');
    await page.waitForSelector('text=Заказ оформлен', { timeout: 30000 });
    const body = await page.textContent('body');
    const m = body.match(/\d{6}-[A-Z0-9]{6}/);
    ok(`REAL order created via create_order RPC — number ${m?.[0]}`, Boolean(m), body.slice(0, 200));
    await page.screenshot({ path: `${SHOTS}/B5-order-placed.png`, fullPage: true });

    await page.click('text=Перейти к заказу');
    await page.waitForSelector('text=Статус заказа', { timeout: 20000 });
    await page.waitForSelector('text=Заказ создан', { timeout: 20000 });
    ok('OrderStatusPage fetches the real order (status Created)', true);

    await page.click('text=Отменить заказ');
    await page.waitForSelector('text=Заказ отменён', { timeout: 20000 });
    ok('cancel_order RPC works end-to-end and status flips to Cancelled', true);
    await page.screenshot({ path: `${SHOTS}/B6-cancelled.png`, fullPage: true });
  } catch (e) {
    ok('frontend B flow completed', false, String(e).slice(0, 200));
    await page.screenshot({ path: `${SHOTS}/B-FAIL.png`, fullPage: true }).catch(() => {});
  }
  await page.close();
  viteB.kill('SIGTERM');
}

// ---------------------------------------------------------------------------
// FRONTEND A (drop-in OrderPage) on :8913
// ---------------------------------------------------------------------------
console.log('\n===== FRONTEND A: full guest flow =====');
{
  const viteA = start('node', ['node_modules/vite/bin/vite.js', '--config', 'vite.config.e2e.ts', '--port', '8913', '--strictPort'],
    '/home/z/my-project/work/alma-backend/alma-fixed', 'viteA');
  ok('frontend A dev server up', await waitHttp('http://localhost:8913/'));

  const page = await browser.newPage({ viewport: { width: 700, height: 1200 } });
  page.on('pageerror', (e) => pageErrors.push(`A: ${e.message}`));

  try {
    await page.goto('http://localhost:8913/', { waitUntil: 'networkidle' });
    await page.selectOption('select', { label: 'Alma Kitchen' });
    await page.waitForSelector('text=Beshbarmak', { timeout: 20000 });
    ok('OrderPage loads restaurants + menu from the DATABASE', true);

    // Restaurant-switch race regression: re-selecting re-runs the change
    // handler (clears cart/slot, resets data) — the UI must never crash.
    await page.selectOption('select', { label: 'Alma Kitchen' });
    await page.waitForSelector('text=Beshbarmak', { timeout: 20000 });
    await sleep(150);
    ok('restaurant re-select produces no page error (crash regression)', pageErrors.length === 0, pageErrors.join(' | '));
    await page.screenshot({ path: `${SHOTS}/A1-menu.png`, fullPage: true });

    await page.fill('input[type=number] >> nth=0', '2');
    await page.waitForSelector('input[type=radio]');
    await page.check('input[type=radio] >> nth=0');
    ok('slot radio selectable', true);

    await page.click('button:has-text("Place order")');
    await page.waitForSelector('text=Order placed!', { timeout: 30000 });
    const body = await page.textContent('body');
    const m = body.match(/Order placed! Number: (\d{6}-[A-Z0-9]{6})/);
    ok(`REAL order placed — number ${m?.[1]}`, Boolean(m));
    await page.screenshot({ path: `${SHOTS}/A2-order-placed.png`, fullPage: true });

    // Slot counts must refresh after the order (refetch after placeOrder)
    const spotsText = await page.textContent('body');
    ok('slot list still rendered after refetch (no stale crash)', spotsText.includes('spots left'), '');
  } catch (e) {
    ok('frontend A flow completed', false, String(e).slice(0, 200));
    await page.screenshot({ path: `${SHOTS}/A-FAIL.png`, fullPage: true }).catch(() => {});
  }
  await page.close();
  viteA.kill('SIGTERM');
}

await browser.close();

console.log('\n===== page errors captured =====');
console.log(pageErrors.length ? pageErrors.join('\n') : '(none)');
ok('zero uncaught page errors across both flows', pageErrors.length === 0, pageErrors.join(' | '));

bridge.kill('SIGTERM');

console.log(`\n===== E2E RESULT: ${pass} passed, ${fail} failed =====`);
writeFileSync(`${SHOTS}/summary.json`, JSON.stringify({ pass, fail, failures, pageErrors }, null, 2));
if (failures.length) { console.log('Failures:', failures.join(' | ')); process.exit(1); }
process.exit(0);
