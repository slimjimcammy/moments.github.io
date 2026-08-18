import {
  sendToBackground,
  type EmptyResult,
  type SaveResult,
  type StateResult,
  type TabMessage,
  type TagsResult,
  type UpdateResult,
} from '../messages';
import { getPlayerVideo, scrapeVideoMeta } from './scrape';
import { toast, type MomentHandlers, type UpdatePatch } from './toast';

declare global {
  interface Window {
    __momentsContentScriptLoaded?: boolean;
  }
}

// The manifest injects this on navigation, and the service worker injects it
// into tabs that predate the install. Either way, only wire up once.
if (!window.__momentsContentScriptLoaded) {
  window.__momentsContentScriptLoaded = true;
  console.log('[moments] content script ready on', location.href);
  init();
}

function init(): void {
  toast.configure({
    async signIn() {
      const result = await sendToBackground<StateResult>({ type: 'SIGN_IN' });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    async suggestions() {
      const result = await sendToBackground<TagsResult>({ type: 'GET_TAGS' });
      return result.ok ? result.tags : [];
    },
    openApp() {
      void sendToBackground<EmptyResult>({ type: 'OPEN_URL' });
    },
    currentTime() {
      const video = getPlayerVideo();
      return video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    },
  });

  chrome.runtime.onMessage.addListener((message: TabMessage, _sender, respond) => {
    switch (message.type) {
      case 'PING':
        respond({ ok: true });
        return false;

      case 'CAPTURE':
        console.log('[moments] capture requested');
        respond({ ok: true });
        void capture();
        return false;

      case 'ANNOTATE':
        respond({ ok: true });
        toast.annotate(message.saved, handlersFor(message.saved.momentId));
        return false;
    }
  });
}

/** In flight guard: holding the hotkey down fires the command repeatedly. */
let capturing = false;

async function capture(): Promise<void> {
  if (capturing) return;

  const meta = scrapeVideoMeta();
  if (!meta) {
    toast.showError('No YouTube video on this page.');
    return;
  }

  capturing = true;
  toast.showSaving(meta);
  try {
    const result = await sendToBackground<SaveResult>({ type: 'SAVE_MOMENT', meta });
    if (!result.ok) {
      toast.showError(result.error, { canSignIn: result.code === 'AUTH_REQUIRED' });
      return;
    }
    toast.showSaved(result.saved, handlersFor(result.saved.momentId), {
      deduped: result.deduped,
    });
  } finally {
    capturing = false;
  }
}

function handlersFor(momentId: string): MomentHandlers {
  return {
    async update(patch: UpdatePatch) {
      const result = await sendToBackground<UpdateResult>({
        type: 'UPDATE_MOMENT',
        momentId,
        ...patch,
      });
      return result.ok ? { ok: true, tags: result.tags } : { ok: false, error: result.error };
    },
    async remove() {
      const result = await sendToBackground<EmptyResult>({ type: 'DELETE_MOMENT', momentId });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  };
}
