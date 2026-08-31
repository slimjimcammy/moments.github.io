import type {
  SaveMomentArgs,
  SaveMomentResult,
  UpdateMomentArgs,
  UpdateMomentResult,
} from '@moments/shared';
import { CONFIG_ERROR, WEB_APP_URL } from './env';
import { getCurrentSession, getCurrentUser, signInWithGoogle, signOutEverywhere } from './auth';
import { supabase } from './supabase';
import type {
  ErrorCode,
  Request,
  SavedMoment,
  TabMessage,
  VideoMeta,
} from './messages';

const LAST_SAVED_KEY = 'moments.lastSaved';
const TAG_CACHE_KEY = 'moments.tagNames';

class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = 'UNKNOWN',
  ) {
    super(message);
  }
}

// Prints every time the worker spins up. Seeing this but never seeing a command
// means the worker is healthy and the keystroke is the missing piece.
console.log('[moments] service worker booted');

async function activeYouTubeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return null;
  try {
    const host = new URL(tab.url).hostname;
    return /(^|\.)youtube\.com$/.test(host) ? tab : null;
  } catch {
    return null;
  }
}

/**
 * Content scripts don't exist in tabs opened before install, and reloading the
 * extension orphans the ones that were already there — so re-inject on demand.
 * This needs a youtube.com host permission, not just a content_scripts match.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await pingTab(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (error) {
    console.warn('[moments] could not inject content script', error);
    return false;
  }
}

async function pingTab(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies TabMessage);
    return true;
  } catch {
    return false;
  }
}

async function sendToTab(tabId: number, message: TabMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn('[moments] tab message failed', error);
  }
}

// Make the hotkey work immediately in already-open YouTube tabs.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://m.youtube.com/*'] });
    for (const tab of tabs) {
      if (tab.id != null) await ensureContentScript(tab.id);
    }
  })();
});

// ---------------------------------------------------------------------------
// message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request: Request, _sender, respond) => {
  handle(request)
    .then((payload) => respond({ ok: true, ...payload }))
    .catch((error: unknown) => {
      const failure =
        error instanceof AppError
          ? { ok: false, error: error.message, code: error.code }
          : { ok: false, error: describe(error), code: 'UNKNOWN' as ErrorCode };
      console.warn('[moments]', request.type, failure.error);
      respond(failure);
    });
  return true; // keep the channel open for the async reply
});

async function handle(request: Request): Promise<Record<string, unknown>> {
  switch (request.type) {
    case 'GET_STATE':
      return { state: { user: await safeUser(), configError: CONFIG_ERROR, webAppUrl: WEB_APP_URL } };

    case 'SIGN_IN': {
      requireConfig();
      const user = await signInWithGoogle();
      void refreshTagCache();
      return { state: { user, configError: null, webAppUrl: WEB_APP_URL } };
    }

    case 'SIGN_OUT':
      await signOutEverywhere();
      await chrome.storage.session.remove(LAST_SAVED_KEY);
      await chrome.storage.local.remove(TAG_CACHE_KEY);
      return { state: { user: null, configError: CONFIG_ERROR, webAppUrl: WEB_APP_URL } };

    case 'GET_TAGS': {
      const cached = await readTagCache();
      void refreshTagCache();
      return { tags: cached };
    }

    case 'OPEN_URL':
      await chrome.tabs.create({ url: request.url ?? WEB_APP_URL });
      return {};

    case 'CAPTURE_ACTIVE_TAB': {
      const tab = await activeYouTubeTab();
      if (!tab?.id) throw new AppError('Open a YouTube video first.');

      const injected = await ensureContentScript(tab.id);
      if (!injected) throw new AppError('Reload this YouTube tab and try again.');

      await sendToTab(tab.id, { type: 'CAPTURE' });
      return {};
    }

    case 'SAVE_MOMENT':
      return await saveMoment(request.meta);

    case 'UPDATE_MOMENT':
      return await updateMoment(request);

    case 'DELETE_MOMENT':
      return await deleteMoment(request.momentId);

      case 'ANNOTATE_LAST': {
        const tab = await activeYouTubeTab();
        if (!tab?.id) throw new AppError('Open a YouTube video first.');

        const saved = await readLastSaved();
        if (!saved) throw new AppError('Nothing saved yet.');

        await sendToTab(tab.id, {
          type: 'ANNOTATE',
          saved,
        });

        return {};
      }
  }
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

async function saveMoment(meta: VideoMeta): Promise<{ saved: SavedMoment; deduped: boolean }> {
  await requireSession();

  const args: SaveMomentArgs = {
    p_youtube_video_id: meta.youtubeVideoId,
    p_title: meta.title,
    p_start_seconds: Math.max(0, Math.round(meta.startSeconds)),
    p_channel_name: meta.channelName,
    p_channel_id: meta.channelId,
    p_thumbnail_url: meta.thumbnailUrl,
    p_duration_seconds: meta.durationSeconds == null ? null : Math.round(meta.durationSeconds),
    p_youtube_url: meta.youtubeUrl,
  };

  const { data, error } = await supabase.rpc('save_moment', args);
  if (error) throw postgresError(error);

  const result = data as SaveMomentResult;
  const saved: SavedMoment = {
    momentId: result.moment_id,
    videoId: result.video_id,
    youtubeVideoId: meta.youtubeVideoId,
    title: meta.title,
    channelName: meta.channelName,
    startSeconds: args.p_start_seconds,
    endSeconds: result.end_seconds ?? null,
    note: result.note ?? null,
    tags: result.tags ?? [],
  };

  await chrome.storage.session.set({ [LAST_SAVED_KEY]: saved });
  void refreshTagCache();
  await flashBadge('✓', '#22c55e', `Moments — saved ${meta.title}`);

  return { saved, deduped: Boolean(result.deduped) };
}

async function updateMoment(
  request: Extract<Request, { type: 'UPDATE_MOMENT' }>,
): Promise<{ tags: string[] }> {
  await requireSession();

  const args: UpdateMomentArgs = {
    p_moment_id: request.momentId,
    p_note: request.note ?? null,
    p_end_seconds: request.endSeconds == null ? null : Math.max(0, Math.round(request.endSeconds)),
    p_clear_end: request.clearEnd ?? false,
    p_tags: request.tags ?? null,
  };

  const { data, error } = await supabase.rpc('update_moment', args);
  if (error) throw postgresError(error);

  const result = data as UpdateMomentResult;
  const tags = result.tags ?? [];

  const saved = await readLastSaved();
  if (saved?.momentId === request.momentId) {
    await chrome.storage.session.set({
      [LAST_SAVED_KEY]: {
        ...saved,
        note: request.note === undefined ? saved.note : (request.note?.trim() || null),
        endSeconds: request.clearEnd ? null : (args.p_end_seconds ?? saved.endSeconds),
        tags,
      } satisfies SavedMoment,
    });
  }

  void refreshTagCache();
  return { tags };
}

async function deleteMoment(momentId: string): Promise<Record<string, never>> {
  await requireSession();
  const { error } = await supabase.rpc('delete_moment', { p_moment_id: momentId });
  if (error) throw postgresError(error);

  const saved = await readLastSaved();
  if (saved?.momentId === momentId) await chrome.storage.session.remove(LAST_SAVED_KEY);
  void refreshTagCache();
  return {};
}

async function readLastSaved(): Promise<SavedMoment | null> {
  const bag = await chrome.storage.session.get(LAST_SAVED_KEY);
  return (bag[LAST_SAVED_KEY] as SavedMoment | undefined) ?? null;
}

/** Tag names, cached so the toast can offer suggestions with no round trip. */
async function readTagCache(): Promise<string[]> {
  const bag = await chrome.storage.local.get(TAG_CACHE_KEY);
  return (bag[TAG_CACHE_KEY] as string[] | undefined) ?? [];
}

