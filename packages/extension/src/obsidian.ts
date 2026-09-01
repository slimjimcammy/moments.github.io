import type { SavedMoment } from './messages';

export async function exportSavedMomentToObsidian(
  moment: SavedMoment,
): Promise<void> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('Obsidian export requires a Chromium-based browser.');
  }

  const directory = await window.showDirectoryPicker({
    mode: 'readwrite',
    id: 'moments-obsidian-export',
  });

  const fileName = obsidianFileName(moment.note ?? moment.title);
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();

  try {
    await writable.write(momentToObsidian(moment));
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Ignore cleanup failure.
    }
    throw error;
  }
}

function momentToObsidian(moment: SavedMoment): string {
  const tags = moment.tags
    .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, '-'))
    .filter(Boolean);

  const tagLines = tags.length
    ? tags.map((tag) => `  - ${escapeYaml(tag)}`).join('\n')
    : '  []';

  const youtubeUrl =
    `https://www.youtube.com/watch?v=${moment.youtubeVideoId}`;

  const timestamp = `${formatTimestamp(moment.startSeconds)}${
    moment.endSeconds == null
      ? ''
      : ` – ${formatTimestamp(moment.endSeconds)}`
  }`;

  return `---
title: "${escapeYaml(moment.title)}"
youtube: "${escapeYaml(youtubeUrl)}"
start_seconds: ${Math.round(moment.startSeconds)}
end_seconds: ${
    moment.endSeconds == null ? 'null' : Math.round(moment.endSeconds)
  }
tags:
${tagLines}
---

# ${moment.title}

![Thumbnail](https://i.ytimg.com/vi/${moment.youtubeVideoId}/maxresdefault.jpg)

**${timestamp}**

[Watch on YouTube](${youtubeUrl}&t=${Math.round(moment.startSeconds)}s)

${moment.note ? `> ${moment.note.replace(/\r?\n/g, '\n> ')}` : ''}
`;
}

function obsidianFileName(titleOrNote: string): string {
  const base = titleOrNote.trim().slice(0, 20) || 'Untitled Moment';

  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleaned || 'Untitled Moment'}.md`;
}

function escapeYaml(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
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
