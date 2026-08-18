import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * There is no localStorage in a service worker, so the auth session lives in
 * chrome.storage.local. It survives the worker being torn down between
 * hotkey presses, which is the normal case for this extension.
 */
const chromeStorage: SupportedStorage = {
  async getItem(key) {
    const bag = await chrome.storage.local.get(key);
    return (bag[key] as string | undefined) ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder', {
  auth: {
    storage: chromeStorage,
    storageKey: 'moments.auth',
    persistSession: true,
    autoRefreshToken: true,
    // The redirect is handled by chrome.identity, never by a page load.
    detectSessionInUrl: false,
  },
});