async function refreshTagCache(): Promise<void> {
  try {
    if (CONFIG_ERROR || !(await getCurrentSession())) return;
    const { data, error } = await supabase.from('tags').select('name').order('name');
    if (error || !data) return;
    await chrome.storage.local.set({ [TAG_CACHE_KEY]: data.map((row) => row.name as string) });
  } catch (error) {
    console.warn('[moments] tag cache refresh failed', error);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function requireConfig(): void {
  if (CONFIG_ERROR) throw new AppError(CONFIG_ERROR, 'CONFIG');
}

async function requireSession(): Promise<void> {
  requireConfig();
  const session = await getCurrentSession();
  if (!session) throw new AppError('Sign in to save moments.', 'AUTH_REQUIRED');
}

async function safeUser() {
  try {
    return CONFIG_ERROR ? null : await getCurrentUser();
  } catch {
    return null;
  }
}

function postgresError(error: { message: string; code?: string; hint?: string | null }): AppError {
  if (error.code === '42501' || /jwt|not authenticated/i.test(error.message)) {
    return new AppError('Your session expired — sign in again.', 'AUTH_REQUIRED');
  }
  if (error.code === 'PGRST202') {
    return new AppError('Database is missing the Moments functions — run supabase/migrations.', 'CONFIG');
  }
  return new AppError(error.message || 'Supabase request failed.');
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong.';
}

let badgeTimer: number | undefined;

async function flashBadge(text: string, color: string, title?: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (title) await chrome.action.setTitle({ title });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
    void chrome.action.setTitle({ title: 'Moments' });
  }, 2000) as unknown as number;
}
