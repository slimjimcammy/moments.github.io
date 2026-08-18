-- ===========================================================================
-- Moments — RPCs
--
-- save_moment() is what makes capture frictionless: the extension makes ONE
-- network call that upserts the video, inserts the moment, and resolves tags.
--
-- All functions are SECURITY INVOKER, so row level security still applies —
-- they are convenience wrappers, not privilege escalations.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- ensure_current_user() -> auth.uid()
--
-- public.users is normally filled by the trigger on auth.users, but a session
-- can predate that trigger. This is the one SECURITY DEFINER function here:
-- public.users has no INSERT policy, so the row has to be created out of band.
-- --------------------------------------------------------------------------
create or replace function public.ensure_current_user()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from users u where u.id = v_user) then
    return v_user;
  end if;

  insert into users (id, email, display_name, avatar_url)
  values (
    v_user,
    v_claims ->> 'email',
    coalesce(
      v_claims -> 'user_metadata' ->> 'full_name',
      v_claims -> 'user_metadata' ->> 'name',
      nullif(split_part(coalesce(v_claims ->> 'email', ''), '@', 1), '')
    ),
    coalesce(
      v_claims -> 'user_metadata' ->> 'avatar_url',
      v_claims -> 'user_metadata' ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  return v_user;
end;
$$;

-- --------------------------------------------------------------------------
-- set_moment_tags(moment, tag names) -> resolved tag names
--
-- Upserts the tags by case-insensitive name, then makes moment_tags match the
-- given list exactly. Tags left attached to nothing are pruned so the tag
-- filter row in the web UI never fills up with dead labels.
-- --------------------------------------------------------------------------
create or replace function public.set_moment_tags(
  p_moment_id uuid,
  p_tags      text[] default '{}'
)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_names text[];
  v_ids   uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- RLS makes this return nothing for someone else's moment.
  if not exists (select 1 from moments m where m.id = p_moment_id) then
    raise exception 'moment % not found', p_moment_id using errcode = 'no_data_found';
  end if;

  -- Trim, drop blanks, de-duplicate case-insensitively, cap the list length.
  select coalesce(array_agg(name order by name), '{}')
    into v_names
  from (
    select distinct on (lower(btrim(t))) btrim(t) as name
    from unnest(coalesce(p_tags, '{}'::text[])) as t
    where length(btrim(t)) between 1 and 64
    order by lower(btrim(t))
  ) s;

  v_names := v_names[1:32];

  if array_length(v_names, 1) > 0 then
    insert into tags (user_id, name)
    select v_user, n from unnest(v_names) as n
    on conflict (user_id, lower(name)) do nothing;

    select array_agg(t.id)
      into v_ids
    from tags t
    where t.user_id = v_user
      and lower(t.name) = any (select lower(n) from unnest(v_names) as n);
  end if;

  v_ids := coalesce(v_ids, '{}');

  delete from moment_tags mt
  where mt.moment_id = p_moment_id
    and not (mt.tag_id = any (v_ids));

  if array_length(v_ids, 1) > 0 then
    insert into moment_tags (moment_id, tag_id)
    select p_moment_id, id from unnest(v_ids) as id
    on conflict do nothing;
  end if;

  -- Prune now-orphaned tags belonging to this user.
  delete from tags t
  where t.user_id = v_user
    and not exists (select 1 from moment_tags mt where mt.tag_id = t.id);

  -- Return the canonical names actually attached (existing casing wins).
  return (
    select coalesce(array_agg(t.name order by t.name), '{}')
    from moment_tags mt
    join tags t on t.id = mt.tag_id
    where mt.moment_id = p_moment_id
  );
end;
$$;

-- --------------------------------------------------------------------------
-- save_moment(...) -> { moment_id, video_id, tags, deduped }
--
-- Called by the extension on the capture hotkey. Upserts the video row so
-- repeat captures from the same video share one row, then records the moment.
-- --------------------------------------------------------------------------
create or replace function public.save_moment(
  p_youtube_video_id text,
  p_title            text,
  p_start_seconds    double precision,
  p_channel_name     text default null,
  p_channel_id       text default null,
  p_thumbnail_url    text default null,
  p_duration_seconds integer default null,
  p_youtube_url      text default null,
  p_end_seconds      double precision default null,
  p_note             text default null,
  p_tags             text[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := ensure_current_user();
  v_video_id uuid;
  v_moment   uuid;
  v_tags     text[];
begin
  if coalesce(btrim(p_youtube_video_id), '') = '' then
    raise exception 'youtube_video_id is required' using errcode = '22023';
  end if;

  p_start_seconds := greatest(coalesce(p_start_seconds, 0), 0);

  insert into videos as v (
    user_id, youtube_video_id, title, channel_name, channel_id,
    thumbnail_url, duration_seconds, youtube_url
  )
  values (
    v_user,
    btrim(p_youtube_video_id),
    coalesce(nullif(btrim(p_title), ''), 'Untitled video'),
    nullif(btrim(p_channel_name), ''),
    nullif(btrim(p_channel_id), ''),
    nullif(btrim(p_thumbnail_url), ''),
    p_duration_seconds,
    coalesce(
      nullif(btrim(p_youtube_url), ''),
      'https://www.youtube.com/watch?v=' || btrim(p_youtube_video_id)
    )
  )
  on conflict (user_id, youtube_video_id) do update
    set title            = coalesce(nullif(btrim(excluded.title), 'Untitled video'), v.title),
        channel_name     = coalesce(excluded.channel_name, v.channel_name),
        channel_id       = coalesce(excluded.channel_id, v.channel_id),
        thumbnail_url    = coalesce(excluded.thumbnail_url, v.thumbnail_url),
        duration_seconds = coalesce(excluded.duration_seconds, v.duration_seconds),
        youtube_url      = coalesce(excluded.youtube_url, v.youtube_url),
        updated_at       = now()
  returning v.id into v_video_id;

  -- Key-repeat / double-tap guard: an all-but-identical moment saved seconds
  -- ago is the same intent, so hand back the existing row instead of a dupe.
  select m.id into v_moment
  from moments m
  where m.video_id = v_video_id
    and m.created_at > now() - interval '20 seconds'
    and abs(m.start_seconds - p_start_seconds) <= 1.5
  order by m.created_at desc
  limit 1;

  if v_moment is not null then
    return (
      select jsonb_build_object(
        'moment_id',   m.id,
        'video_id',    v_video_id,
        'note',        m.note,
        'end_seconds', m.end_seconds,
        'tags',        to_jsonb(coalesce((
          select array_agg(t.name order by t.name)
          from moment_tags mt join tags t on t.id = mt.tag_id
          where mt.moment_id = m.id
        ), '{}'::text[])),
        'deduped',     true
      )
      from moments m
      where m.id = v_moment
    );
  end if;

  insert into moments (user_id, video_id, start_seconds, end_seconds, note)
  values (
    v_user,
    v_video_id,
    p_start_seconds,
    case when p_end_seconds is null then null
         else greatest(p_end_seconds, p_start_seconds) end,
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_moment;

  v_tags := set_moment_tags(v_moment, p_tags);

  return jsonb_build_object(
    'moment_id',   v_moment,
    'video_id',    v_video_id,
    'note',        nullif(btrim(coalesce(p_note, '')), ''),
    'end_seconds', case when p_end_seconds is null then null
                        else greatest(p_end_seconds, p_start_seconds) end,
    'tags',        to_jsonb(v_tags),
    'deduped',     false
  );
end;
$$;

-- --------------------------------------------------------------------------
-- update_moment(...) -> { moment_id, tags }
--
-- Partial update used by both the capture toast (as you type a note) and the
-- web UI. NULL means "leave alone"; pass p_clear_end to erase an end time.
-- --------------------------------------------------------------------------
create or replace function public.update_moment(
  p_moment_id   uuid,
  p_note        text default null,
  p_end_seconds double precision default null,
  p_clear_end   boolean default false,
  p_tags        text[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tags text[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update moments m
     set note        = case when p_note is null then m.note
                            else nullif(btrim(p_note), '') end,
         end_seconds = case
                         when p_clear_end then null
                         when p_end_seconds is null then m.end_seconds
                         else greatest(p_end_seconds, m.start_seconds)
                       end
   where m.id = p_moment_id;

  if not found then
    raise exception 'moment % not found', p_moment_id using errcode = 'no_data_found';
  end if;

  if p_tags is not null then
    v_tags := set_moment_tags(p_moment_id, p_tags);
  else
    select coalesce(array_agg(t.name order by t.name), '{}')
      into v_tags
    from moment_tags mt join tags t on t.id = mt.tag_id
    where mt.moment_id = p_moment_id;
  end if;

  return jsonb_build_object('moment_id', p_moment_id, 'tags', to_jsonb(v_tags));
end;
$$;

-- --------------------------------------------------------------------------
-- delete_moment(id) — removes the moment, then any tags/video it orphaned.
-- --------------------------------------------------------------------------
create or replace function public.delete_moment(p_moment_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_video_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select video_id into v_video_id from moments where id = p_moment_id;
  if v_video_id is null then
    return false;
  end if;

  delete from moments where id = p_moment_id;

  delete from tags t
  where t.user_id = v_user
    and not exists (select 1 from moment_tags mt where mt.tag_id = t.id);

  delete from videos v
  where v.id = v_video_id
    and not exists (select 1 from moments m where m.video_id = v.id);

  return true;
end;
$$;

grant execute on function public.ensure_current_user() to authenticated;
grant execute on function public.set_moment_tags(uuid, text[]) to authenticated;
grant execute on function public.save_moment(
  text, text, double precision, text, text, text, integer, text,
  double precision, text, text[]
) to authenticated;
grant execute on function public.update_moment(uuid, text, double precision, boolean, text[]) to authenticated;
grant execute on function public.delete_moment(uuid) to authenticated;
