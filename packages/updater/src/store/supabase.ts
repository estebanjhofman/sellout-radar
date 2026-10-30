import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_MODEL,
  DEFAULT_NOTIFY_SETTINGS,
  earliestInstant,
  isOfficial,
  SOURCE_RANK,
  type Artist,
  type ChangeLogEntry,
  type Claim,
  type Observation,
  type OutcomeRecord,
  type SalePhase,
  type ScoreModel,
  type SourceHealth,
  type SourceKind,
} from '@sellout/core';
import type { CatalogEvent, CatalogTour, CatalogVenue } from '../catalog';
import { emptyState, type RunDelta, type ScorePoint, type State } from '../state';
import type { PushTarget, RunSummary, Store } from './types';

type Row = Record<string, unknown>;

const DAY = 86_400_000;

/**
 * Opslag in Supabase (Postgres). Geschiedenis (beweringen, metingen, scores, wijzigingen)
 * wordt alleen aangevuld; de catalogus wordt per run bijgewerkt (upsert).
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string, private now: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async selectAll(table: string, build: (q: ReturnType<SupabaseClient['from']>['select']) => unknown, columns = '*'): Promise<Row[]> {
    const out: Row[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = build(this.db.from(table).select(columns) as any) as any;
      const { data, error } = await q.range(from, from + page - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data as Row[]) ?? []));
      if (!data || data.length < page) break;
    }
    return out;
  }

  private async check<T>(p: PromiseLike<{ error: { message: string } | null; data?: T }>, what: string): Promise<T | undefined> {
    const { error, data } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  }

  async load(): Promise<State> {
    const s = emptyState();
    const since = (days: number) => new Date(Date.parse(this.now) - days * DAY).toISOString();
    const id = <T>(q: T) => q;

    const [artists, tours, venues, events, phases, links] = await Promise.all([
      this.selectAll('artist', id),
      this.selectAll('tour', id),
      this.selectAll('venue', id),
      this.selectAll('event', id),
      this.selectAll('sale_phase', id),
      this.selectAll('sale_phase_event', id),
    ]);
    s.catalog.artists = artists.map(fromArtistRow);
    s.catalog.tours = tours.map(fromTourRow);
    s.catalog.venues = venues.map(fromVenueRow);
    s.catalog.events = events.map(fromEventRow);
    const byPhase = new Map<string, string[]>();
    for (const l of links) byPhase.set(String(l.phase_id), [...(byPhase.get(String(l.phase_id)) ?? []), String(l.event_id)]);
    s.catalog.phases = phases.map((r) => fromPhaseRow(r, byPhase.get(String(r.id)) ?? []));

    const [claims, observations, scores, outcomes, models, kv, sent, changes, sources, conflicts] = await Promise.all([
      this.selectAll('claim', (q: any) => q.gte('fetched_at', since(180)).is('superseded_at', null).order('fetched_at')),
      this.selectAll('observation', (q: any) => q.gte('observed_at', since(180)).order('observed_at')),
      this.selectAll('score_snapshot', (q: any) => q.gte('at', since(180)).order('at'), 'event_id,at,score,probability,confidence,model_version,features'),
      this.selectAll('outcome', id),
      this.selectAll('model_version', (q: any) => q.eq('active', true)),
      this.selectAll('kv', id),
      this.selectAll('notification', (q: any) => q.eq('channel', 'push').gte('sent_at', since(60)), 'key,user_id,sent_at'),
      this.selectAll('change_log', (q: any) => q.gte('at', since(60)).order('at')),
      this.selectAll('source', id),
      this.selectAll('conflict', (q: any) => q.eq('status', 'open')),
    ]);
    s.claims = claims.map(fromClaimRow);
    s.observations = observations.map((r) => ({
      entity: String(r.entity),
      metric: String(r.metric),
      value: r.value as Observation['value'],
      ...(r.dimension ? { dimension: String(r.dimension) } : {}),
      source: { name: String(r.source_name), kind: 'aggregator' as SourceKind, fetchedAt: iso(r.observed_at) },
      observedAt: iso(r.observed_at),
    }));
    for (const r of scores) {
      const pt: ScorePoint = {
        at: iso(r.at),
        score: Number(r.score),
        probability: Number(r.probability ?? Number(r.score) / 100),
        confidence: r.confidence as ScorePoint['confidence'],
        modelVersion: String(r.model_version),
        features: (r.features as number[] | null) ?? [],
      };
      (s.scoreHistory[String(r.event_id)] ??= []).push(pt);
    }
    s.outcomes = outcomes.map(
      (r): OutcomeRecord => ({
        eventId: String(r.event_id),
        predicted: Number(r.predicted ?? 0),
        outcome: r.sold_out ? 1 : 0,
        ...(r.features ? { features: r.features as number[] } : {}),
        ...(r.speed ? { speed: r.speed as OutcomeRecord['speed'] } : {}),
        resolvedAt: iso(r.resolved_at),
      }),
    );
    const active = models[0];
    s.model = active ? (active.model as ScoreModel) : structuredClone(DEFAULT_MODEL);
    for (const r of kv) s.kv[String(r.key)] = r.value;
    if (s.kv.lastChangeSnapshot) s.lastChangeSnapshot = s.kv.lastChangeSnapshot as State['lastChangeSnapshot'];
    if (s.kv.lastCalibration) s.lastCalibration = s.kv.lastCalibration as State['lastCalibration'];
    for (const r of sent) s.sent[`${r.key}|${r.user_id}`] = iso(r.sent_at);
    s.changes = changes.map(
      (r): ChangeLogEntry => ({
        at: iso(r.at),
        kind: r.kind as ChangeLogEntry['kind'],
        eventIds: (r.event_ids as string[]) ?? [],
        ...(r.phase_id ? { phaseId: String(r.phase_id) } : {}),
        text: String(r.text ?? ''),
      }),
    );
    for (const r of sources) {
      s.health[String(r.name)] = {
        name: String(r.name),
        kind: r.kind as SourceHealth['kind'],
        ok: !r.last_error,
        ...(r.last_attempt_at ? { lastAttemptAt: iso(r.last_attempt_at) } : {}),
        ...(r.last_success_at ? { lastSuccessAt: iso(r.last_success_at) } : {}),
        ...(r.last_error ? { message: String(r.last_error) } : {}),
      };
    }
    s.conflicts = conflicts.map((r) => ({
      entity: String(r.entity),
      field: String(r.field),
      chosen: r.chosen,
      alternatives: r.alternatives as State['conflicts'][number]['alternatives'],
      reason: String(r.reason ?? ''),
    }));
    return s;
  }

  async save(state: State, delta: RunDelta, run: RunSummary): Promise<void> {
    const db = this.db;
    const { data: runRow, error: runErr } = await db
      .from('fetch_run')
      .insert({ started_at: run.startedAt, finished_at: run.finishedAt, slot: run.slot, ok: run.ok, summary: { counts: run.counts, errors: run.errors } })
      .select('id')
      .single();
    if (runErr) throw new Error(`fetch_run: ${runErr.message}`);
    const runId = (runRow as { id: string }).id;

    const chunks = async (table: string, rows: Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean; upsert?: boolean }) => {
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500);
        const q = opts?.upsert
          ? db.from(table).upsert(part, { onConflict: opts.onConflict, ignoreDuplicates: opts.ignoreDuplicates ?? false })
          : db.from(table).insert(part);
        await this.check(q, table);
      }
    };

    const c = state.catalog;
    await chunks('artist', c.artists.map(toArtistRow), { upsert: true, onConflict: 'id' });
    await chunks('tour', c.tours.map(toTourRow), { upsert: true, onConflict: 'id' });
    await chunks('venue', c.venues.map(toVenueRow), { upsert: true, onConflict: 'id' });
    await chunks('event', c.events.map(toEventRow), { upsert: true, onConflict: 'id' });
    await chunks('sale_phase', c.phases.map(toPhaseRow), { upsert: true, onConflict: 'id' });
    const phaseIds = c.phases.map((p) => p.id);
    for (let i = 0; i < phaseIds.length; i += 200) {
      await this.check(db.from('sale_phase_event').delete().in('phase_id', phaseIds.slice(i, i + 200)), 'sale_phase_event');
    }
    const eventIds = new Set(c.events.map((e) => e.id));
    await chunks(
      'sale_phase_event',
      c.phases.flatMap((p) => p.eventIds.filter((e) => eventIds.has(e)).map((e) => ({ phase_id: p.id, event_id: e }))),
      { upsert: true, onConflict: 'phase_id,event_id', ignoreDuplicates: true },
    );

    await chunks('raw_document', delta.documents.map((d) => ({ source_name: d.sourceName, url: d.url, fetched_at: d.fetchedAt, content_hash: d.hash })), {
      upsert: true,
      onConflict: 'url,content_hash',
      ignoreDuplicates: true,
    });
    await chunks(
      'claim',
      delta.claims.map((cl) => ({
        entity: cl.entity,
        field: cl.field,
        value: cl.value as never,
        source_name: cl.source.name,
        source_kind: cl.source.kind,
        source_url: cl.source.url ?? null,
        fetched_at: cl.source.fetchedAt,
        official: isOfficial(cl.source),
        evidence: cl.evidence ?? null,
        run_id: runId,
      })),
    );
    await chunks(
      'observation',
      delta.observations.map((o) => ({
        entity: o.entity,
        metric: o.metric,
        dimension: o.dimension ?? null,
        value: o.value as never,
        source_name: o.source.name,
        observed_at: o.observedAt,
      })),
    );
    await chunks(
      'score_snapshot',
      delta.scorePoints
        .filter((p) => eventIds.has(p.eventId))
        .map((p) => ({
          event_id: p.eventId,
          at: p.point.at,
          model_version: p.point.modelVersion,
          score: p.point.score,
          probability: p.point.probability,
          confidence: p.point.confidence,
          features: p.point.features,
          factors: p.factors as never,
          explanation: p.explanation as never,
        })),
    );
    await chunks(
      'outcome',
      delta.outcomes
        .filter((o) => eventIds.has(o.eventId))
        .map((o) => ({
          event_id: o.eventId,
          sold_out: o.outcome === 1,
          speed: o.speed ?? null,
          predicted: o.predicted,
          features: o.features ?? null,
          resolved_at: o.resolvedAt ?? this.now,
        })),
      { upsert: true, onConflict: 'event_id' },
    );
    await chunks(
      'change_log',
      delta.changes.map((ch) => ({ at: ch.at, kind: ch.kind, event_ids: ch.eventIds, phase_id: ch.phaseId ?? null, text: ch.text })),
    );
    await chunks(
      'notification',
      delta.sent.map((n) => ({
        key: n.key,
        user_id: n.userId,
        kind: n.kind,
        event_ids: n.eventIds,
        phase_id: n.phaseId ?? null,
        ideal_at: n.idealAt,
        send_at: n.sendAt,
        channel: 'push',
        status: 'sent',
        sent_at: this.now,
        title: n.title,
        body: n.body,
      })),
      { upsert: true, onConflict: 'key,user_id', ignoreDuplicates: true },
    );
    await chunks('external_id', delta.externalIds.map((x) => ({ entity: x.entity, source: x.source, external_id: x.externalId })), {
      upsert: true,
      onConflict: 'source,external_id',
    });

    // Conflicten: open houden wat er nog is, de rest sluiten.
    await this.check(db.from('conflict').update({ status: 'resolved', resolved_at: this.now }).eq('status', 'open'), 'conflict');
    await chunks(
      'conflict',
      state.conflicts.map((cf) => ({
        entity: cf.entity,
        field: cf.field,
        chosen: cf.chosen as never,
        alternatives: cf.alternatives as never,
        reason: cf.reason,
        status: 'open',
        resolved_at: null,
      })),
      { upsert: true, onConflict: 'entity,field' },
    );

    if (delta.modelChanged) {
      await this.check(db.from('model_version').update({ active: false }).eq('active', true), 'model_version');
      await this.check(
        db.from('model_version').upsert(
          { version: state.model.version, model: state.model as never, trained_at: state.model.trainedAt ?? null, outcomes_used: state.model.outcomesUsed, active: true },
          { onConflict: 'version' },
        ),
        'model_version',
      );
    }

    const kvRows = Object.entries({ ...state.kv, lastChangeSnapshot: state.lastChangeSnapshot ?? null, lastCalibration: state.lastCalibration ?? null }).map(
      ([key, value]) => ({ key, value: (value ?? null) as never, updated_at: this.now }),
    );
    await chunks('kv', kvRows, { upsert: true, onConflict: 'key' });

    await chunks(
      'source',
      Object.values(state.health).map((h) => ({
        name: h.name,
        kind: h.kind,
        rank: h.kind in SOURCE_RANK ? SOURCE_RANK[h.kind as SourceKind] : 8,
        last_attempt_at: h.lastAttemptAt ?? null,
        last_success_at: h.lastSuccessAt ?? null,
        last_error: h.ok ? null : (h.message ?? 'fout'),
      })),
      { upsert: true, onConflict: 'name' },
    );
  }

  async pushTargets(): Promise<PushTarget[]> {
    const id = <T>(q: T) => q;
    const [devices, settings, follows] = await Promise.all([
      this.selectAll('device', (q: any) => q.not('push_token', 'is', null)),
      this.selectAll('settings', id),
      this.selectAll('follow', id),
    ]);
    const byUser = new Map<string, PushTarget>();
    const get = (userId: string): PushTarget => {
      let t = byUser.get(userId);
      if (!t) {
        t = {
          userId,
          tokens: [],
          settings: structuredClone(DEFAULT_NOTIFY_SETTINGS),
          scoreThreshold: 70,
          followedEvents: new Set(),
          followedTours: new Set(),
          followedArtists: new Set(),
          mutedEvents: new Set(),
          scheduledKeys: new Set(),
        };
        byUser.set(userId, t);
      }
      return t;
    };
    for (const d of devices) {
      const t = get(String(d.user_id));
      t.tokens.push(String(d.push_token));
      for (const k of (d.scheduled as string[] | null) ?? []) t.scheduledKeys.add(k);
      const sync = d.last_sync_at ? iso(d.last_sync_at) : undefined;
      if (sync && (!t.lastSyncAt || sync > t.lastSyncAt)) t.lastSyncAt = sync;
    }
    for (const r of settings) {
      const t = byUser.get(String(r.user_id));
      if (!t) continue;
      t.settings = {
        userTz: String(r.user_tz ?? 'Europe/Amsterdam'),
        quiet: { enabled: Boolean(r.quiet_enabled), start: String(r.quiet_start ?? '23:00'), end: String(r.quiet_end ?? '07:00') },
        leadHours: Math.max(12, Number(r.lead_hours ?? 12)),
        extraReminderMinutes: r.extra_reminder_minutes === null || r.extra_reminder_minutes === undefined ? null : Number(r.extra_reminder_minutes),
      };
      t.scoreThreshold = r.score_threshold === null || r.score_threshold === undefined ? null : Number(r.score_threshold);
    }
    for (const f of follows) {
      const t = byUser.get(String(f.user_id));
      if (!t) continue;
      const ref = String(f.ref);
      if (f.kind === 'event') (f.notify === false ? t.mutedEvents : t.followedEvents).add(ref);
      if (f.kind === 'tour' && f.notify !== false) t.followedTours.add(ref);
      if (f.kind === 'artist' && f.notify !== false) t.followedArtists.add(ref);
    }
    return [...byUser.values()].filter((t) => t.tokens.length > 0);
  }

  async removePushTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.check(this.db.from('device').update({ push_token: null }).in('push_token', tokens), 'device');
  }
}

// ---------------------------------------------------------------------------
// Rijen <-> domein
// ---------------------------------------------------------------------------

function iso(v: unknown): string {
  return new Date(String(v)).toISOString();
}

const toArtistRow = (a: Artist): Row => ({
  id: a.id,
  name: a.name,
  aliases: a.aliases ?? [],
  genres: a.genres ?? [],
  fandom: a.fandom ?? 'unknown',
  external_ids: a.externalIds ?? {},
});
const fromArtistRow = (r: Row): Artist => ({
  id: String(r.id),
  name: String(r.name),
  aliases: (r.aliases as string[]) ?? [],
  genres: (r.genres as string[]) ?? [],
  fandom: r.fandom as Artist['fandom'],
  externalIds: (r.external_ids as Record<string, string>) ?? {},
});

const toTourRow = (t: CatalogTour): Row => ({
  id: t.id,
  artist_id: t.artistId,
  name: t.name,
  leg: t.leg ?? null,
  announced_at: t.announcedAt ?? null,
  farewell: !!t.farewell,
  reunion: !!t.reunion,
  comeback: !!t.comeback,
});
const fromTourRow = (r: Row): CatalogTour => ({
  id: String(r.id),
  artistId: String(r.artist_id),
  name: String(r.name),
  ...(r.leg ? { leg: String(r.leg) } : {}),
  ...(r.announced_at ? { announcedAt: String(r.announced_at) } : {}),
  farewell: Boolean(r.farewell),
  reunion: Boolean(r.reunion),
  comeback: Boolean(r.comeback),
});

const toVenueRow = (v: CatalogVenue): Row => ({
  id: v.id,
  name: v.name,
  city: v.city,
  country: v.country,
  tz: v.tz,
  capacity: v.capacity ?? null,
  capacity_source: v.capacitySource ?? null,
  outdoor: v.outdoor ?? null,
  lat: v.lat ?? null,
  lon: v.lon ?? null,
});
const fromVenueRow = (r: Row): CatalogVenue => ({
  id: String(r.id),
  name: String(r.name),
  city: String(r.city),
  country: String(r.country),
  tz: String(r.tz),
  ...(r.capacity !== null && r.capacity !== undefined ? { capacity: Number(r.capacity) } : {}),
  ...(r.capacity_source ? { capacitySource: String(r.capacity_source) } : {}),
  ...(r.outdoor !== null && r.outdoor !== undefined ? { outdoor: Boolean(r.outdoor) } : {}),
  ...(r.lat !== null && r.lat !== undefined ? { lat: Number(r.lat) } : {}),
  ...(r.lon !== null && r.lon !== undefined ? { lon: Number(r.lon) } : {}),
});

const toEventRow = (e: CatalogEvent): Row => ({
  id: e.id,
  tour_id: e.tourId ?? null,
  venue_id: e.venueId,
  type: e.type,
  title: e.title,
  artist_ids: e.artistIds,
  date: e.date,
  local_date: e.date.localDate ?? null,
  starts_at: e.date.precision === 'exact' ? e.date.utc : null,
  status: e.status,
  added_show: !!e.addedShow,
  added_show_reason: e.addedShowReason ?? null,
  price_range: e.priceRange ?? null,
  ticket_limit: e.ticketLimit ?? null,
  official_sellers: e.officialSellers ?? null,
  verification: e.verification,
  notes: e.notes ?? [],
  sources: e.sources,
  updated_at: new Date().toISOString(),
});
const fromEventRow = (r: Row): CatalogEvent => ({
  id: String(r.id),
  ...(r.tour_id ? { tourId: String(r.tour_id) } : {}),
  venueId: String(r.venue_id),
  type: r.type as CatalogEvent['type'],
  title: String(r.title),
  artistIds: (r.artist_ids as string[]) ?? [],
  date: r.date as CatalogEvent['date'],
  status: r.status as CatalogEvent['status'],
  addedShow: Boolean(r.added_show),
  ...(r.added_show_reason ? { addedShowReason: String(r.added_show_reason) } : {}),
  ...(r.price_range ? { priceRange: r.price_range as CatalogEvent['priceRange'] } : {}),
  ...(r.ticket_limit !== null && r.ticket_limit !== undefined ? { ticketLimit: Number(r.ticket_limit) } : {}),
  ...(r.official_sellers ? { officialSellers: r.official_sellers as CatalogEvent['officialSellers'] } : {}),
  verification: r.verification as CatalogEvent['verification'],
  notes: (r.notes as string[]) ?? [],
  sources: (r.sources as CatalogEvent['sources']) ?? [],
  ...(r.first_seen_at ? { firstSeenAt: iso(r.first_seen_at) } : {}),
});

const toPhaseRow = (p: SalePhase): Row => ({
  id: p.id,
  kind: p.kind,
  type: p.type ?? null,
  name: p.name,
  region: p.region ?? null,
  start: p.start,
  end: p.end ?? null,
  deadline: p.deadline ?? null,
  draw_at: p.drawAt ?? null,
  start_utc: earliestInstant(p.start)?.toISO() ?? null,
  requires_code: p.requiresCode ?? null,
  where_to_register: p.whereToRegister ?? null,
  conditions: p.conditions ?? null,
  url: p.url ?? null,
  unlocks_phase_id: p.unlocksPhaseId ?? null,
  ticket_limit: p.ticketLimit ?? null,
  sources: p.sources,
  updated_at: new Date().toISOString(),
});
const fromPhaseRow = (r: Row, eventIds: string[]): SalePhase => ({
  id: String(r.id),
  kind: r.kind as SalePhase['kind'],
  ...(r.type ? { type: r.type as SalePhase['type'] } : {}),
  name: String(r.name),
  ...(r.region ? { region: String(r.region) } : {}),
  eventIds,
  start: r.start as SalePhase['start'],
  ...(r.end ? { end: r.end as SalePhase['end'] } : {}),
  ...(r.deadline ? { deadline: r.deadline as SalePhase['deadline'] } : {}),
  ...(r.draw_at ? { drawAt: r.draw_at as SalePhase['drawAt'] } : {}),
  ...(r.requires_code !== null && r.requires_code !== undefined ? { requiresCode: Boolean(r.requires_code) } : {}),
  ...(r.where_to_register ? { whereToRegister: String(r.where_to_register) } : {}),
  ...(r.conditions ? { conditions: String(r.conditions) } : {}),
  ...(r.url ? { url: String(r.url) } : {}),
  ...(r.unlocks_phase_id ? { unlocksPhaseId: String(r.unlocks_phase_id) } : {}),
  ...(r.ticket_limit !== null && r.ticket_limit !== undefined ? { ticketLimit: Number(r.ticket_limit) } : {}),
  sources: (r.sources as SalePhase['sources']) ?? [],
});

const fromClaimRow = (r: Row): Claim => ({
  entity: String(r.entity),
  field: String(r.field),
  value: r.value,
  source: {
    name: String(r.source_name),
    kind: r.source_kind as SourceKind,
    ...(r.source_url ? { url: String(r.source_url) } : {}),
    fetchedAt: iso(r.fetched_at),
  },
  ...(r.evidence ? { evidence: String(r.evidence) } : {}),
});
