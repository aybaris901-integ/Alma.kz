import { createClient } from '@supabase/supabase-js';

// Vite exposes env vars via import.meta.env, and only ones prefixed
// VITE_ are sent to the browser. Do NOT put a secret/service-role key
// here — this file ships to the client.
//
// The project's .env.local uses the new-style PUBLISHABLE key
// (sb_publishable_...), which is the public key — safe for the browser.
// VITE_SUPABASE_ANON_KEY is accepted as a fallback for projects that
// still use the classic anon JWT.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.local.example to .env.local and fill them in.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
