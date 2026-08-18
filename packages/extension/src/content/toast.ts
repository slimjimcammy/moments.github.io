import { formatRange, formatTimestamp, watchUrlAt } from '@moments/shared';
import type { SavedMoment, VideoMeta } from '../messages';

/**
 * The capture HUD: a small card in the corner of the player.
 *
 * It is deliberately not React — it lives inside a shadow root on someone
 * else's page, and a few hundred lines of DOM keeps the injected bundle tiny
 * and the page fast. Everything on it is optional: the moment is already in the
 * database by the time the card appears, so ignoring it is a valid workflow.
 */

const HOST_ID = 'moments-capture-host';
const SAVED_DISMISS_MS = 9000;
const ERROR_DISMISS_MS = 12000;
const NOTE_DEBOUNCE_MS = 650;

export type UpdatePatch = {
  note?: string;
  tags?: string[];
  endSeconds?: number | null;
  clearEnd?: boolean;
};

export type UpdateOutcome = { ok: boolean; error?: string; tags?: string[] };

/** Wired once, when the content script loads. */
export type ToastGlobals = {
  signIn(): Promise<{ ok: boolean; error?: string }>;
  suggestions(): Promise<string[]>;
  openApp(): void;
  /** Current player time, for "Set end". */
  currentTime(): number;
};

/** Wired per moment, because both calls need its id. */
export type MomentHandlers = {
  update(patch: UpdatePatch): Promise<UpdateOutcome>;
  remove(): Promise<{ ok: boolean; error?: string }>;
};

type Mode = 'saving' | 'saved' | 'error';

class CaptureToast {
  private globals: ToastGlobals | null = null;
  private host?: HTMLDivElement;
  private root?: ShadowRoot;
  private el!: {
    card: HTMLDivElement;
    countdown: HTMLDivElement;
    status: HTMLSpanElement;
    time: HTMLSpanElement;
    title: HTMLDivElement;
    channel: HTMLDivElement;
    warning: HTMLDivElement;
    body: HTMLDivElement;
    note: HTMLTextAreaElement;
    tagList: HTMLDivElement;
    tagInput: HTMLInputElement;
    suggestions: HTMLDataListElement;
    footer: HTMLDivElement;
    endButton: HTMLButtonElement;
    flash: HTMLDivElement;
    signIn: HTMLButtonElement;
  };

  private mode: Mode = 'saving';
  private moment: SavedMoment | null = null;
  private handlers: MomentHandlers | null = null;
  private canSignIn = false;
  private tags: string[] = [];
  private dismissTimer?: number;
  private noteTimer?: number;
  private flashTimer?: number;
  private pendingNote: string | null = null;
  private interacted = false;

  constructor() {
    // Registered once for the page's lifetime, not per mount.
    document.addEventListener('fullscreenchange', () => this.reparentForFullscreen());
  }

  configure(globals: ToastGlobals): void {
    this.globals = globals;
  }

  // -----------------------------------------------------------------------
  // public API
  // -----------------------------------------------------------------------

  /** Optimistic first frame: shown before the network call comes back. */
  showSaving(meta: VideoMeta): void {
    void this.flushNote();
    this.mount();
    this.cancelDismiss();
    this.mode = 'saving';
    this.moment = null;
    this.handlers = null;
    this.canSignIn = false;
    this.tags = [];
    this.interacted = false;
    this.pendingNote = null;
    this.el.note.value = '';
    this.el.note.style.height = 'auto';
    this.el.flash.hidden = true;
    this.el.title.textContent = meta.title;
    this.el.channel.textContent = meta.channelName ?? '';
    this.el.time.textContent = formatTimestamp(meta.startSeconds);
    this.el.warning.hidden = !meta.adShowing;
    this.render();
  }

  showSaved(saved: SavedMoment, handlers: MomentHandlers, options?: { deduped?: boolean }): void {
    this.mount();
    this.mode = 'saved';
    this.moment = { ...saved };
    this.handlers = handlers;
    this.canSignIn = false;
    this.tags = [...saved.tags];
    this.el.title.textContent = saved.title;
    this.el.channel.textContent = saved.channelName ?? '';
    this.el.note.value = saved.note ?? '';
    this.el.status.textContent = options?.deduped ? 'Already saved' : 'Saved';
    this.render();
    this.autoGrowNote();
    void this.loadSuggestions();
    this.scheduleDismiss(SAVED_DISMISS_MS);
  }

