# Moments

Save the exact second of a YouTube video you care about, with one keystroke.

`Alt+Shift+M` writes a timestamped bookmark — video, channel, thumbnail, and
the second you were on — then shows a small card in the corner of the player.
The note and tags on that card are optional; the moment is already saved before
the card finishes animating in. Everything you keep shows up in a separate web
UI, searchable and citable.

```
┌──────────────────────────────────────────┐
│ ● SAVED                          38:21 ✕ │
│ How I Built a $10M SaaS                  │
│ Alex Chen                                │
│ ┌──────────────────────────────────────┐ │
│ │ First 100 customers came from cold…  │ │
│ └──────────────────────────────────────┘ │
│ #SaaS ✕  #CustomerAcquisition ✕  + tag   │
│ Set end · Copy link · All moments        │
└──────────────────────────────────────────┘
```

## Layout

```
packages/extension   Chrome MV3 extension — the capture side
packages/web         React + TypeScript + Vite — the library side
packages/shared      Types and pure helpers used by both
supabase/migrations  Schema, row level security, and the RPCs
```

Both apps talk to Postgres directly through Supabase; there is no backend of
your own to run or deploy.

## Setup

You need a Supabase project and Chrome. About ten minutes.

### 1. Create the database

In the Supabase dashboard, open **SQL Editor** and run the two migrations in
order:

1. `supabase/migrations/20260817000001_init.sql` — tables, indexes, RLS
2. `supabase/migrations/20260817000002_rpc.sql` — the save/update/delete RPCs

With the Supabase CLI instead: `supabase link --project-ref <ref> && supabase db push`.

### 2. Turn on Google sign-in

In **Google Cloud Console → APIs & Services → Credentials**, create an **OAuth
client ID** of type **Web application**. Under **Authorized redirect URIs**, add
your project's callback — this exact URL, with your own project ref:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Google matches redirect URIs exactly and rejects anything unregistered with
`Error 400: redirect_uri_mismatch`. If the consent screen is in **Testing**
mode, also add your own Google account under **Audience → Test users**.

Then in Supabase, **Authentication → Providers → Google**: enable it and paste
that client ID and secret in.

This is the only place Google is configured. The extension reuses this same
provider, and its `chromiumapp.org` redirect belongs in Supabase (step 5), never
in Google Cloud.

### 3. Run the web UI

```bash
npm install
cp packages/web/.env.example packages/web/.env.local   # add your URL + anon key
npm run dev:web                                        # http://localhost:5173
```

Sign in with Google. It will be empty until you save something.

### 4. Build and load the extension

```bash
cp packages/extension/.env.example packages/extension/.env.local
npm run build:ext
```

Then in Chrome:

1. Go to `chrome://extensions`, turn on **Developer mode**
2. **Load unpacked** → select `packages/extension/dist`
3. Copy the extension ID Chrome shows on the card
4. Chrome hides new extensions behind the puzzle-piece icon in the toolbar —
   open it and pin Moments so the icon is one click away

Signing in to the web UI does not sign in the extension: the web app's session
lives in `localStorage` for its origin, the extension's in `chrome.storage`.
Same Google account, two sessions, one extra sign-in.

### 5. Allow the extension's redirect URL

Back in Supabase: **Authentication → URL Configuration → Redirect URLs**, add

```
https://<the-extension-id>.chromiumapp.org/
```

That is where Google returns to when the extension signs you in, and Supabase
rejects redirects it hasn't been told about. An unpacked extension's ID is
derived from its directory path, so it stays the same across rebuilds and
reloads as long as you don't move `dist/`.

Now click the Moments toolbar icon (the rose play-button square), **Sign in with
Google**, open any YouTube video, and press the capture hotkey.

## Hotkeys

On macOS, `Alt` is the **Option (⌥)** key, so these are ⌥⇧M and ⌥⇧N. Chrome
claims them before text input, so they don't type the characters Option normally
would.

In **Arc**, the per-shortcut scope dropdown on `chrome://extensions/shortcuts`
has to be set to **Global**; the default "In Arc" scope accepts the binding in
the UI but never dispatches it. Chrome itself is fine on "In Chrome".

| Keys | What happens |
| --- | --- |
| `Alt+Shift+M` | Save this moment. Always saves — never asks anything first. |
| `Alt+Shift+N` | Reopen the last saved moment's card with the cursor in the note. |
| `Esc` | Close the card. Anything you typed is already saved. |
| `/` (web UI) | Jump to search. |

Rebind either hotkey at `chrome://extensions/shortcuts`. The popup also has a
**Save this moment** button that runs the identical code path, which is the way
to capture when another app has claimed your combo — on macOS, launchers like
Raycast and Alfred swallow Option+Shift chords before Chrome ever sees them.

## How capture works

