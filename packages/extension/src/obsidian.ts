import {
  momentToObsidian,
  obsidianFileName,
  thumbnailUrl,
} from '@moments/shared';
import type { SavedMoment } from './messages';

export async function exportSavedMomentToObsidian(
  moment: SavedMoment,
): Promise<void> {
  const showDirectoryPicker = (
    window as Window & {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite';
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  if (!showDirectoryPicker) {
    throw new Error('Obsidian export requires a Chromium-based browser.');
  }

  const directory = await showDirectoryPicker({
    mode: 'readwrite',
    id: 'moments-obsidian-export',
  });

  const fileName = obsidianFileName(moment.note ?? moment.title);
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();

  const youtubeUrl = `https://www.youtube.com/watch?v=${moment.youtubeVideoId}`;

  try {
    await writable.write(
      momentToObsidian({
        id: moment.momentId,
        title: moment.title,
        thumbnailUrl: thumbnailUrl(moment.youtubeVideoId),
        youtubeUrl,
        startSeconds: moment.startSeconds,
        endSeconds: moment.endSeconds,
        note: moment.note,
        tags: moment.tags,
      }),
    );

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
