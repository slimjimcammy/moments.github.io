import {
  MOMENT_SELECT,
  normalizeMoment,
  type Moment,
  type MomentJoinedRow,
  type UpdateMomentArgs,
  type UpdateMomentResult,
} from '@moments/shared';
import { supabase } from './supabase';

/**
 * The whole library is loaded once and filtered in the browser: search stays
 * instant with no round trips, and a personal collection is small. The cap is
 * here so a pathological account degrades visibly rather than silently.
 */
export const MOMENT_LIMIT = 2000;

export async function fetchMoments(): Promise<Moment[]> {
  const { data, error } = await supabase
    .from('moments')
    .select(MOMENT_SELECT)
    .order('created_at', { ascending: false })
    .limit(MOMENT_LIMIT);

  if (error) throw new Error(describe(error));

  const rows = (data ?? []) as unknown as MomentJoinedRow[];
  return rows.map(normalizeMoment).filter((moment): moment is Moment => moment !== null);
}

export type MomentPatch = {
  note?: string | null;
  tags?: string[];
  endSeconds?: number | null;
  clearEnd?: boolean;
};

/** Returns the tag names the server settled on (canonical casing wins). */
export async function patchMoment(momentId: string, patch: MomentPatch): Promise<string[]> {
  const args: UpdateMomentArgs = {
    p_moment_id: momentId,
    p_note: patch.note ?? null,
    p_end_seconds: patch.endSeconds ?? null,
    p_clear_end: patch.clearEnd ?? false,
    p_tags: patch.tags ?? null,
  };

  const { data, error } = await supabase.rpc('update_moment', args);
  if (error) throw new Error(describe(error));
  return (data as UpdateMomentResult | null)?.tags ?? [];
}

export async function deleteMoment(momentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_moment', { p_moment_id: momentId });
  if (error) throw new Error(describe(error));
}

function describe(error: { message: string; code?: string }): string {
  if (error.code === 'PGRST202') {
    return 'This database is missing the Moments functions — run supabase/migrations.';
  }
  if (error.code === '42P01') {
    return 'This database has no Moments tables yet — run supabase/migrations.';
  }
  if (error.code === '42501' || /jwt/i.test(error.message)) {
    return 'Your session expired. Sign in again.';
  }
  return error.message || 'Supabase request failed.';
}
