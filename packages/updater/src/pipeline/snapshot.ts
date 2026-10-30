import { DateTime } from 'luxon';
import {
  accuracySummary,
  explainScore,
  scoreBand,
  scoreTrend,
  SNAPSHOT_SCHEMA_VERSION,
  type ArtistPopularity,
  type ChangeLogEntry,
  type Conflict,
  type EventDate,
  type FrozenRush,
  type Observation,
  type OutcomeRecord,
  type RushCheck,
  type SaleStage,
  type ScoreKind,
  type ScoreModel,
  type ScoreResult,
  type Snapshot,
  type SnapshotEvent,
  type SnapshotScore,
  type SourceHealth,
  type SourceRef,
} from '@sellout/core';
import type { Catalog, CatalogEvent } from '../catalog';
import { isYouTubeObservation, YOUTUBE_RETENTION_DAYS, type FrozenRushState, type ScorePoint } from '../state';
import { growth, latestValue } from './inputs';
import { rushOutcomeText } from './outcomes';

export interface EventScores {
  stage: SaleStage;
  firstSaleAt?: string;
  /** Verwachte drukte (bij "al in de verkoop": achteraf geschat, zonder verkoop elders). */
  rush: ScoreResult;
  sellout: ScoreResult;
}

export interface SnapshotInput {
  catalog: Catalog;
  scores: Map<string, EventScores>;
  history: Record<string, ScorePoint[]>;
  rushFinal: Record<string, FrozenRushState>;
  conflicts: Conflict[];
  health: Record<string, SourceHealth>;
  changes: ChangeLogEntry[];
  outcomes: OutcomeRecord[];
  rushOutcomes: OutcomeRecord[];
  models: Record<ScoreKind, ScoreModel>;
  /** Alle metingen (seed en bronnen), voor de populariteit op de detailpagina. */
  observations: Map<string, Observation[]>;
  now: string;
  runId?: string;
  /** Datums die altijd mee moeten (seed en gevolgd). */
  pinned: Set<string>;
  maxEvents?: number;
}

function toEventDate(e: CatalogEvent): EventDate {
  const { localTime: _a, soldOutAt: _b, soldOutInPresale: _c, inputs: _d, externalIds: _e, firstSeenAt: _f, ...rest } = e;
  return rest;
}

export function snapshotScore(r: ScoreResult): SnapshotScore {
  const ex = explainScore(r);
  return {
    kind: r.kind,
    value: r.score,
    state: r.state,
    confidence: r.confidence,
    label: r.state === 'soldout' ? 'Uitverkocht' : r.state === 'cancelled' ? 'Geannuleerd' : scoreBand(r.score, r.kind).label,
    headline: ex.headline,
    lines: ex.lines,
    ...(r.speed ? { speed: r.speed } : {}),
    ...(ex.speed ? { speedText: ex.speed } : {}),
    ...(ex.caveat ? { caveat: ex.caveat } : {}),
    computedAt: r.computedAt,
    modelVersion: r.modelVersion,
  };
}

/** Last.fm-bron met link naar de artiestpagina (bronvermelding volgens de Last.fm-voorwaarden). */
function lastfmSource(name: string, obs: Observation): SourceRef {
  return obs.source.url && obs.source.url !== 'https://www.last.fm' ? obs.source : { ...obs.source, url: `https://www.last.fm/music/${encodeURIComponent(name).replace(/%20/g, '+')}` };
}

