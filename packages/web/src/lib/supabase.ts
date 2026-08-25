import { createClient } from '@supabase/supabase-js';

// supabase-js wants the bare project origin and appends its own paths. A
// trailing slash or a pasted "/rest/v1" endpoint produces request URLs that
// miss Supabase's gateway routes, which answers "No API key found in request".
const url = normalizeProjectUrl(import.meta.env.VITE_SUPABASE_URL ?? '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

const missing = [
  ...(url ? [] : ['VITE_SUPABASE_URL']),
  ...(anonKey ? [] : ['VITE_SUPABASE_ANON_KEY']),
];

const placeholders = /your-project-ref|your-anon-key/.test(`${url} ${anonKey}`);

/** Rendered as a setup notice instead of failing with a blank screen. */
export const configError = missing.length
  ? `Missing ${missing.join(' and ')} in packages/web/.env.local`
  : placeholders
    ? 'packages/web/.env.local still has the example placeholder values — paste your real project URL and anon key.'
    : null;

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The OAuth redirect lands back on this app, so let supabase-js pick the
    // session out of the URL.
    detectSessionInUrl: true,
  },
});

/** "https://ref.supabase.co/rest/v1/" -> "https://ref.supabase.co" */
export function normalizeProjectUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+$/, '');
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}