  showError(message: string, options?: { canSignIn?: boolean }): void {
    this.mount();
    this.mode = 'error';
    this.moment = null;
    this.handlers = null;
    this.canSignIn = Boolean(options?.canSignIn);
    this.el.status.textContent = message;
    this.render();
    this.scheduleDismiss(ERROR_DISMISS_MS);
  }

  /** Ctrl+Shift+2: reopen the card for the last moment, cursor in the note. */
  annotate(saved: SavedMoment, handlers: MomentHandlers): void {
    this.interacted = true;
    this.showSaved(saved, handlers);
    this.focusNote();
  }

  focusNote(): void {
    if (!this.host) return;
    this.markInteracted();
    this.el.note.focus();
    const caret = this.el.note.value.length;
    this.el.note.setSelectionRange(caret, caret);
  }

  dismiss(immediate = false): void {
    const host = this.host;
    if (!host) return;
    this.cancelDismiss();
    void this.flushNote();
    this.host = undefined;
    this.root = undefined;
    if (immediate) {
      host.remove();
      return;
    }
    this.el.card.classList.add('leaving');
    setTimeout(() => host.remove(), 180);
  }

  // -----------------------------------------------------------------------
  // mounting
  // -----------------------------------------------------------------------

  private mount(): void {
    if (this.host?.isConnected) {
      this.reparentForFullscreen();
      return;
    }

    document.getElementById(HOST_ID)?.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.host = host;
    this.root = root;

    const pick = <T extends Element>(selector: string): T => {
      const found = root.querySelector<T>(selector);
      if (!found) throw new Error(`[moments] capture card is missing ${selector}`);
      return found;
    };

    this.el = {
      card: pick('.card'),
      countdown: pick('.countdown'),
      status: pick('.status'),
      time: pick('.time'),
      title: pick('.title'),
      channel: pick('.channel'),
      warning: pick('.warning'),
      body: pick('.body'),
      note: pick('.note'),
      tagList: pick('.tag-list'),
      tagInput: pick('.tag-input'),
      suggestions: pick('#moments-tag-suggestions'),
      footer: pick('.footer'),
      endButton: pick('[data-act="end"]'),
      flash: pick('.flash'),
      signIn: pick('.signin'),
    };

    this.wire();
    this.reparentForFullscreen();
    requestAnimationFrame(() => this.el.card.classList.add('in'));
  }

  /**
   * position: fixed resolves against the fullscreen element, so when YouTube
   * goes fullscreen the card has to move inside the player or it vanishes.
   */
  private reparentForFullscreen(): void {
    const host = this.host;
    if (!host) return;
    const parent = document.fullscreenElement ?? document.documentElement;
    if (host.parentElement !== parent) parent.appendChild(host);
    host.classList.toggle('fullscreen', Boolean(document.fullscreenElement));
  }

