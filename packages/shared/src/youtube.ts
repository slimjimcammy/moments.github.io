/** Full watch URL that resumes at the given second. */
export function watchUrlAt(youtubeVideoId: string, startSeconds: number): string {
  const t = Math.max(0, Math.floor(startSeconds || 0));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}&t=${t}s`;
}

/** Short share URL that resumes at the given second — nicer inside citations. */
export function shortUrlAt(youtubeVideoId: string, startSeconds: number): string {
  const t = Math.max(0, Math.floor(startSeconds || 0));
  return `https://youtu.be/${encodeURIComponent(youtubeVideoId)}?t=${t}`;
}

/** Always-available 320x180 thumbnail. */
export function thumbnailUrl(youtubeVideoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/mqdefault.jpg`;
}

/**
 * videos.channel_id holds whatever YouTube exposed: a canonical "UC..." id or
 * an "@handle". Both map onto a channel URL, just differently.
 */
export function channelUrl(channelId?: string | null): string | null {
  const id = channelId?.trim();
  if (!id) return null;
  if (id.startsWith('@')) return `https://www.youtube.com/${id}`;
  if (/^UC[\w-]{20,}$/.test(id)) return `https://www.youtube.com/channel/${id}`;
  return null;
}

/** Pulls the video id out of any YouTube URL shape we might be sitting on. */
export function parseVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    return sanitizeId(url.pathname.slice(1));
  }

  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

  if (url.pathname === '/watch') return sanitizeId(url.searchParams.get('v') ?? '');

  const path = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
  if (path?.[1]) return sanitizeId(path[1]);

  return null;
}

function sanitizeId(candidate: string): string | null {
  const id = candidate.trim();
  return /^[\w-]{6,20}$/.test(id) ? id : null;
}