function popularityOf(artistId: string, name: string, inp: SnapshotInput): ArtistPopularity | undefined {
  const o = inp.observations;
  const p: ArtistPopularity = {};
  const listeners = o.get(`artist:${artistId}|lastfm_listeners|`);
  const last = listeners?.[listeners.length - 1];
  if (last && typeof last.value === 'number') {
    p.lastfmListeners = { value: last.value, at: last.observedAt, source: lastfmSource(name, last) };
    const g = growth(listeners, inp.now, 90);
    if (g !== undefined) p.lastfmGrowth90d = Math.round(g * 1000) / 1000;
  }
  const plays = o.get(`artist:${artistId}|lastfm_playcount|`);
  const lastPlays = plays?.[plays.length - 1];
  if (lastPlays && typeof lastPlays.value === 'number') p.lastfmPlaycount = { value: lastPlays.value, at: lastPlays.observedAt, source: lastfmSource(name, lastPlays) };
  const ranks: NonNullable<ArtistPopularity['lastfmRanks']> = [];
  const fresh = DateTime.fromISO(inp.now).minus({ days: 14 }).toISO()!;
  for (const [k, list] of o) {
    if (!k.startsWith(`artist:${artistId}|lastfm_rank|`)) continue;
    const country = k.split('|')[2] ?? '';
    const l = list[list.length - 1];
    if (l && typeof l.value === 'number' && l.observedAt >= fresh) ranks.push({ country, rank: l.value, at: l.observedAt });
  }
  if (ranks.length) p.lastfmRanks = ranks.sort((a, b) => a.rank - b.rank);
  // YouTube: alleen de laatste meting van de afgelopen 30 dagen, alleen ter informatie.
  const ytCut = DateTime.fromISO(inp.now).minus({ days: YOUTUBE_RETENTION_DAYS }).toISO()!;
  const ytSubs = o.get(`artist:${artistId}|youtube_subscribers|`)?.filter((x) => isYouTubeObservation(x) && x.observedAt >= ytCut);
  const ytViews = o.get(`artist:${artistId}|youtube_views|`)?.filter((x) => x.observedAt >= ytCut);
  const subs = latestValue(ytSubs);
  const views = latestValue(ytViews);
  if (subs !== undefined || views !== undefined) {
    const at = [ytSubs?.at(-1)?.observedAt, ytViews?.at(-1)?.observedAt].filter(Boolean).sort().at(-1)!;
    const url = ytSubs?.at(-1)?.source.url ?? ytViews?.at(-1)?.source.url;
    p.youtube = { ...(subs !== undefined ? { subscribers: subs } : {}), ...(views !== undefined ? { views } : {}), at, ...(url ? { url } : {}) };
  }
  const facts = inp.catalog.facts.get(artistId);
  if (facts?.other.length) p.other = facts.other;
  if (facts?.charts.length) p.charts = [...facts.charts].sort((a, b) => b.year - a.year || a.peak - b.peak);
  return Object.keys(p).length ? p : undefined;
}