  private wire(): void {
    const host = this.host!;

    // Keep keystrokes away from YouTube's shortcut handlers — otherwise typing
    // "k" in a note pauses the video and "t" toggles theater mode.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }

    host.addEventListener('pointerenter', () => this.markInteracted());
    host.addEventListener('focusin', () => this.markInteracted());

    this.el.card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.dismiss();
      }
    });

    this.el.note.addEventListener('input', () => {
      this.autoGrowNote();
      this.pendingNote = this.el.note.value;
      if (this.noteTimer) clearTimeout(this.noteTimer);
      this.noteTimer = setTimeout(
        () => void this.flushNote(),
        NOTE_DEBOUNCE_MS,
      ) as unknown as number;
    });
    this.el.note.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.flushNote().then(() => this.dismiss());
      }
    });

    this.el.tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
        if (!this.el.tagInput.value.trim()) return;
        event.preventDefault();
        this.commitTag(this.el.tagInput.value);
        return;
      }
      if (event.key === 'Backspace' && !this.el.tagInput.value && this.tags.length > 0) {
        event.preventDefault();
        this.setTags(this.tags.slice(0, -1));
      }
    });
    // A comma can also arrive by paste or by picking a datalist suggestion.
    this.el.tagInput.addEventListener('input', () => {
      if (this.el.tagInput.value.includes(',')) {
        const parts = this.el.tagInput.value.split(',');
        const trailing = parts.pop() ?? '';
        for (const part of parts) this.commitTag(part);
        this.el.tagInput.value = trailing;
      }
    });
    this.el.tagInput.addEventListener('blur', () => {
      if (this.el.tagInput.value.trim()) this.commitTag(this.el.tagInput.value);
    });

    this.el.footer.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset
        .act;
      if (!action) return;
      event.preventDefault();
      void this.runAction(action);
    });

    this.el.signIn.addEventListener('click', () => void this.runSignIn());
    this.root!.querySelector('.close')?.addEventListener('click', () => this.dismiss());
  }

  // -----------------------------------------------------------------------
  // actions
  // -----------------------------------------------------------------------

  private async runAction(action: string): Promise<void> {
    if (action === 'open') {
      this.globals?.openApp();
      return;
    }

    const moment = this.moment;
    const handlers = this.handlers;
    if (!moment || !handlers) return;

    switch (action) {
      case 'end': {
        if (moment.endSeconds != null) {
          const outcome = await handlers.update({ clearEnd: true });
          if (!outcome.ok) return this.flash(outcome.error ?? 'Could not clear the end time.');
          moment.endSeconds = null;
          this.renderTime();
          this.flash('End time cleared.');
          return;
        }
        const end = Math.round(this.globals?.currentTime() ?? 0);
        if (end <= moment.startSeconds) {
          this.flash('Let the video play past the start first.');
          return;
        }
        const outcome = await handlers.update({ endSeconds: end });
        if (!outcome.ok) return this.flash(outcome.error ?? 'Could not set the end time.');
        moment.endSeconds = end;
        this.renderTime();
        this.flash(`Clip ends at ${formatTimestamp(end)}.`);
        return;
      }

      case 'copy': {
        const url = watchUrlAt(moment.youtubeVideoId, moment.startSeconds);
        try {
          await navigator.clipboard.writeText(url);
          this.flash('Timestamped link copied.');
        } catch {
          this.flash('Clipboard was blocked — click the page, then retry.');
        }
        return;
      }

      case 'delete': {
        const outcome = await handlers.remove();
        if (!outcome.ok) return this.flash(outcome.error ?? 'Could not delete that moment.');
        this.pendingNote = null;
        if (this.noteTimer) clearTimeout(this.noteTimer);
        this.moment = null;
        this.handlers = null;
        this.el.status.textContent = 'Deleted';
        this.el.body.hidden = true;
        this.el.footer.hidden = true;
        setTimeout(() => this.dismiss(), 900);
        return;
      }
    }
  }

  private async runSignIn(): Promise<void> {
    this.cancelDismiss();
    this.el.signIn.disabled = true;
    this.el.status.textContent = 'Opening Google…';
    const outcome = await this.globals?.signIn();
    this.el.signIn.disabled = false;
    if (outcome?.ok) {
      this.el.status.textContent = 'Signed in — press Ctrl+Shift+1 again.';
      this.el.signIn.hidden = true;
      this.scheduleDismiss(5000);
    } else {
      this.el.status.textContent = outcome?.error ?? 'Sign-in failed.';
    }
  }

  private commitTag(raw: string): void {
    const name = raw.trim().replace(/^#+/, '').slice(0, 64);
    this.el.tagInput.value = '';
    if (!name) return;
    if (this.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) return;
    this.setTags([...this.tags, name]);
  }

  private setTags(tags: string[]): void {
    this.tags = tags;
    this.renderTags();
    const handlers = this.handlers;
    if (!handlers) return;
    void (async () => {
      const outcome = await handlers.update({ tags });
      if (!outcome.ok) {
        this.flash(outcome.error ?? 'Could not save tags.');
        return;
      }
      // The server owns canonical casing: typing "saas" reuses "SaaS".
      if (outcome.tags && this.handlers === handlers) {
        this.tags = outcome.tags;
        if (this.moment) this.moment.tags = outcome.tags;
        this.renderTags();
      }
    })();
  }

  private async flushNote(): Promise<void> {
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = undefined;
    }
    const note = this.pendingNote;
    const moment = this.moment;
    const handlers = this.handlers;
    if (note === null || !moment || !handlers) return;
    this.pendingNote = null;

    const outcome = await handlers.update({ note });
    if (!outcome.ok) {
      this.flash(outcome.error ?? 'Could not save the note.');
      return;
    }
    moment.note = note.trim() || null;
  }

  // -----------------------------------------------------------------------
  // rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const editable = this.mode === 'saved';
    this.el.card.dataset.mode = this.mode;
    this.el.body.hidden = !editable;
    this.el.footer.hidden = !editable;
    this.el.signIn.hidden = !(this.mode === 'error' && this.canSignIn);
    this.el.countdown.style.display = this.interacted ? 'none' : '';
    if (this.mode === 'saving') this.el.status.textContent = 'Saving…';
    if (editable) {
      this.renderTime();
      this.renderTags();
    }
  }

  private renderTime(): void {
    const moment = this.moment;
    if (!moment) return;
    this.el.time.textContent = formatRange(moment.startSeconds, moment.endSeconds);
    const noEnd = moment.endSeconds == null;
    // Short label, full meaning in the tooltip.
    this.el.endButton.textContent = noEnd ? 'End here' : 'Clear end';
    this.el.endButton.title = noEnd
      ? 'Set the clip end at the current timestamp'
      : 'Remove the clip end';
  }

  private renderTags(): void {
    const hadFocus = this.root?.activeElement === this.el.tagInput;
    this.el.tagList.textContent = '';

    for (const tag of this.tags) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(`#${tag}`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${tag}`);
      remove.textContent = '✕';
      remove.addEventListener('click', () =>
        this.setTags(this.tags.filter((candidate) => candidate !== tag)),
      );
      chip.appendChild(remove);
      this.el.tagList.appendChild(chip);
    }

    this.el.tagList.appendChild(this.el.tagInput);
    // Re-appending the input drops focus, which would break "type, Enter, type".
    if (hadFocus) this.el.tagInput.focus();
  }

  private async loadSuggestions(): Promise<void> {
    const names = (await this.globals?.suggestions()) ?? [];
    if (!this.host) return;
    this.el.suggestions.textContent = '';
    for (const name of names.slice(0, 200)) {
      const option = document.createElement('option');
      option.value = name;
      this.el.suggestions.appendChild(option);
    }
  }

  private autoGrowNote(): void {
    const note = this.el.note;
    note.style.height = 'auto';
    note.style.height = `${Math.min(note.scrollHeight, 120)}px`;
  }

  private flash(message: string): void {
    this.markInteracted();
    this.el.flash.textContent = message;
    this.el.flash.hidden = false;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.el.flash.hidden = true;
    }, 3200) as unknown as number;
  }

  /** Any sign of attention cancels the auto-dismiss, permanently. */
  private markInteracted(): void {
    if (this.interacted) return;
    this.interacted = true;
    this.cancelDismiss();
    this.el.countdown.style.display = 'none';
  }

  private scheduleDismiss(ms: number): void {
    this.cancelDismiss();
    if (this.interacted) {
      this.el.countdown.style.display = 'none';
      return;
    }
    const bar = this.el.countdown;
    bar.style.display = '';
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${ms}ms linear`;
      bar.style.transform = 'scaleX(0)';
    });
    this.dismissTimer = setTimeout(() => this.dismiss(), ms) as unknown as number;
  }

  private cancelDismiss(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = undefined;
    }
  }
}

