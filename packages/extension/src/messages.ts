// Every cross-context call in the extension goes through these types.
// Content script  -> service worker: Request
// Service worker  -> content script: TabMessage

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

/** What the content script scrapes off the YouTube page. */
export type VideoMeta = {
  youtubeVideoId: string;
  title: string;
  channelName: string | null;
  channelId: string | null;
  thumbnailUrl: string;
  durationSeconds: number | null;
  youtubeUrl: string;
  startSeconds: number;
  /** True while a pre-roll/mid-roll ad owns the player, so the time is the ad's. */
  adShowing: boolean;
};

/** A moment that exists in the database, as the toast needs to render it. */
export type SavedMoment = {
  momentId: string;
  videoId: string;
  youtubeVideoId: string;
  title: string;
  channelName: string | null;
  startSeconds: number;
  endSeconds: number | null;
  note: string | null;
  tags: string[];
};

export type ExtensionState = {
  user: AuthUser | null;
  configError: string | null;
  webAppUrl: string;
};

export type Request =
  | { type: 'GET_STATE' }
  | { type: 'SIGN_IN' }
  | { type: 'SIGN_OUT' }
  | { type: 'GET_TAGS' }
  /** Opens the web UI when url is omitted. */
  | { type: 'OPEN_URL'; url?: string }
  /** The popup's mouse-driven equivalent of the capture hotkey. */
  | { type: 'CAPTURE_ACTIVE_TAB' }
  | { type: 'SAVE_MOMENT'; meta: VideoMeta }
  | {
      type: 'UPDATE_MOMENT';
      momentId: string;
      note?: string | null;
      endSeconds?: number | null;
      clearEnd?: boolean;
      tags?: string[];
    }
  | { type: 'DELETE_MOMENT'; momentId: string };

export type TabMessage =
  | { type: 'PING' }
  | { type: 'CAPTURE' }
  | { type: 'ANNOTATE'; saved: SavedMoment };

export type ErrorCode = 'AUTH_REQUIRED' | 'CONFIG' | 'UNKNOWN';

export type Failure = { ok: false; error: string; code: ErrorCode };
export type Result<T> = ({ ok: true } & T) | Failure;

export type StateResult = Result<{ state: ExtensionState }>;
export type SaveResult = Result<{ saved: SavedMoment; deduped: boolean }>;
export type UpdateResult = Result<{ tags: string[] }>;
export type TagsResult = Result<{ tags: string[] }>;
export type EmptyResult = Result<Record<string, never>>;

/** sendMessage with the callback-era error surfaced as a normal Failure. */
export async function sendToBackground<R extends Result<unknown>>(request: Request): Promise<R> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as R | undefined;
    if (!response) {
      return { ok: false, error: 'The Moments background worker did not respond.', code: 'UNKNOWN' } as R;
    }
    return response;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'UNKNOWN',
    } as R;
  }
}
