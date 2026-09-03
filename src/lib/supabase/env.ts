// Reads the public Supabase env vars, failing fast with a clear message if
// they're missing (e.g. a Vercel preview where they weren't configured) rather
// than a cryptic error deep inside the Supabase client.
//
// Supabase renamed the browser-safe key from "anon" to "publishable"; both names
// are accepted here so a copy-paste from either dashboard vintage works. The
// full literals matter: Next.js inlines NEXT_PUBLIC_ vars by static analysis, so
// neither can be built up dynamically.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the older NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
        "See .env.example.",
    );
  }

  return { url, anonKey };
}
