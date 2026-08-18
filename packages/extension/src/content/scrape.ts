import { parseVideoId, thumbnailUrl, watchUrlAt } from '@moments/shared';
import type { VideoMeta } from '../messages';

/**
 * Reads everything we need off the page.
 *
 * The hard part is that YouTube is a single page app which does not clean up
 * after itself: open a Short from a watch page's sidebar and the whole
 * ytd-watch-flexy tree stays in the document, hidden, holding the previous
 * video's title, channel, microdata — and a paused <video> element that
 * document.querySelector('video') finds first.
 *
 * So nothing here queries the document blindly. We work out which kind of page
 * we are on, scope every lookup to that player's container, and fall back only
 * to things that track navigation (the URL, document.title).
 */

type PageKind = 'watch' | 'shorts';
type Page = { kind: PageKind; videoId: string };

export function scrapeVideoMeta(): VideoMeta | null {
  const page = detectPage();
  if (!page) return null;

  const scope = page.kind === 'shorts' ? activeReel() : moviePlayer();
  const video = videoIn(scope) ?? bestVisibleVideo();
  if (!video) return null;

  // Ads only interrupt the watch player; a Short's timestamp is never an ad's.
  const adShowing =
    page.kind === 'watch' &&
    Boolean(document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing'));

  const startSeconds = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
  const owner = scrapeOwner(page.kind, scope);

  return {
    youtubeVideoId: page.videoId,
    title: page.kind === 'shorts' ? scrapeShortsTitle(scope) : scrapeWatchTitle(),
    channelName: owner.name,
    channelId: owner.id,
    thumbnailUrl: thumbnailUrl(page.videoId),
    durationSeconds: scrapeDuration(video, adShowing, page.kind),
    // A Short opens fine as a normal watch URL, and only that form honours ?t=.
    youtubeUrl: watchUrlAt(page.videoId, startSeconds),
    startSeconds,
    adShowing,
  };
}

function detectPage(): Page | null {
  const shorts = /^\/shorts\/([\w-]{6,20})/.exec(location.pathname);
  if (shorts?.[1]) return { kind: 'shorts', videoId: shorts[1] };

  const videoId = parseVideoId(location.href);
  return videoId ? { kind: 'watch', videoId } : null;
}

// ---------------------------------------------------------------------------
// finding the right player
// ---------------------------------------------------------------------------

function moviePlayer(): Element | null {
  return document.querySelector('#movie_player') ?? document.querySelector('.html5-video-player');
}

/**
 * The reel currently on screen. YouTube moves one #shorts-player between reel
 * renderers as you scroll, so its ancestor is the most reliable anchor when
 * the [is-active] attribute isn't there.
 */
function activeReel(): Element | null {
  const player = document.querySelector('#shorts-player');
  return (
    document.querySelector('ytd-reel-video-renderer[is-active]') ??
    player?.closest('ytd-reel-video-renderer') ??
    player ??
    null
  );
}

function videoIn(scope: Element | null): HTMLVideoElement | null {
  if (!scope) return null;
  return (
    scope.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    scope.querySelector<HTMLVideoElement>('video')
  );
}

/**
 * Last resort when the container lookup fails: prefer a video that is actually
 * on screen and playing over a stale hidden one, so a bad guess still can't
 * hand back the 0:00 of a page you navigated away from.
 */
export function bestVisibleVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;

  for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
    const visible = video.clientWidth > 0 && video.clientHeight > 0;
    const score = (visible ? 4 : 0) + (video.paused ? 0 : 2) + (video.currentTime > 0 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = video;
    }
  }

  return best;
}

/** The player the toast's "End here" button reads. */
export function getPlayerVideo(): HTMLVideoElement | null {
  const page = detectPage();
  const scope = page?.kind === 'shorts' ? activeReel() : moviePlayer();
  return videoIn(scope) ?? bestVisibleVideo();
}

// ---------------------------------------------------------------------------
// titles
// ---------------------------------------------------------------------------

