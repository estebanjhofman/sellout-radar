import { DateTime } from 'luxon';
import {
  accuracySummary,
  explainScore,
  scoreBand,
  scoreTrend,
  SNAPSHOT_SCHEMA_VERSION,
  type ChangeLogEntry,
  type Conflict,
  type EventDate,
  type OutcomeRecord,
  type ScoreModel,
  type ScoreResult,
  type Snapshot,
  type SnapshotEvent,
  type SourceHealth,
} from '@sellout/core';
import type { Catalog, CatalogEvent } from '../catalog';
import type { ScorePoint } from '../state';

export interface SnapshotInput {
  catalog: Catalog;
  scores: Map<string, ScoreResult>;
  history: Record<string, ScorePoint[]>;
  conflicts: Conflict[];
  health: Record<string, SourceHealth>;
  changes: ChangeLogEntry[];
  outcomes: OutcomeRecord[];
  model: ScoreModel;
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

export function buildSnapshot(inp: SnapshotInput): Snapshot {
  const today = DateTime.fromISO(inp.now).toISODate()!;
  const max = inp.maxEvents ?? 2500;
  const upcoming = [...inp.catalog.events.values()].filter((e) => (e.date.localDate ?? (e.date.localMonth ? `${e.date.localMonth}-31` : '9999')) >= today);
  upcoming.sort((a, b) => {
    const pa = inp.pinned.has(a.id) ? 1 : 0;
    const pb = inp.pinned.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (inp.scores.get(b.id)?.score ?? 0) - (inp.scores.get(a.id)?.score ?? 0);
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

  const events: SnapshotEvent[] = chosen.map((e) => {
    const r = inp.scores.get(e.id)!;
    const ex = explainScore(r);
    const hist = (inp.history[e.id] ?? []).map((p) => ({ at: p.at, score: p.score }));
    const conflicts = [
      ...(conflictsByEntity.get(`event:${e.id}`) ?? []),
      ...(phaseIdsByEvent.get(e.id) ?? []).flatMap((pid) => conflictsByEntity.get(`phase:${pid}`) ?? []),
    ];
    const stale = failing.find((h) => e.sources.some((s) => s.name === h.name));
    return {
      ...toEventDate(e),
      score: {
        value: r.score,
        state: r.state,
        confidence: r.confidence,
        label: r.state === 'soldout' ? 'Uitverkocht' : r.state === 'cancelled' ? 'Geannuleerd' : scoreBand(r.score).label,
        headline: ex.headline,
        lines: ex.lines,
        ...(r.speed ? { speed: r.speed } : {}),
        ...(ex.speed ? { speedText: ex.speed } : {}),
        ...(ex.caveat ? { caveat: ex.caveat } : {}),
        computedAt: r.computedAt,
        modelVersion: r.modelVersion,
      },
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

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: inp.now,
    ...(inp.runId ? { runId: inp.runId } : {}),
    model: { version: inp.model.version, outcomesUsed: inp.model.outcomesUsed },
    artists: [...inp.catalog.artists.values()].filter((a) => usedArtists.has(a.id)).map(({ externalIds: _x, ...a }) => a),
    tours: [...inp.catalog.tours.values()]
      .filter((t) => usedTours.has(t.id))
      .map((t) => ({ id: t.id, artistId: t.artistId, name: t.name, ...(t.leg ? { leg: t.leg } : {}), ...(t.announcedAt ? { announcedAt: t.announcedAt } : {}), ...(t.farewell ? { farewell: true } : {}), ...(t.reunion ? { reunion: true } : {}), ...(t.comeback ? { comeback: true } : {}) })),
    venues: [...inp.catalog.venues.values()].filter((v) => usedVenues.has(v.id)).map(({ externalIds: _x, ...v }) => v),
    events,
    phases,
    sources: Object.values(inp.health).sort((a, b) => a.name.localeCompare(b.name)),
    changes: inp.changes.filter((c) => c.at >= twoWeeksAgo).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    accuracy: accuracySummary(inp.outcomes),
  };
}
