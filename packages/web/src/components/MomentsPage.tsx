import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { MOMENT_LIMIT } from '../lib/api';
import { filterMoments, tagCounts } from '../lib/filter';
import { supabase } from '../lib/supabase';
import { useMoments } from '../hooks/useMoments';
import { MomentCard } from './MomentCard';

export function MomentsPage({ session }: { session: Session }) {
  const { moments, status, error, reload, setNote, setTags, remove } = useMoments(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  // Two passes: chip counts describe the search results, so they say what
  // clicking a chip would actually narrow to.
  const searched = useMemo(() => filterMoments(moments, { query, tags: [] }), [moments, query]);
  const counts = useMemo(() => tagCounts(searched), [searched]);
  const visible = useMemo(
    () => filterMoments(searched, { query: '', tags: selected }),
    [searched, selected],
  );
  const allTags = useMemo(() => tagCounts(moments).map((tag) => tag.name), [moments]);
  const videoCount = useMemo(
    () => new Set(moments.map((moment) => moment.video.id)).size,
    [moments],
  );

  const show = useCallback((message: string) => {
    setFlash(message);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2600) as unknown as number;
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // "/" jumps to search from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleTag = useCallback((name: string) => {
    setSelected((current) =>
      current.some((tag) => tag.toLowerCase() === name.toLowerCase())
        ? current.filter((tag) => tag.toLowerCase() !== name.toLowerCase())
        : [...current, name],
    );
  }, []);

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        show(label);
      } catch {
        show('Your browser blocked the clipboard.');
      }
    },
    [show],
  );

  const user = session.user;
  const avatar = (user.user_metadata?.avatar_url ?? user.user_metadata?.picture) as
    | string
    | undefined;
  const displayName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as
    | string
    | undefined;
  const filtering = query.trim().length > 0 || selected.length > 0;

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1>My Moments</h1>
          <p className="tally">
            {status === 'loading' && moments.length === 0
              ? 'Loading your library…'
              : `${moments.length} moment${moments.length === 1 ? '' : 's'} from ${videoCount} video${videoCount === 1 ? '' : 's'}`}
            {moments.length >= MOMENT_LIMIT ? ` · showing the newest ${MOMENT_LIMIT}` : ''}
          </p>
        </div>

        <div className="account">
          {avatar ? <img className="avatar" src={avatar} alt="" width={32} height={32} /> : null}
          <div className="account-who">
            <strong>{displayName ?? 'Signed in'}</strong>
            <span>{user.email}</span>
          </div>
          <button className="ghost" type="button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search titles, channels, notes, tags…"
            aria-label="Search moments"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          <kbd aria-hidden>/</kbd>
        </div>

        <div className="chips" role="group" aria-label="Filter by tag">
          <button
            type="button"
            className={`chip${selected.length === 0 ? ' is-active' : ''}`}
            onClick={() => setSelected([])}
          >
            All
          </button>
          {counts.map((tag) => (
            <button
              key={tag.name}
              type="button"
              className={`chip${
                selected.some((name) => name.toLowerCase() === tag.name.toLowerCase())
                  ? ' is-active'
                  : ''
              }`}
              onClick={() => toggleTag(tag.name)}
            >
              {tag.name}
              <span className="chip-count">{tag.count}</span>
            </button>
          ))}
        </div>
      </div>

      <datalist id="moments-all-tags">
        {allTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      {status === 'error' ? (
        <section className="panel panel-error">
          <h2>Could not load your moments</h2>
          <p>{error}</p>
          <button className="solid" type="button" onClick={() => void reload()}>
            Try again
          </button>
        </section>
      ) : status === 'loading' && moments.length === 0 ? (
        <div className="skeletons" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div className="skeleton" key={row} />
          ))}
        </div>
      ) : moments.length === 0 ? (
        <section className="panel">
          <h2>Nothing saved yet</h2>
          <p>
            Open any YouTube video and press <kbd>Alt</kbd>
            <kbd>Shift</kbd>
            <kbd>M</kbd>. The moment lands here instantly — the note and tags are optional.
          </p>
          <p className="muted">
            No extension installed yet? Load <code>packages/extension/dist</code> as an unpacked
            extension from <code>chrome://extensions</code>.
          </p>
        </section>
      ) : visible.length === 0 ? (
        <section className="panel">
          <h2>No moments match</h2>
          <p>Try a looser search or clear the tag filters.</p>
          <button
            className="solid"
            type="button"
            onClick={() => {
              setQuery('');
              setSelected([]);
            }}
          >
            Clear filters
          </button>
        </section>
      ) : (
        <>
          {filtering ? (
            <p className="result-count">
              {visible.length} match{visible.length === 1 ? '' : 'es'}
            </p>
          ) : null}
          <div className="list">
            {visible.map((moment) => (
              <MomentCard
                key={moment.id}
                moment={moment}
                activeTags={selected}
                onCopy={(text, label) => void copy(text, label)}
                onTagClick={toggleTag}
                onNote={(note) => {
                  void setNote(moment.id, note).then((failure) => failure && show(failure));
                }}
                onTags={(tags) => {
                  void setTags(moment.id, tags).then((failure) => failure && show(failure));
                }}
                onDelete={() => {
                  void remove(moment.id).then((failure) =>
                    show(failure ?? 'Moment deleted'),
                  );
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className={`flash${flash ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {flash}
      </div>
    </div>
  );
}
