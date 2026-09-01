import { thumbnailUrl, watchUrlAt } from './youtube';
import type { Moment } from './types';

export type ObsidianMoment = {
  id: string;
  title: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  startSeconds: number;
  endSeconds: number | null;
  note: string | null;
  tags: string[];
};

export function momentToObsidian(moment: ObsidianMoment): string {
  const tags = moment.tags
    .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, '-'))
    .filter(Boolean);

  const title = escapeYaml(moment.title);
  const youtube = escapeYaml(moment.youtubeUrl);
  const thumbnail = escapeYaml(moment.thumbnailUrl);

  const tagLines = tags.length
    ? tags.map((tag) => `  - ${escapeYaml(tag)}`).join('\n')
    : '  []';

  return `---
title: "${title}"
youtube: "${youtube}"
start_seconds: ${Math.round(moment.startSeconds)}
end_seconds: ${moment.endSeconds == null ? 'null' : Math.round(moment.endSeconds)}
tags:
${tagLines}
---

# ${moment.title}

![Thumbnail](${moment.thumbnailUrl})

**${formatTimestamp(moment.startSeconds)}${moment.endSeconds == null ? '' : ` – ${formatTimestamp(moment.endSeconds)}`}**

[Watch on YouTube](${watchUrlAt(extractVideoId(moment.youtubeUrl), moment.startSeconds)})

${moment.note ? `> ${moment.note.replace(/\n/g, '\n> ')}` : ''}
`;
}

export function momentToObsidianFromMoment(moment: Moment): string {
  return momentToObsidian({
    id: moment.id,
    title: moment.video.title,
    thumbnailUrl:
      moment.video.thumbnailUrl ?? thumbnailUrl(moment.video.youtubeVideoId),
    youtubeUrl:
      moment.video.youtubeUrl ?? `https://www.youtube.com/watch?v=${moment.video.youtubeVideoId}`,
    startSeconds: moment.startSeconds,
    endSeconds: moment.endSeconds,
    note: moment.note,
    tags: moment.tags,
  });
}

export function obsidianFileName(titleOrNote: string): string {
  const base = titleOrNote.trim().slice(0, 20) || 'Untitled Moment';

  return `${base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Moment'}.md`;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function extractVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('v') ?? '';
  } catch {
    return '';
  }
}