function scrapeWatchTitle(): string {
  const fromDom = firstText(document, [
    'ytd-watch-metadata h1 yt-formatted-string',
    'ytd-watch-metadata #title h1',
    '#title h1 yt-formatted-string',
    'h1.ytd-watch-metadata',
  ]);
  if (fromDom) return fromDom;

  const fromMeta = document.querySelector('meta[name="title"]')?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta;

  return cleanDocumentTitle();
}

function scrapeShortsTitle(scope: Element | null): string {
  const scoped = scope
    ? firstText(scope, [
        'h2 yt-formatted-string',
        '#video-title',
        '[id*="video-title"]',
        'h2 span',
        'h2',
      ])
    : null;
  if (scoped) return scoped;

  // document.title follows SPA navigation; the watch-page DOM does not.
  return cleanDocumentTitle();
}

function cleanDocumentTitle(): string {
  const cleaned = document.title
    .replace(/^\(\d+\)\s*/, '') // "(3) Title - YouTube" when tabs are unread
    .replace(/\s*-\s*YouTube\s*$/, '')
    .replace(/\s*#shorts\s*$/i, '')
    .trim();
  return cleaned || 'Untitled video';
}

// ---------------------------------------------------------------------------
// channel
// ---------------------------------------------------------------------------

/**
 * Returns the channel name plus either a canonical "UC…" id or an "@handle" —
 * channelUrl() in @moments/shared understands both.
 */
function scrapeOwner(kind: PageKind, scope: Element | null): {
  name: string | null;
  id: string | null;
} {
  if (kind === 'shorts') {
    // Scoped to the reel only. A document-wide anchor scan would happily
    // return a channel from the sidebar or the subscriptions rail.
    return scope ? ownerFromAnchors(scope) : { name: null, id: null };
  }

  const name =
    firstText(document, [
      'ytd-video-owner-renderer #channel-name a',
      '#owner #channel-name a',
      '#upload-info #channel-name a',
      'ytd-channel-name a',
    ]) ??
    document
      .querySelector('span[itemprop="author"] link[itemprop="name"]')
      ?.getAttribute('content')
      ?.trim() ??
    null;

  const ownerScope =
    document.querySelector('ytd-video-owner-renderer') ??
    document.querySelector('#owner') ??
    document.querySelector('#upload-info');

  const id =
    document.querySelector('meta[itemprop="channelId"]')?.getAttribute('content')?.trim() ||
    (ownerScope ? ownerFromAnchors(ownerScope).id : null) ||
    channelIdFromHref(
      document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href') ??
        '',
    );

  return { name: name || null, id: id || null };
}

function ownerFromAnchors(root: Element): { name: string | null; id: string | null } {
  let name: string | null = null;
  let canonical: string | null = null;
  let handle: string | null = null;

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    const found = channelIdFromHref(href);
    if (!found) continue;

    if (found.startsWith('UC')) canonical ??= found;
    else handle ??= found;

    const text = anchor.textContent?.replace(/\s+/g, ' ').trim();
    // Channel links wrapping only an avatar have no text; keep looking.
    if (!name && text && text.length <= 80) name = text;

    if (name && canonical) break;
  }

  return { name, id: canonical ?? handle };
}

function channelIdFromHref(href: string): string | null {
  const canonical = /\/channel\/(UC[\w-]{20,})/.exec(href);
  if (canonical?.[1]) return canonical[1];
  const named = /(?:^|youtube\.com)\/(@[\w.-]{3,})(?:$|[/?#])/.exec(href);
  return named?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// duration
// ---------------------------------------------------------------------------

function scrapeDuration(
  video: HTMLVideoElement,
  adShowing: boolean,
  kind: PageKind,
): number | null {
  // During an ad, video.duration is the ad's length — useless for the video row.
  if (!adShowing && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.round(video.duration);
  }
  // The microdata belongs to the watch page, so it lies about a Short.
  if (kind === 'shorts') return null;
  return parseIsoDuration(
    document.querySelector('meta[itemprop="duration"]')?.getAttribute('content') ?? '',
  );
}

/** "PT1H2M3S" -> 3723 */
export function parseIsoDuration(raw: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(raw.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return total > 0 ? Math.round(total) : null;
}

function firstText(root: Element | Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}