The service worker's `chrome.commands` listener asks the content script to
capture. The content script reads the page — video id from the URL, title and
channel through a list of selectors that degrade to `document.title`,
`currentTime` off the `<video>` element — shows the card immediately, and sends
one `save_moment` RPC.

That RPC does the whole write in a single round trip: upsert the video row,
insert the moment, resolve tag names to ids, link them. It also collapses a
second save of the same spot within 20 seconds into the first one, so holding
the hotkey down can't litter your library.

Notes and tags then patch that moment as you type (debounced, ~650 ms), which
is why nothing on the card needs a Save button.

A few details worth knowing:

- **Shorts.** YouTube is a single page app that doesn't clean up after itself:
  opening a Short from a watch page leaves the whole watch DOM in the document,
  hidden, holding the old title, channel, and a paused `<video>` that a naive
  `querySelector('video')` finds first. So scraping detects the page kind and
  scopes every lookup to that player's container, falling back only to things
  that track navigation — the URL and `document.title`.
- **Ads.** If a pre-roll is playing, `currentTime` belongs to the ad, and the
  card says so rather than pretending the timestamp is right.
- **Fullscreen.** `position: fixed` resolves against the fullscreen element, so
  the card re-parents itself into the player when you go fullscreen.
- **Keystrokes.** The card lives in a shadow root and stops key events at its
  host, so typing `k` in a note doesn't pause the video.
- **Tag casing.** The database owns it: typing `saas` reuses your existing
  `SaaS` tag instead of creating a twin.

## Data model

```
users ─┬─< videos ──< moments >── moment_tags ──< tags
       ├─< moments
       └─< tags
```

Every table has row level security keyed on `auth.uid()`, so a client can only
ever read or write its own rows — the anon key in the browser and in the
extension grants nothing on its own. `moments` also carries a composite foreign
key to `videos (user_id, id)`, which makes a cross-account reference
structurally impossible rather than merely unlikely.

Tags are pruned when nothing points at them anymore, and deleting the last
moment of a video removes the video row too, so the tag filter row and the
library stay tidy on their own.

`videos.channel_id` holds a canonical `UC…` id when YouTube exposes one and an
`@handle` otherwise; `channelUrl()` in `@moments/shared` maps both to a URL.

## The web UI

The whole library loads in one query (newest 2000) and search runs in the
browser, so filtering is instant and typing never waits on a round trip. Tag
chip counts are computed against the current search results, so a count tells
you what clicking it would actually narrow to. Notes and tags are editable in
place, and every edit is optimistic with a rollback if the request fails.

**Copy Citation** yields:

```
"First 100 customers came through cold outreach."
— How I Built a $10M SaaS · Alex Chen (38:21)
https://youtu.be/dQw4w9WgXcQ?t=2301
```

## Commands

```bash
npm run dev:web      # web UI at :5173
npm run dev:ext      # rebuild the extension on change (reload it in Chrome to pick up changes)
npm run build        # build both
npm run typecheck    # tsc across all three packages
npm run zip -w @moments/extension   # packages/extension/moments-extension.zip
```

Extension env vars are inlined at build time, so after editing
`.env.local` you need `npm run build:ext` **and** the reload button on
`chrome://extensions`.

## Deploying the web UI

`npm run build:web` produces a static `packages/web/dist` — any static host
works. Two things to update afterwards:

1. Supabase **Authentication → URL Configuration**: add your site URL to
   Redirect URLs.
2. `VITE_WEB_APP_URL` in the extension's `.env.local`, then rebuild, so the
   card's "All moments" button points at the deployed app.

## Where the logs are

An extension has three consoles, and each hop of a capture logs to a different
one. In order:

| Context | How to open it | What you should see on ⌥⇧M |
| --- | --- | --- |
| Service worker | `chrome://extensions` → Moments → **service worker** link | `[moments] command received: save-moment` |
| Content script | DevTools on the YouTube tab itself | `[moments] capture requested` |
| Popup | Right-click the toolbar icon → **Inspect popup** | sign-in errors |

Read them in that order: the first one that stays silent is where the problem
is. A red **Errors** button on the extension's card means the service worker
threw on startup, in which case no listener ever registered.

## Troubleshooting

**The hotkey does nothing.** Chrome silently drops a shortcut that another
extension already claimed — check `chrome://extensions/shortcuts`. Also make
sure the tab is a `youtube.com` page; the toolbar badge flashes a grey dot when
it isn't.

**"check that https://….chromiumapp.org/ is listed…"** Step 5 above, and the
trailing slash matters.

**Saving fails with a missing-function error.** The migrations didn't run, or
only the first one did.

**Nothing saves after a long idle period.** The service worker refreshes an
expired token on the next use, but if you changed your password or revoked the
session elsewhere, sign out and back in from the popup.
