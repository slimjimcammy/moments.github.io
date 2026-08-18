import { formatRange } from './time';
import { shortUrlAt } from './youtube';
import type { Moment } from './types';

/**
 * A paste-ready citation:
 *
 *   "First 100 customers came through cold outreach."
 *   — How I Built a $10M SaaS · Alex Chen (38:21)
 *   https://youtu.be/dQw4w9WgXcQ?t=2301
 */
export function buildCitation(moment: Moment): string {
  const lines: string[] = [];
  const note = moment.note?.trim();
  if (note) lines.push(`"${note}"`);

  const attribution = [moment.video.title, moment.video.channelName]
    .filter(Boolean)
    .join(' · ');
  lines.push(`— ${attribution} (${formatRange(moment.startSeconds, moment.endSeconds)})`);
  lines.push(shortUrlAt(moment.video.youtubeVideoId, moment.startSeconds));

  return lines.join('\n');
}
