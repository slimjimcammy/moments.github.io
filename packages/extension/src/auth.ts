import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AuthUser } from './messages';

/**
 * Google sign-in without leaving the extension.
 *
 * We ask Supabase for the provider authorization URL (skipBrowserRedirect, so
 * nothing navigates), hand it to chrome.identity.launchWebAuthFlow, and finish
 * the exchange when Google bounces back to
 *
 *   https://<extension-id>.chromiumapp.org/
 *
 * That URL must be listed under Supabase -> Authentication -> URL Configuration
 * -> Redirect URLs. No second Google OAuth client and no client secret needed:
 * the Supabase project's Google provider does the token exchange.
 */
export async function signInWithGoogle(): Promise<AuthUser> {
  const redirectTo = chrome.identity.getRedirectURL();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an authorization URL.');

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Chrome uses this phrasing both when the window is closed and when the
    // redirect URL isn't allow-listed on the Supabase side.
    if (/did not approve|canceled|closed/i.test(message)) {
      throw new Error('Sign-in was cancelled.');
    }
    throw new Error(
      `${message} — check that ${redirectTo} is listed in Supabase → Authentication → URL Configuration → Redirect URLs.`,
    );
  }
  if (!responseUrl) throw new Error('Sign-in was cancelled.');

  const session = await completeSignIn(responseUrl);
  return toAuthUser(session);
}

async function completeSignIn(responseUrl: string): Promise<Session> {
  const url = new URL(responseUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

  const failure =
    url.searchParams.get('error_description') ??
    url.searchParams.get('error') ??
    hash.get('error_description') ??
    hash.get('error');
  if (failure) throw new Error(failure);

  // PKCE (the supabase-js default): the code verifier is already in
  // chrome.storage from signInWithOAuth above.
  const code = url.searchParams.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (!data.session) throw new Error('Supabase returned no session for that code.');
    return data.session;
  }

  // Implicit flow fallback, in case the project is configured that way.
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    if (!data.session) throw new Error('Supabase returned no session for those tokens.');
    return data.session;
  }

  throw new Error('The OAuth redirect carried no credentials.');
}

export async function signOutEverywhere(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentSession(): Promise<Session | null> {
  // getSession() refreshes an expired token, which matters here: the service
  // worker is usually cold-started by the hotkey, long after the last refresh.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getCurrentSession();
  return session ? toAuthUser(session) : null;
}

function toAuthUser(session: Session): AuthUser {
  const meta = session.user.user_metadata ?? {};
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
    avatarUrl:
      (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null,
  };
}
