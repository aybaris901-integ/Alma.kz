// E2E mock of the supabase-js client used by both frontends.
// Swapped in via a vite resolve.alias during browser tests; every call is
// translated to SQL executed by the bridge (real PGlite: real migrations,
// real RLS, real create_order/cancel_order RPCs).
//
// The guest id is stable per browser (localStorage), mirroring how a real
// anonymous Supabase session keeps a stable auth.uid().

const BRIDGE = 'http://localhost:8911/sql';

function getGuestId(): string {
  const KEY = 'e2eGuestId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function bridge(sql: string, params: unknown[] = [], role = 'authenticated', sub?: string) {
  const res = await fetch(BRIDGE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params, role, sub: sub ?? getGuestId() }),
  });
  return (await res.json()) as { rows?: Record<string, unknown>[]; error?: { code: string; message: string } };
}

function lit(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return String(v);
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

interface QueryState {
  table: string;
  filters: [string, unknown][];
  order: [string, boolean] | null;
  single: boolean;
}

function makeQuery(table: string) {
  const state: QueryState = { table, filters: [], order: null, single: false };

  async function exec(): Promise<{ data: Record<string, unknown>[] | null; error: { code: string; message: string } | null }> {
    try {
      let sql = `select * from public.${state.table}`;
      for (const [col, val] of state.filters) sql += ` where ${col} = ${lit(val)}`;
      if (state.order) sql += ` order by ${state.order[0]} ${state.order[1] ? 'asc' : 'desc'}`;
      const out = await bridge(sql);
      if (out.error) return { data: null, error: out.error };
      return { data: out.rows ?? [], error: null };
    } catch (e) {
      return { data: null, error: { code: 'NETERR', message: String(e) } };
    }
  }

  const thenable: {
    select: () => unknown;
    eq: (col: string, val: unknown) => unknown;
    order: (col: string, opts?: { ascending?: boolean }) => unknown;
    maybeSingle: () => unknown;
    then: PromiseLike<{ data: unknown; error: unknown }>['then'];
  } = {
    select: () => thenable,
    eq: (col, val) => { state.filters.push([col, val]); return thenable; },
    order: (col, opts) => { state.order = [col, opts?.ascending !== false]; return thenable; },
    maybeSingle: () => ({
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        exec().then(({ data, error }) =>
          resolve({ data: error ? null : (data && data[0]) ?? null, error })).catch(reject!),
    }),
    then: (resolve, reject) =>
      exec().then(resolve as never).catch(reject as never),
  };
  return thenable;
}

async function rpc(name: string, params: Record<string, unknown>) {
  try {
    if (name === 'create_order') {
      const out = await bridge(
        `select public.create_order($1::uuid, $2::uuid, $3::jsonb) as o`,
        [params.p_restaurant_id, params.p_slot_id, JSON.stringify(params.p_items)]
      );
      if (out.error) return { data: null, error: out.error };
      return { data: out.rows?.[0]?.o ?? null, error: null };
    }
    if (name === 'cancel_order') {
      const out = await bridge(`select public.cancel_order($1::uuid) as o`, [params.p_order_id]);
      if (out.error) return { data: null, error: out.error };
      return { data: out.rows?.[0]?.o ?? null, error: null };
    }
    return { data: null, error: { code: 'NORPC', message: `rpc ${name} not mocked` } };
  } catch (e) {
    return { data: null, error: { code: 'NETERR', message: String(e) } };
  }
}

export const supabase = {
  auth: {
    // Emulates a persisted anonymous session: stable auth.uid() per browser.
    async getSession() {
      return { data: { session: { user: { id: getGuestId() } } }, error: null };
    },
    async signInAnonymously() {
      return { data: { session: { user: { id: getGuestId() } } }, error: null };
    },
  },
  from: makeQuery,
  rpc,
};

export default supabase;
