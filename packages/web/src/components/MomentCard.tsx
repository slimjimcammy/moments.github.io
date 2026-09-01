import { useEffect, useRef, useState } from 'react';
import {
  buildCitation,
  channelUrl,
  formatRange,
  formatRelative,
  shortUrlAt,
  thumbnailUrl,
  watchUrlAt,
  type Moment,
} from '@moments/shared';

type Props = {
  moment: Moment;
  activeTags: string[];
  onNote: (note: string) => void;
  onTags: (tags: string[]) => void;
  onDelete: () => void;
  onTagClick: (name: string) => void;
  onCopy: (text: string, label: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

export function MomentCard({
  moment,
  activeTags,
  onNote,
  onTags,
  onDelete,
  onTagClick,
  onCopy,
  selectable = false,
  selected = false,
  onSelect,
}: Props) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(moment.note ?? '');
  const [addingTag, setAddingTag] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  // Enter commits the note and unmounts the textarea, which can also fire blur.
  // Without this the same edit would be sent twice.
  const noteCommitted = useRef(false);

  const watchUrl = watchUrlAt(moment.video.youtubeVideoId, moment.startSeconds);
  const channelHref = channelUrl(moment.video.channelId);
  const stamp = formatRange(moment.startSeconds, moment.endSeconds);

  useEffect(() => {
    if (!editingNote) setDraft(moment.note ?? '');
  }, [moment.note, editingNote]);

  useEffect(() => {
    if (!editingNote) return;
    noteCommitted.current = false;
    noteRef.current?.focus();
  }, [editingNote]);

  useEffect(() => {
    if (addingTag) tagRef.current?.focus();
  }, [addingTag]);

  // "Delete" arms, a second click confirms; it disarms itself if you walk away.
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  function commitNote(): void {
    if (noteCommitted.current) return;
    noteCommitted.current = true;
    setEditingNote(false);
    if ((moment.note ?? '') !== draft.trim()) onNote(draft);
  }

  function commitTag(raw: string): void {
    const name = raw.trim().replace(/^#+/, '').slice(0, 64);
    setAddingTag(false);
    if (!name) return;
    if (moment.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) return;
    onTags([...moment.tags, name]);
  }

  return (
    <article className="card">
      {selectable ? (
        <label className="moment-select">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select ${moment.video.title}`}
          />
        </label>
      ) : null}
      <a className="thumb" href={watchUrl} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden>
        <img
          src={moment.video.thumbnailUrl ?? thumbnailUrl(moment.video.youtubeVideoId)}
          alt=""
          loading="lazy"
          width={160}
          height={90}
        />
        <span className="thumb-stamp">{stamp}</span>
      </a>

      <div className="card-body">
        <h2 className="card-title">
          <a href={watchUrl} target="_blank" rel="noreferrer">
            {moment.video.title}
          </a>
        </h2>

        <p className="card-channel">
          {channelHref ? (
            <a href={channelHref} target="_blank" rel="noreferrer">
              {moment.video.channelName ?? 'Unknown channel'}
            </a>
          ) : (
            (moment.video.channelName ?? 'Unknown channel')
          )}
        </p>

        <p className="card-stamp">
          <a href={watchUrl} target="_blank" rel="noreferrer">
            {stamp}
          </a>
          <time dateTime={moment.createdAt}>saved {formatRelative(moment.createdAt)}</time>
        </p>

        {editingNote ? (
          <textarea
            ref={noteRef}
            className="note-editor"
            value={draft}
            rows={2}
            placeholder="What made this worth keeping?"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitNote();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(moment.note ?? '');
                setEditingNote(false);
              }
            }}
          />
        ) : moment.note ? (
          <blockquote className="note" onClick={() => setEditingNote(true)} title="Click to edit">
            {moment.note}
          </blockquote>
        ) : (
          <button className="note-add" type="button" onClick={() => setEditingNote(true)}>
            Add a note
          </button>
        )}

        <div className="tag-row">
          {moment.tags.map((tag) => {
            const active = activeTags.some((name) => name.toLowerCase() === tag.toLowerCase());
            return (
              <span className={`tag${active ? ' is-active' : ''}`} key={tag}>
                <button type="button" onClick={() => onTagClick(tag)} title={`Filter by ${tag}`}>
                  #{tag}
                </button>
                <button
                  type="button"
                  className="tag-remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onTags(moment.tags.filter((name) => name !== tag))}
                >
                  ✕
                </button>
              </span>
            );
          })}

          {addingTag ? (
            <input
              ref={tagRef}
              className="tag-input"
              list="moments-all-tags"
              placeholder="tag name"
              autoComplete="off"
              spellCheck={false}
              onBlur={(event) => commitTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  const { value } = event.currentTarget;
                  // Clear first so the blur that follows has nothing to commit.
                  event.currentTarget.value = '';
                  commitTag(value);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setAddingTag(false);
                }
              }}
            />
          ) : (
            <button className="tag-add" type="button" onClick={() => setAddingTag(true)}>
              + tag
            </button>
          )}
        </div>

        <div className="actions">
          <a className="action primary" href={watchUrl} target="_blank" rel="noreferrer">
            ▶ Watch
          </a>
          <button
            className="action"
            type="button"
            onClick={() => onCopy(buildCitation(moment), 'Citation copied')}
          >
            Copy Citation
          </button>
          <button
            className="action"
            type="button"
            onClick={() =>
              onCopy(shortUrlAt(moment.video.youtubeVideoId, moment.startSeconds), 'Link copied')
            }
          >
            Copy Link
          </button>
          <span className="spacer" />
          <button
            className={`action danger${confirmingDelete ? ' is-armed' : ''}`}
            type="button"
            onClick={() => {
              if (confirmingDelete) onDelete();
              else setConfirmingDelete(true);
            }}
          >
            {confirmingDelete ? 'Delete for good?' : 'Delete'}
          </button>
        </div>
      </div>
    </article>
  );
}
