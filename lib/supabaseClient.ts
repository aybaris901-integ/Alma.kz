import { createClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for the partner dashboard (anon key + RLS).
 *
 * NEXT_PUBLIC_* vars are inlined at build time, so a missing value here means
 * the env file was wrong when `next dev`/`next build` started.
 */

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// supabase-js wants the project root (https://<ref>.supabase.co) and appends
// /rest/v1, /realtime/v1 etc. itself. Tolerate a REST path being pasted into
// the env var so a stray "/rest/v1/" doesn't break every request.
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");

if (!supabaseUrl || !anonKey) {
  console.error(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — all queries will fail.",
  );
} else if (anonKey.startsWith("sb_secret_")) {
  // Supabase refuses secret keys from browser origins ("Forbidden use of secret
  // API key in browser"), and a NEXT_PUBLIC_ var ships to every visitor anyway.
  console.error(
    "[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is a secret (sb_secret_…) key. Use the project's publishable/anon key here — and rotate this secret, since it was exposed to the client bundle.",
  );
} else if (rawUrl !== supabaseUrl) {
  console.warn(
    `[supabase] NEXT_PUBLIC_SUPABASE_URL should be the project root, not a REST path. Using "${supabaseUrl}".`,
  );
}

export const supabase = createClient(supabaseUrl, anonKey);
