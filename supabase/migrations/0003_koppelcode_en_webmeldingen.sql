-- Sellout Radar: koppelcode (telefoon en computer delen dezelfde lijsten) en meldingen in de browser.
-- Uitvoeren in Supabase → SQL Editor, na 0001 en 0002. Mag vaker worden uitgevoerd.

-- ---------------------------------------------------------------------------
-- Koppelcode
-- ---------------------------------------------------------------------------
-- Alle apparaten met dezelfde koppelcode delen hun sterren, tickets en inschrijvingen.
-- De code zelf staat niet in de database, alleen een hash ervan. Er zijn geen toegangsregels
-- voor de tabel: lezen en schrijven kan alleen via de twee functies hieronder, en alleen met de code.

create table if not exists pref_sync (
  code_hash text primary key,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table pref_sync enable row level security;

create or replace function sync_get(p_code text)
returns table (prefs jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select s.prefs, s.updated_at
  from pref_sync s
  where length(p_code) >= 16
    and s.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
$$;

create or replace function sync_put(p_code text, p_prefs jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := clock_timestamp();
begin
  if length(p_code) < 16 then
    raise exception 'ongeldige koppelcode';
  end if;
  if octet_length(p_prefs::text) > 500000 then
    raise exception 'te veel gegevens';
  end if;
  insert into pref_sync (code_hash, prefs, updated_at)
  values (encode(sha256(convert_to(p_code, 'UTF8')), 'hex'), p_prefs, v_at)
  on conflict (code_hash) do update set prefs = excluded.prefs, updated_at = excluded.updated_at;
  return v_at;
end;
$$;

revoke all on function sync_get(text) from public;
revoke all on function sync_put(text, jsonb) from public;
grant execute on function sync_get(text) to anon, authenticated;
grant execute on function sync_put(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tickets: wijzigingen wel melden, verkoopherinneringen niet
-- ---------------------------------------------------------------------------

alter table follow drop constraint if exists follow_kind_check;
alter table follow add constraint follow_kind_check check (kind in ('artist', 'tour', 'event', 'owned'));
