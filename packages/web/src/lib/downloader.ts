import type { Moment } from '@moments/shared';

const DOWNLOADER_URL = 'http://127.0.0.1:8765';

export async function downloadClips(moments: Moment[]): Promise<void> {
  const clips = moments.map((moment) => {
    const youtubeUrl =
      moment.video.youtubeUrl ??
      `https://www.youtube.com/watch?v=${moment.video.youtubeVideoId}`;

    return {
      id: moment.id,
      youtubeUrl,
      startSeconds: moment.startSeconds,
      endSeconds: moment.endSeconds,
      note: moment.note,
    };
  });

  const response = await fetch(`${DOWNLOADER_URL}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clips }),
  });

  if (!response.ok) {
    throw new Error(
      'Could not connect to the local downloader. Make sure it is running.',
    );
  }

  const result = (await response.json()) as {
    results: Array<{
      id: string;
      success: boolean;
      error?: string;
    }>;
  };

  const failures = result.results.filter((item) => !item.success);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} clip${failures.length === 1 ? '' : 's'} failed to download.`,
    );
  }
}