export function buildSnapshot(inp: SnapshotInput): Snapshot {
  const today = DateTime.fromISO(inp.now).toISODate()!;
  const max = inp.maxEvents ?? 2500;
  const current = (id: string) => {
    const s = inp.scores.get(id);
    return s ? (s.stage === 'onsale' ? s.sellout : s.rush) : undefined;
  };
  const upcoming = [...inp.catalog.events.values()].filter((e) => (e.date.localDate ?? (e.date.localMonth ? `${e.date.localMonth}-31` : '9999')) >= today);
  upcoming.sort((a, b) => {
    const pa = inp.pinned.has(a.id) ? 1 : 0;
    const pb = inp.pinned.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (current(b.id)?.score ?? 0) - (current(a.id)?.score ?? 0);
  });
  const chosen = upcoming.slice(0, max);
  const chosenIds = new Set(chosen.map((e) => e.id));

  const conflictsByEntity = new Map<string, Conflict[]>();
  for (const c of inp.conflicts) conflictsByEntity.set(c.entity, [...(conflictsByEntity.get(c.entity) ?? []), c]);
  const phases = [...inp.catalog.phases.values()]
    .map((p) => ({ ...p, eventIds: p.eventIds.filter((id) => chosenIds.has(id)) }))
    .filter((p) => p.eventIds.length > 0);
  const phaseIdsByEvent = new Map<string, string[]>();
  for (const p of phases) for (const e of p.eventIds) phaseIdsByEvent.set(e, [...(phaseIdsByEvent.get(e) ?? []), p.id]);

  const failing = Object.values(inp.health).filter((h) => !h.ok && !h.message?.startsWith('Niet ingesteld'));
  const rushResolved = new Map(inp.rushOutcomes.map((o) => [o.eventId, o]));

  const events: SnapshotEvent[] = chosen.map((e) => {
    const sc = inp.scores.get(e.id)!;
    const kind: ScoreKind = sc.stage === 'onsale' ? 'sellout' : 'rush';
    const main = snapshotScore(kind === 'rush' ? sc.rush : sc.sellout);
    const hist = (inp.history[e.id] ?? []).filter((p) => (p.kind ?? 'sellout') === kind).map((p) => ({ at: p.at, score: p.score }));
    const conflicts = [
      ...(conflictsByEntity.get(`event:${e.id}`) ?? []),
      ...(phaseIdsByEvent.get(e.id) ?? []).flatMap((pid) => conflictsByEntity.get(`phase:${pid}`) ?? []),
    ];
    const stale = failing.find((h) => e.sources.some((s) => s.name === h.name));
    let rushFinal: FrozenRush | undefined;
    if (sc.stage === 'onsale') {
      const fr = inp.rushFinal[e.id];
      if (fr) {
        const o = rushResolved.get(e.id);
        rushFinal = {
          value: fr.score,
          label: scoreBand(fr.score, 'rush').label,
          confidence: fr.confidence,
          at: fr.at,
          firstSaleAt: fr.firstSaleAt,
          ...(o ? { outcome: { result: o.outcome === 1 ? 'busy' : 'calm', ...(o.speed ? { speed: o.speed } : {}), text: rushOutcomeText(fr.score, o), resolvedAt: o.resolvedAt ?? inp.now } } : {}),
        };
      } else if (sc.rush.state === 'scored') {
        rushFinal = {
          value: sc.rush.score,
          label: scoreBand(sc.rush.score, 'rush').label,
          confidence: sc.rush.confidence,
          at: sc.rush.computedAt,
          ...(sc.firstSaleAt ? { firstSaleAt: sc.firstSaleAt } : {}),
          reconstructed: true,
        };
      }
    }
    return {
      ...toEventDate(e),
      stage: sc.stage,
      ...(sc.firstSaleAt ? { firstSaleAt: sc.firstSaleAt } : {}),
      score: main,
      ...(sc.stage === 'upcoming' ? { rush: main } : {}),
      sellout: kind === 'sellout' ? main : snapshotScore(sc.sellout),
      ...(rushFinal ? { rushFinal } : {}),
      history: hist.slice(-40),
      trend: scoreTrend(hist, inp.now),
      conflicts,
      ...(stale
        ? { stale: { since: stale.lastSuccessAt ?? stale.lastAttemptAt ?? inp.now, message: `${stale.name} was bij de laatste update niet bereikbaar; dit is de laatst bekende data.` } }
        : {}),
    };
  });

  const usedVenues = new Set(chosen.map((e) => e.venueId));
  const usedTours = new Set(chosen.map((e) => e.tourId).filter(Boolean) as string[]);
  const usedArtists = new Set(chosen.flatMap((e) => e.artistIds));
  const twoWeeksAgo = DateTime.fromISO(inp.now).minus({ days: 14 }).toISO()!;
  const titles = new Map(inp.catalog.events);
  const recent: RushCheck[] = [...inp.rushOutcomes]
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
    .slice(0, 30)
    .map((o) => {
      const ev = titles.get(o.eventId);
      const score = Math.round(o.predicted * 100);
      return {
        eventId: o.eventId,
        title: ev?.title ?? o.eventId,
        ...(ev?.date.localDate ? { localDate: ev.date.localDate } : {}),
        predicted: score,
        label: scoreBand(score, 'rush').label,
        result: o.outcome === 1 ? 'busy' : 'calm',
        ...(o.speed ? { speed: o.speed } : {}),
        resolvedAt: o.resolvedAt ?? inp.now,
      };
    });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: inp.now,
    ...(inp.runId ? { runId: inp.runId } : {}),
    model: { version: inp.models.sellout.version, outcomesUsed: inp.models.sellout.outcomesUsed },
    models: {
      rush: { version: inp.models.rush.version, outcomesUsed: inp.models.rush.outcomesUsed },
      sellout: { version: inp.models.sellout.version, outcomesUsed: inp.models.sellout.outcomesUsed },
    },
    artists: [...inp.catalog.artists.values()]
      .filter((a) => usedArtists.has(a.id))
      .map(({ externalIds: _x, ...a }) => {
        const popularity = popularityOf(a.id, a.name, inp);
        return popularity ? { ...a, popularity } : a;
      }),
    tours: [...inp.catalog.tours.values()]
      .filter((t) => usedTours.has(t.id))
      .map((t) => ({
        id: t.id,
        artistId: t.artistId,
        name: t.name,
        ...(t.leg ? { leg: t.leg } : {}),
        ...(t.announcedAt ? { announcedAt: t.announcedAt } : {}),
        ...(t.farewell ? { farewell: true } : {}),
        ...(t.reunion ? { reunion: true } : {}),
        ...(t.comeback ? { comeback: true } : {}),
        ...(t.previousVisits?.length ? { previousVisits: t.previousVisits } : {}),
        ...(t.previousEditions?.length ? { previousEditions: t.previousEditions } : {}),
      })),
    venues: [...inp.catalog.venues.values()].filter((v) => usedVenues.has(v.id)).map(({ externalIds: _x, ...v }) => v),
    events,
    phases,
    sources: Object.values(inp.health).sort((a, b) => a.name.localeCompare(b.name)),
    changes: inp.changes.filter((c) => c.at >= twoWeeksAgo).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    accuracy: accuracySummary(inp.outcomes),
    rushAccuracy: { ...accuracySummary(inp.rushOutcomes), recent },
  };
}