const STYLES = /* css */ `
:host {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  color-scheme: dark;
  font-family: "YouTube Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
:host(.fullscreen) { bottom: 96px; }

* { box-sizing: border-box; margin: 0; }

/* Outranks the display values below, so element.hidden actually hides. */
[hidden] { display: none !important; }

.card {
  position: relative;
  width: 360px;
  max-width: calc(100vw - 40px);
  overflow: hidden;
  padding: 12px 14px 10px;
  border: 1px solid #2b2f38;
  border-radius: 14px;
  background: rgba(20, 22, 27, 0.96);
  backdrop-filter: blur(10px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  color: #e8e8ea;
  opacity: 0;
  transform: translateY(10px) scale(0.985);
  transition: opacity 160ms ease, transform 160ms ease;
}
.card.in { opacity: 1; transform: none; }
.card.leaving { opacity: 0; transform: translateY(6px); }

.countdown {
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: #f43f5e;
  transform-origin: left center;
}

header { display: flex; align-items: center; gap: 8px; }

.dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
}
.card[data-mode="saving"] .dot {
  background: #a1a1aa; box-shadow: none; animation: pulse 1s ease-in-out infinite;
}
.card[data-mode="error"] .dot {
  background: #f43f5e; box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.16);
}
@keyframes pulse { 50% { opacity: 0.35; } }

.status {
  flex: 1; min-width: 0;
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: #a1a1aa;
}
.card[data-mode="error"] .status {
  font-size: 12px; letter-spacing: 0; text-transform: none; color: #fda4af;
}

.time {
  flex: none;
  font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #fb7185; background: #2a2027; border-radius: 999px; padding: 4px 8px;
}
.card[data-mode="error"] .time { display: none; }

.close {
  appearance: none; border: 0; background: none; cursor: pointer; flex: none;
  color: #71717a; font-size: 12px; padding: 2px 4px; border-radius: 6px;
}
.close:hover { color: #e8e8ea; background: #2b2f38; }

.meta { margin-top: 8px; }
.title {
  font-size: 13.5px; font-weight: 600; color: #f4f4f5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.channel { font-size: 12px; color: #a1a1aa; margin-top: 2px; }
.channel:empty { display: none; }
.card[data-mode="error"] .meta { display: none; }

.warning {
  margin-top: 8px; padding: 5px 8px; border-radius: 8px;
  font-size: 11.5px; color: #fcd34d; background: rgba(252, 211, 77, 0.1);
}

.note {
  display: block; width: 100%; margin-top: 10px; padding: 8px 10px; resize: none;
  font: inherit; font-size: 12.5px; color: #f4f4f5;
  background: #101216; border: 1px solid #2b2f38; border-radius: 10px;
  min-height: 34px; max-height: 120px; overflow-y: auto;
}
.note::placeholder { color: #6b7280; }
.note:focus { outline: none; border-color: #f43f5e; background: #0d0f13; }

.tag-list { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 7px; }

.chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: #d4d4d8; background: #2b2f38;
  border-radius: 999px; padding: 3px 4px 3px 9px;
}
.chip button {
  appearance: none; border: 0; background: none; cursor: pointer;
  color: #8b8b93; font-size: 10px; line-height: 1; padding: 2px 3px; border-radius: 999px;
}
.chip button:hover { color: #fda4af; background: #3a3f4a; }

.tag-input {
  flex: 1; min-width: 92px; appearance: none;
  font: inherit; font-size: 11.5px; color: #f4f4f5;
  background: none; border: 0; padding: 4px 2px;
}
.tag-input:focus { outline: none; }
.tag-input::placeholder { color: #6b7280; }

.footer { display: flex; align-items: center; gap: 2px; margin-top: 9px; flex-wrap: wrap; }
.footer button {
  appearance: none; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 11.5px; color: #a1a1aa;
  padding: 4px 7px; border-radius: 7px;
}
.footer button:hover { color: #f4f4f5; background: #2b2f38; }
.footer button.danger:hover { color: #fda4af; background: rgba(244, 63, 94, 0.12); }
.footer .spacer { flex: 1; }

.flash { margin-top: 6px; font-size: 11.5px; color: #86efac; }

.signin {
  appearance: none; cursor: pointer; margin-top: 10px; width: 100%;
  font: inherit; font-size: 12.5px; font-weight: 600; color: #18181b;
  background: #f4f4f5; border: 0; border-radius: 9px; padding: 8px 10px;
}
.signin:hover { background: #ffffff; }
.signin:disabled { opacity: 0.6; cursor: default; }

.hint { margin-top: 7px; font-size: 10.5px; color: #6b7280; }
.card[data-mode="error"] .hint { display: none; }
`;

