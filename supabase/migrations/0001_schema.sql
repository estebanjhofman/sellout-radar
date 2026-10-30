-- Sellout Radar: schema voor Supabase (Postgres).
--
-- Catalogus en herkomst worden alleen door de updater geschreven (service role).
-- Gebruikersdata (apparaten, volgen, instellingen) schrijft de app zelf, na een
-- anonieme login; rijbeveiliging (RLS) zorgt dat iedereen alleen eigen rijen ziet.
--
-- Geschiedenis wordt nooit overschreven: claim, observation en score_snapshot
-- worden alleen aangevuld.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Catalogus
-- ---------------------------------------------------------------------------

create table if not exists artist (
  id text primary key,
  name text not null,
  aliases text[] not null default '{}',
  genres text[] not null default '{}',
  fandom text not null default 'unknown' check (fandom in ('organized', 'regular', 'unknown')),
  external_ids jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists tour (
  id text primary key,
  artist_id text references artist (id) on delete cascade,
  name text not null,
  leg text,
  announced_at date,
  farewell boolean not null default false,
  reunion boolean not null default false,
  comeback boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists venue (
  id text primary key,
  name text not null,
  city text not null,
  country char(2) not null,
  tz text not null,
  capacity integer,
  capacity_source text,
  outdoor boolean,
  lat double precision,
  lon double precision,
  updated_at timestamptz not null default now()
);

create table if not exists event (
  id text primary key,
  tour_id text references tour (id) on delete set null,
  venue_id text references venue (id) on delete restrict,
  type text not null check (type in ('concert', 'festival', 'sport', 'theatre', 'comedy', 'other')),
  title text not null,
  artist_ids text[] not null default '{}',
  -- TimePoint met precisie (exact, date, month, unknown); local_date en starts_at zijn afgeleid.
  date jsonb not null,
  local_date date,
  starts_at timestamptz,
  status text not null check (status in ('announced', 'onsale', 'few_left', 'soldout', 'cancelled', 'postponed')),
  added_show boolean not null default false,
  added_show_reason text,
  price_range jsonb,
  ticket_limit integer,
  official_sellers jsonb,
  verification text not null default 'official' check (verification in ('official', 'unconfirmed')),
  notes text[] not null default '{}',
  sources jsonb not null default '[]',
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_local_date_idx on event (local_date);

create table if not exists sale_phase (
  id text primary key,
  kind text not null check (kind in ('registration', 'presale', 'general_sale', 'lottery')),
  type text,
  name text not null,
  region text,
  start jsonb not null,
  "end" jsonb,
  deadline jsonb,
  draw_at jsonb,
  -- Vroegst mogelijke start in UTC (null als onbekend), voor sorteren en zoeken.
  start_utc timestamptz,
  requires_code boolean,
  where_to_register text,
  conditions text,
  url text,
  unlocks_phase_id text,
  ticket_limit integer,
  sources jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists sale_phase_event (
  phase_id text not null references sale_phase (id) on delete cascade,
  event_id text not null references event (id) on delete cascade,
  primary key (phase_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Herkomst
-- ---------------------------------------------------------------------------

create table if not exists source (
  name text primary key,
  kind text not null,
  rank integer not null,
  terms_url text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text
);

create table if not exists fetch_run (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  slot text,
  ok boolean,
  summary jsonb
);

create table if not exists raw_document (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  url text not null,
  fetched_at timestamptz not null,
  content_hash text not null,
  -- Alleen bewaard als de voorwaarden van de bron dat toestaan.
  content text,
  unique (url, content_hash)
);

create table if not exists claim (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  field text not null,
  value jsonb,
  source_name text not null,
  source_kind text not null,
  source_url text,
  fetched_at timestamptz not null,
  official boolean not null,
  evidence text,
  document_id uuid references raw_document (id) on delete set null,
  run_id uuid references fetch_run (id) on delete set null,
  superseded_at timestamptz
);
create index if not exists claim_entity_field_idx on claim (entity, field);
create index if not exists claim_fetched_idx on claim (fetched_at desc);

create table if not exists conflict (
  entity text not null,
  field text not null,
  chosen jsonb,
  alternatives jsonb not null,
  reason text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (entity, field)
);

create table if not exists external_id (
  entity text not null,
  source text not null,
  external_id text not null,
  primary key (source, external_id)
);

-- ---------------------------------------------------------------------------
-- Metingen en score
-- ---------------------------------------------------------------------------

create table if not exists observation (
  id bigserial primary key,
  entity text not null,
  metric text not null,
  dimension text,
  value jsonb not null,
  source_name text not null,
  observed_at timestamptz not null
);
create index if not exists observation_lookup_idx on observation (entity, metric, observed_at desc);

create table if not exists score_snapshot (
  id bigserial primary key,
  event_id text not null references event (id) on delete cascade,
  at timestamptz not null,
  model_version text not null,
  score integer not null check (score between 0 and 100),
  probability real,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  coverage real,
  features real[],
  factors jsonb not null default '[]',
  explanation jsonb
);
create index if not exists score_snapshot_event_idx on score_snapshot (event_id, at desc);

create table if not exists outcome (
  event_id text primary key references event (id) on delete cascade,
  sold_out boolean not null,
  sold_out_at timestamptz,
  hours_to_soldout real,
  speed text check (speed in ('presale', 'day1', 'week1', 'later')),
  predicted real,
  features real[],
  source jsonb,
  resolved_at timestamptz not null
);

create table if not exists model_version (
  version text primary key,
  model jsonb not null,
  trained_at timestamptz,
  outcomes_used integer not null default 0,
  brier real,
  log_loss real,
  active boolean not null default false
);

-- Kleine sleutel-waardeopslag voor de updater (hashes van gevolgde pagina's, verwerkt nieuws, enz.).
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists change_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  entity text,
  event_ids text[] not null default '{}',
  phase_id text,
  old_value jsonb,
  new_value jsonb,
  source jsonb,
  text text
);
create index if not exists change_log_at_idx on change_log (at desc);

-- ---------------------------------------------------------------------------
-- Gebruiker (via anonieme login in de app)
-- ---------------------------------------------------------------------------

create table if not exists device (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  push_token text unique,
  platform text,
  last_sync_at timestamptz,
  -- Sleutels van meldingen die het toestel lokaal heeft ingepland.
  scheduled text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  user_tz text not null default 'Europe/Amsterdam',
  quiet_enabled boolean not null default true,
  quiet_start text not null default '23:00',
  quiet_end text not null default '07:00',
  lead_hours integer not null default 12 check (lead_hours >= 12),
  extra_reminder_minutes integer,
  -- Meldingen standaard aan vanaf deze score (null = alleen gevolgde data).
  score_threshold integer default 70,
  updated_at timestamptz not null default now()
);

create table if not exists follow (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('artist', 'tour', 'event')),
  ref text not null,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

create table if not exists notification (
  key text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  event_ids text[] not null default '{}',
  phase_id text,
  ideal_at timestamptz,
  send_at timestamptz,
  channel text not null check (channel in ('local', 'push')),
  status text not null default 'sent' check (status in ('planned', 'sent', 'failed')),
  sent_at timestamptz,
  title text,
  body text,
  primary key (key, user_id)
);

-- Registreert een pushtoken voor de ingelogde (anonieme) gebruiker. Een token dat al bij een
-- eerdere installatie hoorde, verhuist naar de huidige gebruiker.
create or replace function register_device(p_token text, p_platform text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;
  delete from device where push_token = p_token and user_id <> auth.uid();
  insert into device (user_id, push_token, platform, last_sync_at)
  values (auth.uid(), p_token, p_platform, now())
  on conflict (push_token) do update set last_sync_at = now(), platform = excluded.platform
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rijbeveiliging
-- ---------------------------------------------------------------------------

alter table device enable row level security;
alter table settings enable row level security;
alter table follow enable row level security;
alter table notification enable row level security;

create policy "eigen apparaten" on device for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigen instellingen" on settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigen volglijst" on follow for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigen meldingen lezen" on notification for select to authenticated
  using (auth.uid() = user_id);

-- Catalogus en scores zijn openbare gegevens: alleen-lezen voor de app, schrijven alleen via de service role.
do $$
declare
  t text;
begin
  foreach t in array array['artist', 'tour', 'venue', 'event', 'sale_phase', 'sale_phase_event', 'source',
                           'score_snapshot', 'outcome', 'model_version', 'change_log', 'conflict']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "openbaar lezen" on %I for select to anon, authenticated using (true)', t);
  end loop;
end;
$$;

-- Interne tabellen van de updater: geen toegang voor de app.
alter table fetch_run enable row level security;
alter table raw_document enable row level security;
alter table claim enable row level security;
alter table external_id enable row level security;
alter table observation enable row level security;
alter table kv enable row level security;

grant execute on function register_device(text, text) to authenticated;
