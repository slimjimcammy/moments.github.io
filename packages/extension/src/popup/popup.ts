import './popup.css';
import { sendToBackground, type EmptyResult, type ExtensionState, type StateResult } from '../messages';

const el = {
  panel: must<HTMLElement>('.panel'),
  banner: must<HTMLParagraphElement>('#banner'),
  account: must<HTMLElement>('#account'),
  avatar: must<HTMLImageElement>('#avatar'),
  name: must<HTMLElement>('#name'),
  email: must<HTMLElement>('#email'),
  capture: must<HTMLButtonElement>('#capture'),
  open: must<HTMLButtonElement>('#open'),
  signin: must<HTMLButtonElement>('#signin'),
  signout: must<HTMLButtonElement>('#signout'),
  shortcuts: must<HTMLButtonElement>('#shortcuts'),
  lede: must<HTMLParagraphElement>('#lede'),
  keys: must<HTMLElement>('#keys'),
};

let state: ExtensionState | null = null;

el.signin.addEventListener('click', async () => {
  el.signin.disabled = true;
  el.signin.textContent = 'Waiting for Google…';
  const result = await sendToBackground<StateResult>({ type: 'SIGN_IN' });
  el.signin.disabled = false;
  el.signin.textContent = 'Sign in with Google';
  if (result.ok) {
    render(result.state);
  } else {
    showBanner(result.error);
  }
});

el.signout.addEventListener('click', async () => {
  const result = await sendToBackground<StateResult>({ type: 'SIGN_OUT' });
  if (result.ok) render(result.state);
  else showBanner(result.error);
});

// Same code path as the hotkey, minus the keyboard — the way to save when a
// shortcut is taken by another app, and the way to prove the rest works.
el.capture.addEventListener('click', async () => {
  el.capture.disabled = true;
  el.capture.textContent = 'Saving…';
  const result = await sendToBackground<EmptyResult>({ type: 'CAPTURE_ACTIVE_TAB' });
  if (result.ok) {
    window.close();
    return;
  }
  el.capture.disabled = false;
  el.capture.textContent = 'Save this moment';
  showBanner(result.error);
});

el.open.addEventListener('click', () => {
  void sendToBackground<EmptyResult>({ type: 'OPEN_URL', url: state?.webAppUrl });
  window.close();
});

// chrome:// pages can't be linked to from HTML, but tabs.create reaches them.
el.shortcuts.addEventListener('click', () => {
  void sendToBackground<EmptyResult>({ type: 'OPEN_URL', url: 'chrome://extensions/shortcuts' });
  window.close();
});

void (async () => {
  const result = await sendToBackground<StateResult>({ type: 'GET_STATE' });
  if (result.ok) render(result.state);
  else showBanner(result.error);
})();

function render(next: ExtensionState): void {
  state = next;
  el.panel.setAttribute('aria-busy', 'false');

  if (next.configError) {
    showBanner(next.configError);
  } else {
    el.banner.hidden = true;
  }

  const user = next.user;
  el.account.hidden = !user;
  el.capture.hidden = !user;
  el.open.hidden = !user;
  el.signout.hidden = !user;
  el.signin.hidden = Boolean(user) || Boolean(next.configError);
  el.keys.hidden = !user;

  if (user) {
    el.name.textContent = user.name ?? user.email ?? 'Signed in';
    el.email.textContent = user.name ? (user.email ?? '') : '';
    el.avatar.hidden = !user.avatarUrl;
    if (user.avatarUrl) el.avatar.src = user.avatarUrl;
    el.lede.textContent = 'Hit the hotkey on any YouTube video — the moment is saved before the card even appears.';
  } else {
    // Don't leave a stale identity behind after signing out.
    el.name.textContent = '';
    el.email.textContent = '';
    el.avatar.removeAttribute('src');
    el.lede.textContent = next.configError
      ? 'Add your Supabase keys, rebuild, then reload the extension.'
      : 'Sign in once, then Ctrl+Shift+1 saves whatever you are watching.';
  }
}

function showBanner(message: string): void {
  el.banner.textContent = message;
  el.banner.hidden = false;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`popup is missing ${selector}`);
  return node;
}
