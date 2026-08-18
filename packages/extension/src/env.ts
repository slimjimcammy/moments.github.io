// Vite inlines these at build time. A missing value is reported through the UI
// (popup + capture toast) instead of thrown at module load, because an
// exception here would take the whole service worker down silently.

/**
 * supabase-js wants the bare project origin and appends its own paths. A
 * trailing slash or a pasted "/rest/v1" endpoint produces request URLs that
 * miss Supabase's gateway routes, which answers "No API key found in request".
 */
function normalizeProjectUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+$/, '');
}

export const SUPABASE_URL = normalizeProjectUrl(import.meta.env.VITE_SUPABASE_URL ?? '');
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
export const WEB_APP_URL = (import.meta.env.VITE_WEB_APP_URL ?? 'http://localhost:5173').replace(
  /\/+$/,
  '',
);

export const MISSING_CONFIG: string[] = [
  ...(SUPABASE_URL ? [] : ['VITE_SUPABASE_URL']),
  ...(SUPABASE_ANON_KEY ? [] : ['VITE_SUPABASE_ANON_KEY']),
];

export const CONFIG_ERROR: string | null = MISSING_CONFIG.length
  ? `Missing ${MISSING_CONFIG.join(' and ')} — add them to packages/extension/.env.local and rebuild.`
  : /your-project-ref|your-anon-key/.test(`${SUPABASE_URL} ${SUPABASE_ANON_KEY}`)
    ? 'packages/extension/.env.local still has the example placeholder values — paste your real project URL and anon key, then rebuild.'
    : null;
