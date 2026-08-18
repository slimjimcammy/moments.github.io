import { useCallback, useEffect, useState } from 'react';
import type { Moment } from '@moments/shared';
import { deleteMoment, fetchMoments, patchMoment } from '../lib/api';

type Status = 'loading' | 'ready' | 'error';

/**
 * Owns the library. Mutations apply locally first and roll back if the request
 * fails, so editing a note never waits on the network; the returned string is
 * an error message for the caller to surface (null on success).
 */
export function useMoments(enabled: boolean) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      setMoments(await fetchMoments());
      setError(null);
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setMoments([]);
      setStatus('loading');
      return;
    }
    void reload();
  }, [enabled, reload]);

  const replace = useCallback((id: string, change: (moment: Moment) => Moment) => {
    setMoments((current) => current.map((moment) => (moment.id === id ? change(moment) : moment)));
  }, []);

  const setNote = useCallback(
    async (id: string, note: string): Promise<string | null> => {
      const previous = moments.find((moment) => moment.id === id)?.note ?? null;
      const next = note.trim() || null;
      if (next === previous) return null;

      replace(id, (moment) => ({ ...moment, note: next }));
      try {
        await patchMoment(id, { note });
        return null;
      } catch (cause) {
        replace(id, (moment) => ({ ...moment, note: previous }));
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [moments, replace],
  );

  const setTags = useCallback(
    async (id: string, tags: string[]): Promise<string | null> => {
      const previous = moments.find((moment) => moment.id === id)?.tags ?? [];
      replace(id, (moment) => ({ ...moment, tags }));
      try {
        // The server returns canonical casing, e.g. "saas" -> existing "SaaS".
        const settled = await patchMoment(id, { tags });
        replace(id, (moment) => ({ ...moment, tags: settled }));
        return null;
      } catch (cause) {
        replace(id, (moment) => ({ ...moment, tags: previous }));
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [moments, replace],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const snapshot = moments;
      setMoments((current) => current.filter((moment) => moment.id !== id));
      try {
        await deleteMoment(id);
        return null;
      } catch (cause) {
        setMoments(snapshot);
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [moments],
  );

  return { moments, status, error, reload, setNote, setTags, remove };
}
