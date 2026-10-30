-- Sellout Radar: twee scores (Verwachte drukte vóór de verkoop, Uitverkoopkans tijdens de verkoop).
-- Uitvoeren in de SQL Editor van Supabase, na 0001_schema.sql. Veilig om vaker te draaien.

-- Scoregeschiedenis: welke score is het?
alter table score_snapshot add column if not exists kind text not null default 'sellout';
do $$ begin
  alter table score_snapshot add constraint score_snapshot_kind_check check (kind in ('rush', 'sellout'));
exception when duplicate_object then null; end $$;
create index if not exists score_snapshot_event_kind_idx on score_snapshot (event_id, kind, at desc);

-- Uitkomsten: per datum één uitkomst per score.
alter table outcome add column if not exists kind text not null default 'sellout';
alter table outcome add column if not exists outcome smallint;
update outcome set outcome = case when sold_out then 1 else 0 end where outcome is null;
do $$ begin
  alter table outcome add constraint outcome_kind_check check (kind in ('rush', 'sellout'));
exception when duplicate_object then null; end $$;
alter table outcome drop constraint if exists outcome_pkey;
do $$ begin
  alter table outcome add constraint outcome_pkey primary key (event_id, kind);
exception when invalid_table_definition or duplicate_object then null; end $$;

-- Modellen: één actief model per score.
alter table model_version add column if not exists kind text not null default 'sellout';
do $$ begin
  alter table model_version add constraint model_version_kind_check check (kind in ('rush', 'sellout'));
exception when duplicate_object then null; end $$;

-- De oude uitkomsten en scores (één score met negen factoren) passen niet bij de nieuwe modellen.
-- De updater negeert ze; ze blijven staan zodat er niets verloren gaat.