const TEMPLATE = /* html */ `
<style>${STYLES}</style>
<div class="card" data-mode="saving" role="status" aria-live="polite">
  <div class="countdown"></div>
  <header>
    <span class="dot"></span>
    <span class="status">Saving…</span>
    <span class="time"></span>
    <button class="close" type="button" aria-label="Dismiss">✕</button>
  </header>
  <div class="meta">
    <div class="title"></div>
    <div class="channel"></div>
  </div>
  <div class="warning" hidden>An ad is playing — this timestamp is the ad's, not the video's.</div>
  <button class="signin" type="button" hidden>Sign in with Google</button>
  <div class="body" hidden>
    <textarea class="note" rows="1"
      placeholder="Add a note…  (Enter saves, Shift+Enter for a new line)"></textarea>
    <div class="tag-list">
      <input class="tag-input" type="text" placeholder="Add tag" list="moments-tag-suggestions"
             autocomplete="off" spellcheck="false" />
    </div>
    <datalist id="moments-tag-suggestions"></datalist>
  </div>
  <div class="footer" hidden>
    <button type="button" data-act="end" title="Set the clip end at the current timestamp">End here</button>
    <button type="button" data-act="copy">Copy link</button>
    <button type="button" data-act="open">All moments</button>
    <span class="spacer"></span>
    <button type="button" class="danger" data-act="delete">Delete</button>
  </div>
  <div class="flash" hidden></div>
  <div class="hint">Esc closes · notes and tags save as you type</div>
</div>
`;

export const toast = new CaptureToast();
