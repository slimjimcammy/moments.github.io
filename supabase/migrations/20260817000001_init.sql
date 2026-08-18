-- ===========================================================================
-- Moments — core schema
--
-- users 1 -> many videos
-- users 1 -> many moments        videos 1 -> many moments
-- users 1 -> many tags           moments many <-> many tags (moment_tags)
--
-- Every table is protected by RLS keyed on auth.uid(); a signed-in user can
-- only ever see and write their own rows.
-- ===========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- helpers
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- users — one row per account, mirrored from auth.users
-- --------------------------------------------------------------------------
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users: read own row"
  on public.users for select
  using (id = auth.uid());

create policy "users: update own row"
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Rows are created by the trigger below (security definer), never by clients.

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do update
    set email        = excluded.email,
        display_name = coalesce(excluded.display_name, users.display_name),
        avatar_url   = coalesce(excluded.avatar_url, users.avatar_url);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_change();

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_change();

-- Accounts that signed in before this migration ran (easy to do while setting
-- the project up) would otherwise have no row here, and every save would fail
-- on the foreign key below.
insert into public.users (id, email, display_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  ),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- videos — YouTube videos the user has saved at least one moment from
-- --------------------------------------------------------------------------
create table public.videos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  youtube_video_id text not null,
  title            text not null,
  channel_name     text,
  -- Either a canonical channel id ("UC...") or a handle ("@handle"),
  -- whichever YouTube exposed on the page. See channelUrl() in @moments/shared.
  channel_id       text,
  thumbnail_url    text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  youtube_url      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint videos_user_youtube_id_key unique (user_id, youtube_video_id),
  -- lets moments carry a composite FK so a moment can never point at
  -- another user's video row
  constraint videos_user_id_id_key unique (user_id, id)
);

create index videos_user_id_created_at_idx on public.videos (user_id, created_at desc);

create trigger videos_set_updated_at
  before update on public.videos
  for each row execute function public.set_updated_at();

alter table public.videos enable row level security;

create policy "videos: read own"
  on public.videos for select using (user_id = auth.uid());
create policy "videos: insert own"
  on public.videos for insert with check (user_id = auth.uid());
create policy "videos: update own"
  on public.videos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "videos: delete own"
  on public.videos for delete using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- moments — the core object: one saved timestamp inside a video
-- --------------------------------------------------------------------------
create table public.moments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  video_id      uuid not null,
  start_seconds double precision not null check (start_seconds >= 0),
  end_seconds   double precision check (end_seconds is null or end_seconds >= start_seconds),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Named explicitly: the web UI's PostgREST embed disambiguates on it
  -- (videos!moments_video_id_fkey) because two FKs reach public.videos.
  constraint moments_video_id_fkey
    foreign key (video_id) references public.videos (id) on delete cascade,
  -- Belt and braces: a moment can never point at another user's video.
  constraint moments_video_same_owner_fkey
    foreign key (user_id, video_id) references public.videos (user_id, id) on delete cascade
);

create index moments_user_id_created_at_idx on public.moments (user_id, created_at desc);
create index moments_video_id_idx on public.moments (video_id);

create trigger moments_set_updated_at
  before update on public.moments
  for each row execute function public.set_updated_at();

alter table public.moments enable row level security;

create policy "moments: read own"
  on public.moments for select using (user_id = auth.uid());
create policy "moments: insert own"
  on public.moments for insert with check (user_id = auth.uid());
create policy "moments: update own"
  on public.moments for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "moments: delete own"
  on public.moments for delete using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- tags — reusable, per-user labels
-- --------------------------------------------------------------------------
create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 64),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: "SaaS" and "saas" are the same tag.
create unique index tags_user_id_lower_name_key on public.tags (user_id, lower(name));
create index tags_user_id_name_idx on public.tags (user_id, name);

alter table public.tags enable row level security;

create policy "tags: read own"
  on public.tags for select using (user_id = auth.uid());
create policy "tags: insert own"
  on public.tags for insert with check (user_id = auth.uid());
create policy "tags: update own"
  on public.tags for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tags: delete own"
  on public.tags for delete using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- moment_tags — join table
-- --------------------------------------------------------------------------
create table public.moment_tags (
  moment_id uuid not null references public.moments (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  primary key (moment_id, tag_id)
);

create index moment_tags_tag_id_idx on public.moment_tags (tag_id);

alter table public.moment_tags enable row level security;

create policy "moment_tags: read own"
  on public.moment_tags for select
  using (exists (
    select 1 from public.moments m
    where m.id = moment_tags.moment_id and m.user_id = auth.uid()
  ));

create policy "moment_tags: insert own"
  on public.moment_tags for insert
  with check (
    exists (
      select 1 from public.moments m
      where m.id = moment_tags.moment_id and m.user_id = auth.uid()
    )
    and exists (
      select 1 from public.tags t
      where t.id = moment_tags.tag_id and t.user_id = auth.uid()
    )
  );

create policy "moment_tags: delete own"
  on public.moment_tags for delete
  using (exists (
    select 1 from public.moments m
    where m.id = moment_tags.moment_id and m.user_id = auth.uid()
  ));
