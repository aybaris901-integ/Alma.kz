import { createClient } from '@supabase/supabase-js';

// Vite exposes env vars via import.meta.env, and only ones prefixed
// VITE_ are sent to the browser (equivalent of Next's NEXT_PUBLIC_).
// Do NOT put a secret/service-role key here — this file ships to the client.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local and fill them in.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
