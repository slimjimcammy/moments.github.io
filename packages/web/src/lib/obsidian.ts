import {
  momentToObsidianFromMoment,
  obsidianFileName,
  type Moment,
} from '@moments/shared';

export async function exportMomentsToObsidian(moments: Moment[]): Promise<number> {
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

  if (moments.length === 0) {
    throw new Error('Select at least one moment to export.');
  }

  const directory = await showDirectoryPicker({
    mode: 'readwrite',
    id: 'moments-obsidian-export',
  });

  const usedNames = new Set<string>();
  let exported = 0;

  for (const moment of moments) {
    const baseName = obsidianFileName(moment.note ?? moment.video.title);
    const fileName = uniqueFileName(baseName, usedNames);

    const file = await directory.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();

    try {
      await writable.write(momentToObsidianFromMoment(moment));
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // Ignore cleanup failure.
      }
      throw error;
    }

    exported += 1;
  }

  return exported;
}

function uniqueFileName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  const dot = baseName.lastIndexOf('.');
  const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
  const extension = dot >= 0 ? baseName.slice(dot) : '';

  let counter = 2;
  let candidate = `${stem} (${counter})${extension}`;

  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${stem} (${counter})${extension}`;
  }

  usedNames.add(candidate);
  return candidate;
}
