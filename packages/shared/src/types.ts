// ---------------------------------------------------------------------------
// Row shapes as they come back from PostgREST (snake_case).
// ---------------------------------------------------------------------------

export type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type VideoRow = {
  id: string;
  user_id: string;
  youtube_video_id: string;
  title: string;
  channel_name: string | null;
  channel_id: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  youtube_url: string | null;
  created_at: string;
  updated_at: string;
};

export type MomentRow = {
  id: string;
  user_id: string;
  video_id: string;
  start_seconds: number;
  end_seconds: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type TagRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

/** Shape of the embedded select used by the web UI (see MOMENT_SELECT). */
export type MomentJoinedRow = MomentRow & {
  video: VideoRow | null;
  moment_tags: Array<{ tag: Pick<TagRow, 'id' | 'name'> | null }> | null;
};

/** The PostgREST embed string that produces a MomentJoinedRow. */
export const MOMENT_SELECT = `
  id, user_id, video_id, start_seconds, end_seconds, note, created_at, updated_at,
  video:videos!moments_video_id_fkey (
    id, user_id, youtube_video_id, title, channel_name, channel_id,
    thumbnail_url, duration_seconds, youtube_url, created_at, updated_at
  ),
  moment_tags ( tag:tags ( id, name ) )
`;

// ---------------------------------------------------------------------------
// Normalized camelCase shape the UI actually renders.
// ---------------------------------------------------------------------------

export type MomentVideo = {
  id: string;
  youtubeVideoId: string;
  title: string;
  channelName: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  youtubeUrl: string | null;
};

export type Moment = {
  id: string;
  startSeconds: number;
  endSeconds: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  video: MomentVideo;
};

export function normalizeMoment(row: MomentJoinedRow): Moment | null {
  // A moment always has a video (composite FK), but the embed is nullable in
  // types, and a half-loaded row is not worth rendering.
  if (!row.video) return null;
  return {
    id: row.id,
    startSeconds: Number(row.start_seconds) || 0,
    endSeconds: row.end_seconds == null ? null : Number(row.end_seconds),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: (row.moment_tags ?? [])
      .map((link) => link.tag?.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b)),
    video: {
      id: row.video.id,
      youtubeVideoId: row.video.youtube_video_id,
      title: row.video.title,
      channelName: row.video.channel_name,
      channelId: row.video.channel_id,
      thumbnailUrl: row.video.thumbnail_url,
      durationSeconds: row.video.duration_seconds,
      youtubeUrl: row.video.youtube_url,
    },
  };
}

// ---------------------------------------------------------------------------
// RPC argument shapes (named args, as PostgREST expects them).
// ---------------------------------------------------------------------------

export type SaveMomentArgs = {
  p_youtube_video_id: string;
  p_title: string;
  p_start_seconds: number;
  p_channel_name?: string | null;
  p_channel_id?: string | null;
  p_thumbnail_url?: string | null;
  p_duration_seconds?: number | null;
  p_youtube_url?: string | null;
  p_end_seconds?: number | null;
  p_note?: string | null;
  p_tags?: string[];
};

export type SaveMomentResult = {
  moment_id: string;
  video_id: string;
  tags: string[];
  /** Present when `deduped` is true: whatever was already on that moment. */
  note: string | null;
  end_seconds: number | null;
  deduped: boolean;
};

export type UpdateMomentArgs = {
  p_moment_id: string;
  p_note?: string | null;
  p_end_seconds?: number | null;
  p_clear_end?: boolean;
  p_tags?: string[] | null;
};

export type UpdateMomentResult = {
  moment_id: string;
  tags: string[];
};
